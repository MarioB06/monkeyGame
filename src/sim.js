/* ============================================================================
   SIM -- the authoritative game simulation. SHARED between the browser
   (offline single-player runs it locally) and Node (the server runs it
   authoritatively for online matches).

   PURE LOGIC: no canvas, audio, DOM, camera, or particles. Instead, every
   "something happened" moment is pushed to this.events; the client turns
   those into sound/particles/HUD via client/fx applyEvents().

   Supports N players (1 = single-player, 2-4 = competitive PvP). Players hurt
   each other with bananas; killing a player scatters their electronic parts;
   the first to gather all parts and build the signal device at the station
   wins.
   ========================================================================== */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports)
    module.exports = factory(require("./config.js"), require("./mathutils.js"), require("./worldgen.js"));
  else
    root.Sim = factory(root.CONFIG, root.MathUtils, root.WorldGen);
})(typeof self !== "undefined" ? self : this, function (CONFIG, M, WorldGen) {
  "use strict";
  var clamp = M.clamp, lerp = M.lerp, dist = M.dist, angTo = M.angTo,
      rand = M.rand, randi = M.randi, pick = M.pick, chance = M.chance,
      resolveCircle = M.resolveCircle, pointBlocked = M.pointBlocked;

  // input action bitmask (mirrored in src/protocol.js)
  var FLAG = { THROW: 1, SLIDE: 2, COUNTER: 4, INTERACT: 8 };

  /* ==========================================================================
     PLAYER
     ========================================================================== */
  function Player(sim, id, slot, name) {
    this.sim = sim;
    this.id = id;
    this.slot = slot;                 // 0..3 -> spawn + colour
    this.name = name || ("P" + (slot + 1));
    var sp = sim.layout.playerSpawns[slot % sim.layout.playerSpawns.length];
    this.x = sp.x; this.y = sp.y;
    this.hp = CONFIG.PLAYER.HP; this.maxHp = CONFIG.PLAYER.HP;
    this.stamina = CONFIG.PLAYER.STAMINA;
    this.stamDelay = 0;
    this.cooldown = 0;
    this.goldT = 0;
    this.slideT = 0; this.slideCd = 0;
    this.slideDX = 1; this.slideDY = 0;
    this.counterT = 0; this.counterCd = 0;
    this.hurtT = 0;
    this.facing = 1;
    this.moving = false;
    this.alive = true;
    this.respawnT = 0;
    this.parts = 0; this.partIds = [];
    this.score = 0; this.kills = 0; this.deaths = 0;
    this.combo = 0; this.comboT = 0; this.maxCombo = 0;
    this.building = false; this.buildT = 0; this.buildTickT = 0;
    this.hidden = false; this.climbCd = 0;   // hiding up a big tree
    this.riseZ = 0;                   // rescue lift (winner only)
    this.input = { move: { x: 0, y: 0 }, aim: 0, aimDist: CONFIG.BANANA.RANGE, flags: 0 };
    this.prevFlags = 0;
  }
  Player.prototype.invulnerable = function () {
    return this.hurtT > 0 || this.slideT > 0 || this.hidden || this.sim.phase !== "playing" || !this.alive;
  };
  Player.prototype.controllable = function () {
    return this.sim.phase === "playing" && this.alive;
  };
  Player.prototype.addScore = function (base) {
    var v = Math.round(base * (1 + Math.max(0, this.combo - 1) * 0.15));
    this.score += v; return v;
  };
  Player.prototype.bumpCombo = function () {
    this.combo++; this.comboT = CONFIG.COMBO_TIME;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
  };
  Player.prototype.resetCombo = function () { this.combo = 0; this.comboT = 0; };

  Player.prototype.update = function (dt) {
    var sim = this.sim, C = CONFIG.PLAYER;
    // timers always tick
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.goldT = Math.max(0, this.goldT - dt);
    this.slideCd = Math.max(0, this.slideCd - dt);
    this.counterT = Math.max(0, this.counterT - dt);
    this.counterCd = Math.max(0, this.counterCd - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.climbCd = Math.max(0, this.climbCd - dt);
    this.stamDelay = Math.max(0, this.stamDelay - dt);
    if (this.comboT > 0 && (this.comboT -= dt) <= 0) this.resetCombo();

    if (!this.alive) {                // dead: count down to respawn
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn();
      return;
    }
    if (this.stamDelay <= 0 && this.slideT <= 0)
      this.stamina = Math.min(C.STAMINA, this.stamina + C.STAM_REGEN * dt);

    var f = this.input.flags, pf = this.prevFlags;
    var ctrl = this.controllable();

    // edge / held actions
    if (ctrl) {
      if (!this.hidden && (f & FLAG.THROW)) this.tryThrow();                       // auto-fire (cooldown-gated)
      if (!this.hidden && (f & FLAG.SLIDE) && !(pf & FLAG.SLIDE)) this.trySlide();
      if (!this.hidden && (f & FLAG.COUNTER) && !(pf & FLAG.COUNTER)) this.tryCounter();
      if ((f & FLAG.INTERACT) && !(pf & FLAG.INTERACT)) this.interactEdge();        // climb up/down works while hidden
    }
    this.prevFlags = f;

    // movement
    var ax = 0, ay = 0;
    if (ctrl && !this.hidden) { ax = this.input.move.x; ay = this.input.move.y; }
    this.moving = (ax !== 0 || ay !== 0) && this.slideT <= 0;
    var vx, vy;
    if (this.slideT > 0) {
      this.slideT -= dt;
      var k = 0.45 + 0.55 * (this.slideT / C.SLIDE_TIME);
      vx = this.slideDX * C.SLIDE_SPEED * k;
      vy = this.slideDY * C.SLIDE_SPEED * k;
      if (this.slideT <= 0) this.slideCd = C.SLIDE_CD;
    } else {
      vx = ax * C.SPEED; vy = ay * C.SPEED;
    }
    this.x += vx * dt; this.y += vy * dt;
    var fix = resolveCircle(this.x, this.y, C.RADIUS, sim.solids);
    this.x = clamp(fix.x, 20, CONFIG.WORLD_W - 20);
    this.y = clamp(fix.y, 20, CONFIG.WORLD_H - 20);

    // facing from aim
    if (ctrl) this.facing = Math.cos(this.input.aim) >= 0 ? 1 : -1;

    // build the signal device while holding INTERACT at the station with all parts
    this.updateBuild(dt, f);
  };

  Player.prototype.updateBuild = function (dt, f) {
    var sim = this.sim, st = sim.layout.station;
    var canBuild = this.alive && sim.phase === "playing" &&
                   this.parts >= CONFIG.PART_TOTAL &&
                   dist(this.x, this.y, st.doorX, st.doorY) < 40 &&
                   (f & FLAG.INTERACT);
    if (canBuild) {
      if (!this.building) { this.building = true; this.buildT = 0; this.buildTickT = 0;
        sim.emit({ t: "msg", pid: this.id, text: "BUILDING SIGNAL DEVICE...", cls: "good" }); }
      this.buildT += dt;
      this.buildTickT -= dt;
      if (this.buildTickT <= 0) { this.buildTickT = 0.18; sim.emit({ t: "buildTick", pid: this.id, x: st.doorX, y: st.doorY }); }
      if (this.buildT >= CONFIG.BUILD_TIME) sim.startRescue(this.id);
    } else if (this.building) {
      this.building = false; this.buildT = 0;
    }
  };

  Player.prototype.tryThrow = function () {
    var sim = this.sim, C = CONFIG.PLAYER;
    if (this.cooldown > 0 || this.slideT > 0) return;
    var ang = this.input.aim;
    var d = clamp(this.input.aimDist, 40, CONFIG.BANANA.RANGE);
    sim.spawnBanana({
      owner: this.id, x: this.x + this.facing * 6, y: this.y - 10,
      angle: ang, range: d, speed: CONFIG.BANANA.SPEED, dmg: CONFIG.BANANA.DMG,
      arc: CONFIG.BANANA.ARC * (0.5 + 0.5 * d / CONFIG.BANANA.RANGE)
    });
    this.cooldown = this.goldT > 0 ? C.FAST_THROW_CD : C.THROW_CD;
    sim.emit({ t: "throw", pid: this.id, x: this.x, y: this.y - 10 });
  };
  Player.prototype.trySlide = function () {
    var sim = this.sim, C = CONFIG.PLAYER;
    if (this.slideT > 0 || this.slideCd > 0) return;
    if (this.stamina < C.SLIDE_COST) { sim.emit({ t: "denied", pid: this.id, x: this.x, y: this.y }); return; }
    var mx = this.input.move.x, my = this.input.move.y;
    if (mx === 0 && my === 0) { mx = this.facing; my = 0; }
    var len = Math.sqrt(mx * mx + my * my);
    this.slideDX = mx / len; this.slideDY = my / len;
    this.slideT = C.SLIDE_TIME;
    this.stamina -= C.SLIDE_COST;
    this.stamDelay = C.STAM_DELAY;
    sim.emit({ t: "slide", pid: this.id, x: this.x, y: this.y });
  };
  Player.prototype.tryCounter = function () {
    var sim = this.sim, C = CONFIG.PLAYER;
    if (this.counterCd > 0) return;
    this.counterT = C.COUNTER_WINDOW;
    this.counterCd = C.COUNTER_CD;
    sim.emit({ t: "counterWhiff", pid: this.id, x: this.x, y: this.y });
  };
  Player.prototype.interactEdge = function () {
    var sim = this.sim, st = sim.layout.station, i, c;
    // climb into / out of a big hide tree (works while hidden so you can descend)
    if (this.climbCd <= 0) {
      if (this.hidden) {
        this.hidden = false; this.climbCd = 0.4;
        sim.emit({ t: "climb", pid: this.id, x: this.x, y: this.y, up: false });
        sim.emit({ t: "msg", pid: this.id, text: "CLIMBED DOWN", cls: "good" });
        return;
      }
      var tree = sim.nearestHideTree(this.x, this.y, 24);
      if (tree) {
        this.hidden = true; this.climbCd = 0.4;
        this.x = tree.x; this.y = tree.y;
        this.slideT = 0; this.building = false; this.buildT = 0;
        sim.emit({ t: "climb", pid: this.id, x: tree.x, y: tree.y, up: true });
        sim.emit({ t: "msg", pid: this.id, text: "HIDDEN IN THE TREE", cls: "good" });
        return;
      }
    }
    if (dist(this.x, this.y, st.doorX, st.doorY) < 40) {
      if (this.parts < CONFIG.PART_TOTAL) {
        sim.emit({ t: "denied", pid: this.id, x: this.x, y: this.y });
        sim.emit({ t: "msg", pid: this.id, text: "NEED " + (CONFIG.PART_TOTAL - this.parts) + " MORE PARTS", cls: "bad" });
      } else {
        sim.emit({ t: "msg", pid: this.id, text: "HOLD E TO BUILD THE SIGNAL", cls: "good" });
      }
      return;
    }
    for (i = 0; i < sim.chests.length; i++) {
      c = sim.chests[i];
      if (c.state !== "open" && dist(this.x, this.y, c.x, c.y) < 28) {
        sim.emit({ t: "denied", pid: this.id, x: this.x, y: this.y });
        sim.emit({ t: "msg", pid: this.id, text: "LOCKED TIGHT! HIT IT WITH BANANAS", cls: "bad" });
        return;
      }
    }
  };
  Player.prototype.hurt = function (dmg, fromX, fromY, attackerPid) {
    var sim = this.sim;
    if (this.invulnerable()) return false;
    this.hp -= dmg;
    this.hurtT = CONFIG.PLAYER.IFRAMES;
    if (fromX !== undefined) {
      var ang = angTo(fromX, fromY, this.x, this.y);
      this.x += Math.cos(ang) * 7; this.y += Math.sin(ang) * 7;
    }
    this.resetCombo();
    if (CONFIG.MP.BUILD_INTERRUPTIBLE && this.building) { this.building = false; this.buildT = 0; }
    var fatal = this.hp <= 0;
    sim.emit({ t: "playerHurt", pid: this.id, x: this.x, y: this.y, dmg: dmg, fatal: fatal, attackerPid: attackerPid || null });
    if (fatal) { this.hp = 0; this.die(attackerPid || null); }
    return true;
  };
  Player.prototype.die = function (killerPid) {
    var sim = this.sim;
    this.deaths++;
    this.alive = false;
    if (sim.mode === "sp") { sim.gameOver(null, true); return; }
    sim.killPlayer(this, killerPid);
    if (CONFIG.MP.RESPAWN) this.respawnT = CONFIG.MP.RESPAWN_SECS;
    else this.respawnT = Infinity;          // eliminated
  };
  Player.prototype.respawn = function () {
    var sim = this.sim, sp = sim.layout.playerSpawns[this.slot % sim.layout.playerSpawns.length];
    this.x = sp.x; this.y = sp.y;
    this.hp = this.maxHp; this.alive = true;
    this.hurtT = 1.0; this.slideT = 0; this.cooldown = 0;
    this.hidden = false; this.climbCd = 0;
    this.parts = 0; this.partIds = [];
    sim.emit({ t: "respawn", pid: this.id, x: this.x, y: this.y });
  };

  /* ==========================================================================
     MONKEY -- targets the nearest living player
     ========================================================================== */
  function Monkey(sim, id, x, y, type) {
    this.sim = sim;
    this.id = id;
    this.type = type;
    this.stats = CONFIG.MONKEY[type];
    this.x = x; this.y = y;
    this.home = { x: x, y: y };
    this.hp = this.stats.hp;
    this.state = "idle";
    this.stateT = rand(0.4, 1.6);
    this.target = { x: x, y: y };
    this.throwCd = rand(this.stats.throwCd[0], this.stats.throwCd[1]);
    this.meleeCd = 0;
    this.hitT = 0;
    this.deadT = 0;
    this.alerted = false;
    this.guardChest = null;
    this.facing = 1;
    this.moving = false;
    this.radius = type === "alpha" ? 7 : 4;
    this.height = type === "alpha" ? 20 : 13;
    this.roared = false;
  }
  Monkey.prototype.alive = function () { return this.state !== "dead"; };
  Monkey.prototype.canCatch = function () {
    return this.alive() && this.hitT <= 0 && this.state !== "hold" && this.state !== "windup";
  };
  Monkey.prototype.leashCenter = function () {
    return this.guardChest ? { x: this.guardChest.x, y: this.guardChest.y } : this.home;
  };
  Monkey.prototype.update = function (dt) {
    var sim = this.sim, st = this.stats;
    if (this.state === "dead") { this.deadT += dt; return; }
    this.throwCd = Math.max(0, this.throwCd - dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    if (this.hitT > 0) { this.hitT -= dt; return; }

    var playing = sim.phase === "playing";
    var lc = this.leashCenter();
    var leashR = this.alerted ? CONFIG.MONKEY_ALERT_LEASH : CONFIG.MONKEY_LEASH;
    var speed = st.speed, vx = 0, vy = 0;
    var aggroR = st.aggro * (this.alerted ? 1.6 : 1);
    var p = playing ? sim.nearestPlayer(this.x, this.y) : null;
    var dP = p ? dist(this.x, this.y, p.x, p.y) : Infinity;

    switch (this.state) {
      case "idle":
        this.stateT -= dt;
        if (p && dP < aggroR) this.enterChase();
        else if (this.stateT <= 0) {
          var a = rand(0, 6.28), r = rand(20, leashR * 0.7);
          this.target = { x: lc.x + Math.cos(a) * r, y: lc.y + Math.sin(a) * r };
          this.state = "wander"; this.stateT = rand(1.2, 2.6);
        }
        break;
      case "wander":
        this.stateT -= dt;
        var dT = dist(this.x, this.y, this.target.x, this.target.y);
        if (p && dP < aggroR) { this.enterChase(); break; }
        if (dT < 6 || this.stateT <= 0) { this.state = "idle"; this.stateT = rand(0.5, 1.8); break; }
        vx = (this.target.x - this.x) / dT * speed * 0.55;
        vy = (this.target.y - this.y) / dT * speed * 0.55;
        break;
      case "chase":
        if (!p) { this.state = "return"; break; }
        this.facing = p.x >= this.x ? 1 : -1;
        if (dist(this.x, this.y, lc.x, lc.y) > leashR * 1.9 && dP > aggroR) { this.state = "return"; break; }
        if (dP < st.throwRange && this.throwCd <= 0 && dP > 26) { this.state = "windup"; this.stateT = 0.45; break; }
        if (dP < 15 && this.meleeCd <= 0) {
          if (p.hurt(st.meleeDmg, this.x, this.y, null)) {
            this.meleeCd = 1.15;
            sim.emit({ t: "melee", x: p.x, y: p.y });
          } else this.meleeCd = 0.4;
        }
        if (dP > 14) { vx = (p.x - this.x) / dP * speed; vy = (p.y - this.y) / dP * speed; }
        break;
      case "windup":
        if (p) this.facing = p.x >= this.x ? 1 : -1;
        this.stateT -= dt;
        if (this.stateT <= 0) {
          if (p) this.throwBananaAt(p, false);
          this.state = "throwing"; this.stateT = 0.25;
          this.throwCd = rand(st.throwCd[0], st.throwCd[1]);
        }
        break;
      case "throwing":
        this.stateT -= dt;
        if (this.stateT <= 0) this.state = p && dP < aggroR ? "chase" : "return";
        break;
      case "hold":
        if (p) this.facing = p.x >= this.x ? 1 : -1;
        this.stateT -= dt;
        if (this.stateT <= 0) {
          if (p) this.throwBananaAt(p, true);
          this.state = "throwing"; this.stateT = 0.25;
        }
        break;
      case "return":
        var dH = dist(this.x, this.y, lc.x, lc.y);
        if (dH < 10) { this.state = "idle"; this.stateT = rand(0.5, 1.5); break; }
        if (p && dP < aggroR * 0.8) { this.enterChase(); break; }
        vx = (lc.x - this.x) / dH * speed * 0.8;
        vy = (lc.y - this.y) / dH * speed * 0.8;
        break;
    }

    // soft separation
    var list = sim.monkeys;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === this || !o.alive()) continue;
      var d2 = dist(this.x, this.y, o.x, o.y);
      if (d2 > 0.01 && d2 < 12) { vx += (this.x - o.x) / d2 * 30; vy += (this.y - o.y) / d2 * 30; }
    }
    if (vx || vy) {
      if (this.state === "wander" || this.state === "return") this.facing = vx >= 0 ? 1 : -1;
      this.x += vx * dt; this.y += vy * dt;
      var fix = resolveCircle(this.x, this.y, this.radius, sim.solids);
      this.x = clamp(fix.x, 22, CONFIG.WORLD_W - 22);
      this.y = clamp(fix.y, 22, CONFIG.WORLD_H - 22);
    }
    this.moving = !!(vx || vy);
  };
  Monkey.prototype.enterChase = function () {
    this.state = "chase";
    if (this.type === "alpha" && !this.roared) {
      this.roared = true;
      this.sim.emit({ t: "alphaRoar", id: this.id, x: this.x, y: this.y });
    }
  };
  Monkey.prototype.throwBananaAt = function (p, returned) {
    var sim = this.sim;
    var tx = p.x + (p.facing * (p.moving ? 14 : 0)) + rand(-8, 8);
    var ty = p.y + rand(-6, 6);
    var d = dist(this.x, this.y, tx, ty) + 14;
    var self = this;
    function one(angOff) {
      sim.spawnBanana({
        owner: "m", returned: returned,
        x: self.x + self.facing * 5, y: self.y - self.height + 2,
        angle: angTo(self.x, self.y - 8, tx, ty) + angOff, range: d, arc: 16,
        speed: returned ? CONFIG.BANANA.RETURN_SPEED : CONFIG.BANANA.RETURN_SPEED * 0.92,
        dmg: returned ? CONFIG.BANANA.RETURN_DMG : self.stats.throwDmg
      });
    }
    one(0);
    if (this.type === "alpha" && !returned && chance(0.45)) { one(0.22); one(-0.22); }
    sim.emit({ t: "monkeyThrow", x: this.x, y: this.y - this.height });
  };
  Monkey.prototype.catchBanana = function (victimPid) {
    this.state = "hold";
    this.stateT = rand(CONFIG.CATCH_HOLD[0], CONFIG.CATCH_HOLD[1]);
    this.alerted = true;
    this.sim.emit({ t: "monkeyCatch", id: this.id, x: this.x, y: this.y - this.height, pid: victimPid });
  };
  Monkey.prototype.hurtBy = function (dmg, fromX, fromY, attackerPid) {
    if (!this.alive()) return;
    this.hp -= dmg;
    this.hitT = 0.26;
    this.alerted = true;
    if (this.state === "idle" || this.state === "wander" || this.state === "return") this.enterChase();
    var ang = angTo(fromX, fromY, this.x, this.y);
    this.x += Math.cos(ang) * 6; this.y += Math.sin(ang) * 6;
    if (this.hp <= 0) this.die(attackerPid);
    else { this.sim.emit({ t: "monkeyHit", id: this.id, x: this.x, y: this.y, killerPid: attackerPid || null }); this.sim.creditMonkeyHit(attackerPid, this); }
  };
  Monkey.prototype.die = function (killerPid) {
    this.state = "dead"; this.deadT = 0;
    this.sim.emit({ t: "monkeyKilled", id: this.id, x: this.x, y: this.y, mtype: this.type, killerPid: killerPid || null });
    this.sim.creditMonkeyKilled(killerPid, this);
  };

  /* ==========================================================================
     BANANA
     ========================================================================== */
  function Banana(sim, id, o) {
    this.sim = sim; this.id = id;
    this.owner = o.owner;             // pid string | 'm'
    this.returned = !!o.returned;
    this.countered = false;
    this.x = o.x; this.y = o.y;
    this.vx = Math.cos(o.angle); this.vy = Math.sin(o.angle);
    this.speed = o.speed; this.dmg = o.dmg;
    this.maxD = o.range; this.arc = o.arc || 12;
    this.traveled = 0;
    this.dead = false;
  }
  Banana.prototype.zOf = function () {
    var p = clamp(this.traveled / this.maxD, 0, 1);
    return lerp(9, 1, p) + this.arc * 4 * p * (1 - p);
  };
  Banana.prototype.impact = function (big) {
    if (this.dead) return;
    this.dead = true;
    this.sim.emit({ t: "bananaImpact", x: this.x, y: this.y - this.zOf(), z: this.zOf(), big: !!big });
  };
  Banana.prototype.update = function (dt) {
    if (this.dead) return;
    var step = this.speed * dt;
    this.x += this.vx * step; this.y += this.vy * step;
    this.traveled += step;
    if (pointBlocked(this.x, this.y, this.sim.wallSolids)) {
      this.dead = true;
      this.sim.emit({ t: "bananaThunk", x: this.x, y: this.y });
      return;
    }
    if (this.traveled >= this.maxD) this.impact();
  };

  /* ==========================================================================
     CHEST
     ========================================================================== */
  function Chest(sim, id, spot) {
    this.sim = sim; this.id = id;
    this.x = spot.x; this.y = spot.y;
    this.bonus = !!spot.bonus;
    this.partId = spot.partId;        // which of the 6 parts (undefined for bonus)
    this.lockHp = CONFIG.CHEST_HP;
    this.state = "closed";
    this.guards = [];
  }
  Chest.prototype.rect = function () { return { l: this.x - 8, r: this.x + 8, t: this.y - 7, b: this.y }; };
  Chest.prototype.hit = function (banana) {
    if (this.state === "open") return false;
    this.lockHp -= banana.countered ? 2 : 1;
    this.guards.forEach(function (m) { if (m.alive()) { m.alerted = true; m.enterChase(); } });
    if (this.lockHp <= 0) this.open(banana.owner);
    else { this.state = "cracked"; this.sim.emit({ t: "chestHit", id: this.id, x: this.x, y: this.y }); }
    return true;
  };
  Chest.prototype.open = function (openerPid) {
    this.state = "open";
    var sim = this.sim;
    sim.emit({ t: "chestOpen", id: this.id, x: this.x, y: this.y, bonus: this.bonus });
    if (this.bonus) {
      sim.spawnPickup(this.x - 8, this.y + 6, "heart");
      sim.spawnPickup(this.x + 8, this.y + 6, "gban");
      sim.spawnPickup(this.x, this.y + 10, "star");
    } else {
      sim.spawnPickup(this.x, this.y + 8, "part", this.partId);
    }
    var op = sim.players[openerPid];
    if (op) op.addScore(CONFIG.SCORE.CHEST);
  };

  /* ==========================================================================
     PICKUP -- part / heart / star / golden banana. Magnets to nearest player.
     ========================================================================== */
  function Pickup(sim, id, x, y, type, partId) {
    this.sim = sim; this.id = id;
    this.x = x; this.y = y;
    this.type = type;
    this.partId = partId;             // for 'part' pickups
    this.z = 8; this.vz = 75;
    this.vx = rand(-22, 22); this.vy = rand(-12, 12);
    this.dead = false;
  }
  Pickup.prototype.update = function (dt) {
    if (this.vz !== 0 || this.z > 0) {
      this.vz -= 300 * dt; this.z += this.vz * dt;
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.z <= 0) { this.z = 0; this.vz = 0; this.vx = 0; this.vy = 0; }
    }
    var p = this.sim.nearestPlayer(this.x, this.y);
    if (!p) return;
    var d = dist(this.x, this.y, p.x, p.y);
    if (this.z <= 2 && d < 34) { this.x += (p.x - this.x) * 6 * dt; this.y += (p.y - this.y) * 6 * dt; }
    if (d < 10) { this.dead = true; this.sim.collectPickup(this, p); }
  };

  /* ==========================================================================
     SIM
     ========================================================================== */
  function Sim(opts) {
    opts = opts || {};
    this.mode = opts.mode || "mp";              // 'sp' | 'mp'
    this.layout = WorldGen.buildLayout(opts.seed != null ? opts.seed : CONFIG.WORLD_SEED);
    this.wallSolids = this.layout.solids;        // bananas hit these (no chests)
    this.solids = this.layout.solids.slice();    // movement solids (+ chests below)

    this.players = {};
    this.order = [];                             // join order -> slot
    this.monkeys = [];
    this.bananas = [];
    this.pickups = [];
    this.chests = [];
    this.heli = null;

    this.phase = "playing";                      // playing | rescue | over
    this.winnerPid = null; this.winnerName = null; this.lost = false;
    this.rescueT = 0;
    this.radioActive = false;
    this.time = 0;
    this.dayT = 0.07;
    this.tick = 0;
    this._id = 1;
    this.events = [];

    // chests + their guard monkeys
    var self = this;
    var guardOff = [[34, 10], [-30, 16], [28, -20], [-34, -12], [30, 14], [-28, 18], [26, 16]];
    this.layout.chestSpots.forEach(function (spot, i) {
      var c = new Chest(self, self._id++, spot);
      self.chests.push(c);
      self.solids.push(c.rect());
      if (spot.guard) {
        var off = guardOff[i % guardOff.length];
        var m = new Monkey(self, self._id++, spot.x + off[0], spot.y + off[1], "guard");
        m.guardChest = c; c.guards.push(m); self.monkeys.push(m);
      }
    });
    this.layout.monkeySpots.forEach(function (s) {
      self.monkeys.push(new Monkey(self, self._id++, s.x, s.y, s.type));
    });
  }
  Sim.prototype.emit = function (ev) { this.events.push(ev); };
  Sim.prototype.nextId = function () { return this._id++; };

  Sim.prototype.addPlayer = function (id, name) {
    if (this.players[id]) return this.players[id];
    var slot = this.order.length;
    var p = new Player(this, id, slot, name);
    this.players[id] = p; this.order.push(id);
    this.emit({ t: "spawn", pid: id, x: p.x, y: p.y });
    return p;
  };
  Sim.prototype.removePlayer = function (id) {
    var p = this.players[id];
    if (!p) return;
    if (this.mode === "mp" && p.alive) this.killPlayer(p, null);   // scatter their parts
    delete this.players[id];
    var k = this.order.indexOf(id); if (k >= 0) this.order.splice(k, 1);
  };
  Sim.prototype.setInput = function (id, input) {
    var p = this.players[id]; if (!p) return;
    if (input.move) { p.input.move.x = input.move.x || 0; p.input.move.y = input.move.y || 0; }
    if (input.aim != null) p.input.aim = input.aim;
    if (input.aimDist != null) p.input.aimDist = input.aimDist;
    if (input.flags != null) p.input.flags = input.flags | 0;
  };

  Sim.prototype.nearestPlayer = function (x, y, maxR) {
    var best = null, bd = maxR || Infinity;
    for (var id in this.players) {
      var p = this.players[id];
      if (!p.alive || p.hidden) continue;             // hidden players can't be seen/targeted
      var d = dist(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  // nearest big hide tree (a {x,y} from layout.hideTrees) within maxR
  Sim.prototype.nearestHideTree = function (x, y, maxR) {
    var best = null, bd = maxR || Infinity, list = this.layout.hideTrees || [];
    for (var i = 0; i < list.length; i++) {
      var d = dist(x, y, list[i].x, list[i].y);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return best;
  };
  Sim.prototype.nearestEnemy = function (x, y, exceptPid) {
    // nearest target for a deflected banana: monkey OR rival player
    var best = null, bd = 320, kind = null, i;
    for (i = 0; i < this.monkeys.length; i++) {
      var m = this.monkeys[i]; if (!m.alive()) continue;
      var d = dist(x, y, m.x, m.y); if (d < bd) { bd = d; best = m; kind = "m"; }
    }
    for (var id in this.players) {
      if (id === exceptPid) continue;
      var p = this.players[id]; if (!p.alive || p.hidden) continue;
      var dp = dist(x, y, p.x, p.y - 8); if (dp < bd) { bd = dp; best = p; kind = "p"; }
    }
    return best ? { ent: best, kind: kind } : null;
  };

  Sim.prototype.spawnBanana = function (o) { var b = new Banana(this, this._id++, o); this.bananas.push(b); return b; };
  Sim.prototype.spawnPickup = function (x, y, type, partId) { var p = new Pickup(this, this._id++, x, y, type, partId); this.pickups.push(p); return p; };

  Sim.prototype.creditMonkeyHit = function (pid, m) {
    var p = this.players[pid]; if (!p) return;
    var v = p.addScore(CONFIG.SCORE.HIT); p.bumpCombo();
    this.emit({ t: "floater", x: m.x, y: m.y - m.height - 6, text: "+" + v, color: "#fff8d0" });
    this.emit({ t: "shake", pid: pid, amt: 0.6 });
  };
  Sim.prototype.creditMonkeyKilled = function (pid, m) {
    var p = this.players[pid];
    if (p) {
      p.kills++; var v = p.addScore(m.stats.score); p.bumpCombo();
      this.emit({ t: "floater", x: m.x, y: m.y - m.height - 6, text: "+" + v, color: "#f0d03a" });
      this.emit({ t: "shake", pid: pid, amt: 1.6 });
    }
    // drops
    var r = Math.random();
    if (r < CONFIG.DROPS.HEART) this.spawnPickup(m.x, m.y, "heart");
    else if (r < CONFIG.DROPS.HEART + CONFIG.DROPS.GOLD) this.spawnPickup(m.x, m.y, "gban");
    else if (r < 0.75) this.spawnPickup(m.x, m.y, "star");
  };
  Sim.prototype.collectPickup = function (pk, p) {
    if (pk.type === "part") {
      if (p.partIds.indexOf(pk.partId) < 0) { p.partIds.push(pk.partId); p.parts = p.partIds.length; }
      p.addScore(CONFIG.SCORE.PART);
      this.emit({ t: "pickup", pid: p.id, ptype: "part", x: p.x, y: p.y, partsNow: p.parts, partTotal: CONFIG.PART_TOTAL });
    } else if (pk.type === "heart") {
      p.hp = Math.min(p.maxHp, p.hp + CONFIG.HEART_HEAL);
      this.emit({ t: "pickup", pid: p.id, ptype: "heart", x: p.x, y: p.y });
      this.emit({ t: "floater", x: p.x, y: p.y - 24, text: "+" + CONFIG.HEART_HEAL + " HP", color: "#8ae88a" });
    } else if (pk.type === "star") {
      var v = p.addScore(200);
      this.emit({ t: "pickup", pid: p.id, ptype: "star", x: p.x, y: p.y });
      this.emit({ t: "floater", x: p.x, y: p.y - 24, text: "+" + v, color: "#f0d03a" });
    } else if (pk.type === "gban") {
      p.goldT = CONFIG.PLAYER.GOLD_TIME;
      this.emit({ t: "pickup", pid: p.id, ptype: "gban", x: p.x, y: p.y });
    }
  };
  Sim.prototype.killPlayer = function (victim, killerPid) {
    // scatter the victim's parts as pickups (one per held partId)
    for (var i = 0; i < victim.partIds.length; i++) {
      var pk = this.spawnPickup(victim.x + rand(-10, 10), victim.y + rand(-6, 6), "part", victim.partIds[i]);
      pk.vz = rand(60, 110); pk.z = 6;
    }
    victim.partIds = []; victim.parts = 0;
    var killer = this.players[killerPid];
    if (killer && killer !== victim) { killer.addScore(CONFIG.SCORE.KILL_PLAYER); killer.bumpCombo(); }
    this.emit({ t: "playerKilled", pid: victim.id, killerPid: killerPid || null, x: victim.x, y: victim.y, name: victim.name });
  };

  Sim.prototype.startRescue = function (pid) {
    if (this.phase !== "playing") return;
    var p = this.players[pid]; if (!p) return;
    this.phase = "rescue";
    this.winnerPid = pid; this.winnerName = p.name;
    this.radioActive = true;
    this.rescueT = 0;
    p.building = false;
    this.heli = { x: this.layout.helipad.x, y: this.layout.helipad.y, z: 230, phase: "enter" };
    this.emit({ t: "buildDone", pid: pid, name: p.name });
    this.emit({ t: "msg", pid: null, text: "SIGNAL DEVICE BUILT - " + p.name + " IS ESCAPING!", cls: "gold" });
  };
  Sim.prototype.updateRescue = function (dt) {
    this.rescueT += dt;
    var t = this.rescueT, w = this.players[this.winnerPid], hp = this.layout.helipad, heli = this.heli;
    if (!w) { this.gameOver(this.winnerPid, false); return; }
    // heli descends, hovers, then lifts
    if (t < 1.0) heli.z = lerp(230, 50, t / 1.0);
    else if (t < 2.2) { heli.z = 50; heli.phase = "hover"; }
    else { heli.phase = "lift"; heli.z = lerp(50, 200, clamp((t - 2.2) / 2.2, 0, 1)); }
    // winner walks to pad, rises on the rope, lifts away
    if (t < 0.9) { w.x = lerp(w.x, hp.x, Math.min(1, dt * 5)); w.y = lerp(w.y, hp.y, Math.min(1, dt * 5)); }
    else if (t < 2.2) w.riseZ = lerp(0, 34, (t - 0.9) / 1.3);
    else { w.riseZ = heli.z - 14; w.x = lerp(w.x, heli.x - 3, Math.min(1, dt * 8)); }
    if (t >= 4.4) this.gameOver(this.winnerPid, false);
  };
  Sim.prototype.gameOver = function (winnerPid, lost) {
    if (this.phase === "over") return;
    this.phase = "over";
    this.winnerPid = winnerPid || null;
    this.lost = !!lost;
    if (winnerPid && this.players[winnerPid]) this.winnerName = this.players[winnerPid].name;
    this.emit({ t: "gameOver", winnerPid: this.winnerPid, winnerName: this.winnerName, lost: this.lost });
  };

  Sim.prototype.updateBananas = function (dt) {
    var i, j, id;
    // counter: each player with an active window deflects nearby foreign bananas
    for (id in this.players) {
      var pl = this.players[id];
      if (pl.counterT <= 0 || !pl.alive) continue;
      for (i = 0; i < this.bananas.length; i++) {
        var b = this.bananas[i];
        if (b.dead || b.owner === pl.id) continue;
        if (dist(b.x, b.y, pl.x, pl.y - 8) > CONFIG.PLAYER.COUNTER_RADIUS) continue;
        var wasReturned = b.returned;
        b.owner = pl.id; b.countered = true; b.returned = false;
        b.speed *= CONFIG.BANANA.COUNTER_SPEED_MULT;
        b.dmg = CONFIG.BANANA.DMG * CONFIG.BANANA.COUNTER_DMG_MULT;
        var tgt = this.nearestEnemy(b.x, b.y, pl.id), tx, ty;
        if (tgt) { tx = tgt.ent.x; ty = tgt.ent.y - 6; }
        else { tx = b.x + Math.cos(pl.input.aim) * 120; ty = b.y + Math.sin(pl.input.aim) * 120; }
        var ang = angTo(b.x, b.y, tx, ty);
        b.vx = Math.cos(ang); b.vy = Math.sin(ang);
        b.traveled = 0; b.maxD = clamp(dist(b.x, b.y, tx, ty) + 10, 60, 330); b.arc = 7;
        var v = pl.addScore(CONFIG.SCORE.COUNTER); pl.bumpCombo();
        this.emit({ t: "counter", pid: pl.id, x: pl.x, y: pl.y, perfect: wasReturned, score: v });
        this.emit({ t: "floater", x: pl.x, y: pl.y - 26, text: "COUNTER! +" + v, color: "#ffe680" });
        this.emit({ t: "shake", pid: pl.id, amt: 2 });
        pl.counterT = 0;
        break;
      }
    }

    for (i = this.bananas.length - 1; i >= 0; i--) {
      var bn = this.bananas[i];
      bn.update(dt);
      if (!bn.dead) {
        var ownerPlayer = this.players[bn.owner];   // null if 'm'
        if (ownerPlayer || bn.owner !== "m") {
          // player-owned: hit monkeys, then rival players, then chests
          var hit = false;
          for (j = 0; j < this.monkeys.length && !hit; j++) {
            var mk = this.monkeys[j];
            if (!mk.alive()) continue;
            if (dist(bn.x, bn.y, mk.x, mk.y - mk.height * 0.5) < (mk.type === "alpha" ? 11 : 8)) {
              if (!bn.countered && mk.canCatch() && Math.random() < mk.stats.catch) { mk.catchBanana(bn.owner); bn.dead = true; }
              else { mk.hurtBy(bn.dmg, bn.x, bn.y, bn.owner); bn.impact(bn.countered); }
              hit = true;
            }
          }
          if (!hit) {
            for (id in this.players) {
              var tp = this.players[id];
              if (id === bn.owner || !tp.alive || tp.hidden) continue;
              if (dist(bn.x, bn.y, tp.x, tp.y - 8) < 8) {
                var dmg = bn.countered ? Math.round(CONFIG.MP.PVP_BANANA_DMG * CONFIG.BANANA.COUNTER_DMG_MULT)
                                       : CONFIG.MP.PVP_BANANA_DMG;
                if (tp.hurt(dmg, bn.x, bn.y, bn.owner)) { bn.impact(true); hit = true; break; }
              }
            }
          }
          if (!hit) {
            for (j = 0; j < this.chests.length; j++) {
              var ch = this.chests[j];
              if (ch.state === "open") continue;
              if (dist(bn.x, bn.y, ch.x, ch.y - 5) < 11) { ch.hit(bn); bn.impact(); break; }
            }
          }
        } else {
          // monkey-owned: hit any player
          for (id in this.players) {
            var vp = this.players[id];
            if (!vp.alive || vp.hidden) continue;
            if (dist(bn.x, bn.y, vp.x, vp.y - 8) < 8) {
              if (!vp.invulnerable()) { vp.hurt(bn.dmg, bn.x, bn.y, null); bn.impact(true); }
              break;
            }
          }
        }
      }
      if (bn.dead) this.bananas.splice(i, 1);
    }
  };

  Sim.prototype.step = function (dt) {
    this.events.length = 0;
    if (this.phase === "over") { this.tick++; return this.events; }
    this.time += dt;
    this.dayT += dt / CONFIG.DAY_LENGTH;
    this.tick++;

    var id, i;
    for (id in this.players) this.players[id].update(dt);
    for (i = this.monkeys.length - 1; i >= 0; i--) {
      var m = this.monkeys[i]; m.update(dt);
      if (m.state === "dead" && m.deadT > 5.5) this.monkeys.splice(i, 1);
    }
    for (i = 0; i < this.chests.length; i++) { /* chests are static in sim now */ }
    for (i = this.pickups.length - 1; i >= 0; i--) {
      this.pickups[i].update(dt);
      if (this.pickups[i].dead) this.pickups.splice(i, 1);
    }
    this.updateBananas(dt);
    if (this.phase === "rescue") this.updateRescue(dt);
    return this.events;
  };

  /* ---- snapshot: plain data for the renderer / network ---- */
  Sim.prototype.snapshot = function () {
    var players = [], monkeys = [], bananas = [], pickups = [], chests = [], id, i;
    for (id in this.players) {
      var p = this.players[id];
      players.push({
        id: p.id, slot: p.slot, name: p.name, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
        hp: p.hp, maxHp: p.maxHp, stamina: Math.round(p.stamina), facing: p.facing,
        moving: p.moving, slideT: p.slideT, hurtT: p.hurtT, counterT: p.counterT, goldT: p.goldT,
        cooldown: p.cooldown, parts: p.parts, partIds: p.partIds.slice(), alive: p.alive,
        respawnT: p.respawnT === Infinity ? -1 : p.respawnT, building: p.building, buildT: p.buildT,
        hidden: p.hidden, riseZ: p.riseZ, score: p.score, kills: p.kills, combo: p.combo
      });
    }
    for (i = 0; i < this.monkeys.length; i++) {
      var mk = this.monkeys[i];
      monkeys.push({ id: mk.id, x: Math.round(mk.x * 10) / 10, y: Math.round(mk.y * 10) / 10, type: mk.type,
        state: mk.state, stateT: mk.stateT, facing: mk.facing, moving: mk.moving, hp: mk.hp, hitT: mk.hitT, deadT: mk.deadT });
    }
    for (i = 0; i < this.bananas.length; i++) {
      var b = this.bananas[i];
      bananas.push({ id: b.id, x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, vx: b.vx, vy: b.vy,
        speed: b.speed, owner: b.owner, returned: b.returned, countered: b.countered, traveled: b.traveled, maxD: b.maxD, arc: b.arc });
    }
    for (i = 0; i < this.pickups.length; i++) {
      var pk = this.pickups[i];
      pickups.push({ id: pk.id, x: Math.round(pk.x * 10) / 10, y: Math.round(pk.y * 10) / 10, z: Math.round(pk.z), type: pk.type, partId: pk.partId });
    }
    for (i = 0; i < this.chests.length; i++) chests.push({ id: this.chests[i].id, state: this.chests[i].state });
    return {
      tick: this.tick, phase: this.phase, winnerPid: this.winnerPid, winnerName: this.winnerName, lost: this.lost,
      rescueT: this.rescueT, radioActive: this.radioActive, dayT: this.dayT, time: this.time,
      players: players, monkeys: monkeys, bananas: bananas, pickups: pickups, chests: chests,
      heli: this.heli ? { x: this.heli.x, y: this.heli.y, z: Math.round(this.heli.z), phase: this.heli.phase } : null
    };
  };

  // expose constructors for tests / advanced use
  Sim.FLAG = FLAG;
  Sim.Player = Player; Sim.Monkey = Monkey; Sim.Banana = Banana;
  Sim.Chest = Chest; Sim.Pickup = Pickup;
  return { Sim: Sim, FLAG: FLAG };
});
