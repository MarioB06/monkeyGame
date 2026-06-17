/* ============================================================================
   FX -- client-side effect engine. BROWSER ONLY. Exposes window.Particles,
   window.Camera, window.FX.

   The simulation is silent; this layer turns its event stream into sound,
   particles, floating text, screen shake and the hurt flash -- all gated to
   the LOCAL player where appropriate (your screen shakes when YOU get hit).
   It also generates the continuous/ambient cosmetics (leaves, fireflies,
   campfires, banana trails, chest sparkles, rotor wash) directly from the
   snapshot, so those never travel over the network.
   ========================================================================== */
(function (root) {
  "use strict";
  var CONFIG = root.CONFIG, M = root.MathUtils, SPR = root.SPR, AudioSys = root.AudioSys;
  var clamp = M.clamp, lerp = M.lerp, dist = M.dist, rand = M.rand, pick = M.pick, angTo = M.angTo;

  /* ---------------- Particles ---------------- */
  function Particles() { this.list = []; }
  Particles.prototype.add = function (p) {
    p.t = 0; p.life = p.life || 0.6; p.kind = p.kind || "px";
    p.layer = p.layer === 0 ? 0 : 1; p.size = p.size || 2;
    p.vx = p.vx || 0; p.vy = p.vy || 0; p.z = p.z || 0; p.vz = p.vz || 0;
    p.grav = p.grav || 0; p.phase = Math.random() * 6.28;
    if (this.list.length < 700) this.list.push(p);
  };
  Particles.prototype.burst = function (x, y, n, opts) {
    opts = opts || {};
    for (var i = 0; i < n; i++) {
      var a = rand(0, 6.283), sp = rand(opts.spMin || 20, opts.spMax || 70);
      this.add({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6,
        z: opts.z || 4, vz: rand(20, 60), grav: 160, life: rand(0.25, opts.life || 0.6),
        size: opts.size || 2, col: opts.cols ? pick(opts.cols) : (opts.col || "#f2d23c"),
        kind: opts.kind || "px", layer: 1 });
    }
  };
  Particles.prototype.update = function (dt) {
    var l = this.list;
    for (var i = l.length - 1; i >= 0; i--) {
      var p = l[i]; p.t += dt;
      if (p.t >= p.life) { l.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.grav) p.vz -= p.grav * dt;
      p.z += p.vz * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.4; if (Math.abs(p.vz) < 8) p.vz = 0; }
      if (p.kind === "leaf") p.x += Math.sin(p.t * 5 + p.phase) * 14 * dt;
    }
  };
  Particles.prototype.draw = function (g, layer) {
    var l = this.list;
    for (var i = 0; i < l.length; i++) {
      var p = l[i]; if (p.layer !== layer) continue;
      var k = 1 - p.t / p.life;
      if (p.kind === "ring") {
        g.globalAlpha = k * 0.8; g.strokeStyle = p.col; g.lineWidth = p.lw || 1;
        g.beginPath(); g.arc(p.x, p.y, (p.r0 || 2) + (p.r1 || 30) * (p.t / p.life), 0, 6.283); g.stroke();
        g.globalAlpha = 1;
      } else if (p.kind === "smoke") {
        g.globalAlpha = k * 0.35; var s = p.size + p.t * 8; g.fillStyle = p.col || "#888880";
        g.fillRect(p.x - s / 2, p.y - p.z - s / 2, s, s); g.globalAlpha = 1;
      } else if (p.kind === "leaf") {
        g.globalAlpha = Math.min(1, k * 2); g.fillStyle = p.col;
        var tumble = Math.sin(p.t * 9 + p.phase) > 0;
        g.fillRect(p.x, p.y - p.z, tumble ? 2 : 1, tumble ? 1 : 2); g.globalAlpha = 1;
      } else {
        g.globalAlpha = p.kind === "spark" ? k : Math.min(1, k * 1.6); g.fillStyle = p.col;
        var sz = Math.max(1, Math.round(p.size * (p.kind === "spark" ? 1 : k)));
        g.fillRect(Math.round(p.x - sz / 2), Math.round(p.y - p.z - sz / 2), sz, sz); g.globalAlpha = 1;
      }
    }
  };

  /* ---------------- Camera ---------------- */
  function Camera() { this.x = 0; this.y = 0; this.shake = 0; this.sx = 0; this.sy = 0; this.focus = null; }
  Camera.prototype.jumpTo = function (x, y) {
    this.x = clamp(x - CONFIG.VIEW_W / 2, 0, CONFIG.WORLD_W - CONFIG.VIEW_W);
    this.y = clamp(y - CONFIG.VIEW_H / 2, 0, CONFIG.WORLD_H - CONFIG.VIEW_H);
  };
  // follow {x,y}, looking a little toward the aim world-point {ax,ay}
  Camera.prototype.follow = function (dt, x, y, ax, ay) {
    var tx, ty;
    if (this.focus) { tx = this.focus.x; ty = this.focus.y; }
    else {
      tx = x + clamp(ax - x, -160, 160) / 160 * CONFIG.CAMERA_LOOKAHEAD;
      ty = y + clamp(ay - y, -100, 100) / 100 * CONFIG.CAMERA_LOOKAHEAD * 0.7;
    }
    var k = Math.min(1, dt * CONFIG.CAMERA_LERP);
    this.x = lerp(this.x, clamp(tx - CONFIG.VIEW_W / 2, 0, CONFIG.WORLD_W - CONFIG.VIEW_W), k);
    this.y = lerp(this.y, clamp(ty - CONFIG.VIEW_H / 2, 0, CONFIG.WORLD_H - CONFIG.VIEW_H), k);
    this.shake = Math.max(0, this.shake - dt * 14);
    var a = this.shake; this.sx = rand(-a, a); this.sy = rand(-a, a);
  };
  Camera.prototype.addShake = function (a) { this.shake = Math.min(7, this.shake + a); };

  /* ---------------- FX engine ---------------- */
  function FX(layout, localPid, ui) {
    this.layout = layout;
    this.localPid = localPid;
    this.ui = ui || null;
    this.particles = new Particles();
    this.camera = new Camera();
    this.floaters = [];
    this.hurtFlash = 0;
    this.leafT = 0; this.fireT = 0; this.fireflyT = 0; this.signalT = 0; this.beepT = 0;
    this.sparkT = {};            // chest id -> sparkle timer
  }
  FX.prototype.setLocal = function (pid) { this.localPid = pid; };
  FX.prototype.addFloater = function (x, y, text, color, scale) {
    this.floaters.push({ x: x, y: y, t: 0, life: 0.8, text: text, color: color || "#fff", scale: scale || 1 });
  };
  FX.prototype.nightK = function (dayT) {
    var phase = (dayT || 0) % 1;
    return clamp((Math.sin(phase * 6.283 - 1.5708) + 1) / 2, 0, 1);
  };

  // turn discrete sim events into sight + sound
  FX.prototype.applyEvents = function (events) {
    var P = this.particles, local = this.localPid, self = this, i;
    for (i = 0; i < events.length; i++) {
      var e = events[i];
      switch (e.t) {
        case "throw": AudioSys.sfx("throw"); break;
        case "slide": AudioSys.sfx("slide"); P.burst(e.x, e.y, 5, { cols: ["#9a8a6a", "#7a6a4a"], spMax: 40 }); break;
        case "counterWhiff": AudioSys.noise(0.06, 0.07, 2600); break;
        case "counter":
          AudioSys.sfx("counter");
          if (e.pid === local && this.ui) this.ui.msg(e.perfect ? "PERFECT COUNTER!" : "COUNTER!", "gold");
          break;
        case "monkeyThrow": AudioSys.sfx("mthrow"); break;
        case "monkeyCatch":
          AudioSys.sfx("catch"); this.addFloater(e.x, e.y - 10, "CAUGHT!", "#f0b03a");
          if (e.pid === local && this.ui) this.ui.msg("MONKEY CAUGHT YOUR BANANA!", "bad");
          break;
        case "monkeyHit":
          AudioSys.sfx("hitMonkey"); P.burst(e.x, e.y - 8, 6, { cols: ["#f2d23c", "#8a5a32"], spMax: 70 }); break;
        case "monkeyKilled":
          AudioSys.sfx("kill"); P.burst(e.x, e.y - 6, 10, { cols: ["#8a5a32", "#caa06a", "#fff"], spMax: 80 });
          if (e.mtype === "alpha" && this.ui) this.ui.msg("ALPHA MONKEY DEFEATED!", "gold"); break;
        case "alphaRoar":
          AudioSys.sfx("roar"); this.camera.addShake(2.5);
          if (this.ui) this.ui.msg("THE ALPHA IS AWAKE!", "bad"); break;
        case "bananaImpact": P.burst(e.x, e.y, e.big ? 8 : 5, { cols: ["#f2d23c", "#caa42c", "#fae88a"], spMax: e.big ? 90 : 55 }); break;
        case "bananaThunk": AudioSys.sfx("thunk"); P.burst(e.x, e.y, 4, { cols: ["#9a8a6a"], spMax: 40 }); break;
        case "melee": P.burst(e.x, e.y - 6, 4, { cols: ["#e8e0c8"], spMax: 50 }); break;
        case "chestHit": AudioSys.sfx("chestHit"); P.burst(e.x, e.y - 8, 5, { cols: ["#d8b03a", "#9aa0aa"], spMax: 60 }); break;
        case "chestOpen":
          AudioSys.sfx("chestOpen"); P.burst(e.x, e.y - 8, 14, { cols: ["#f0d03a", "#fff8d0", "#d8b03a"], spMax: 90, life: 0.9 });
          this.camera.addShake(1.2);
          if (this.ui) this.ui.msg(e.bonus ? "HIDDEN STASH!" : "CHEST CRACKED OPEN!", e.bonus ? "gold" : "good"); break;
        case "pickup":
          if (e.ptype === "part") { AudioSys.sfx("part"); P.burst(e.x, e.y - 6, 10, { cols: ["#7ae08a", "#fff8d0"], spMax: 70 }); }
          else if (e.ptype === "heart") AudioSys.sfx("heart");
          else if (e.ptype === "star") AudioSys.sfx("pickup");
          else if (e.ptype === "gban") AudioSys.sfx("power");
          if (e.pid === local && this.ui) {
            if (e.ptype === "part") {
              this.ui.setParts(e.partsNow, e.partTotal);
              this.ui.msg(e.partsNow >= e.partTotal ? "ALL PARTS! BUILD AT THE STATION" :
                "ELECTRONIC PART (" + e.partsNow + "/" + e.partTotal + ")", e.partsNow >= e.partTotal ? "gold" : "good");
            } else if (e.ptype === "gban") this.ui.msg("GOLDEN BANANA! RAPID THROWS", "gold");
          }
          break;
        case "playerHurt":
          AudioSys.sfx("hurt"); P.burst(e.x, e.y - 8, 7, { cols: ["#d8483a", "#8a2a1a"], spMax: 60 });
          if (e.pid === local) { this.hurtFlash = 0.45; this.camera.addShake(3); }
          break;
        case "playerKilled":
          AudioSys.sfx("kill"); P.burst(e.x, e.y - 6, 12, { cols: ["#d8483a", "#fff", "#8a2a1a"], spMax: 90 });
          this.addFloater(e.x, e.y - 18, (e.name || "PLAYER") + " DOWN!", "#f08a6a");
          if (this.ui) {
            if (e.pid === local) { this.ui.msg("YOU WERE BONKED! PARTS DROPPED", "bad"); this.hurtFlash = 0.7; }
            else if (e.killerPid === local) this.ui.msg("BONKED " + (e.name || "RIVAL") + "! GRAB THE PARTS", "gold");
          }
          break;
        case "respawn":
          AudioSys.sfx("power"); P.burst(e.x, e.y - 8, 8, { cols: ["#9adfe8", "#fff"], spMax: 70 });
          if (e.pid === local && this.ui) this.ui.msg("RESPAWNED", "good"); break;
        case "denied": if (e.pid === local) AudioSys.sfx("denied"); break;
        case "floater": this.addFloater(e.x, e.y, e.text, e.color); break;
        case "shake": if (e.pid === local) this.camera.addShake(e.amt || 1); break;
        case "buildTick": AudioSys.sfx("tick"); AudioSys.sfx("spark");
          P.add({ x: e.x + rand(-8, 8), y: e.y - rand(6, 20), vx: rand(-25, 25), vy: rand(-10, 10),
            z: 2, vz: rand(20, 50), grav: 140, life: 0.4, size: 1, col: pick(["#ffe680", "#9adfe8", "#fff"]), kind: "spark", layer: 1 }); break;
        case "buildDone": AudioSys.sfx("built"); this.camera.addShake(2); break;
        case "climb": AudioSys.noise(0.16, 0.10, 1400);
          P.add({ x: e.x, y: e.y - 30, vx: rand(-14, 14), vy: rand(4, 12), z: 6, life: 0.9, col: pick(["#3a7a36", "#4f9a44", "#caa84e"]), kind: "leaf", layer: 1 });
          P.burst(e.x, e.y - 24, 5, { cols: ["#3a7a36", "#4f9a44"], spMax: 40, life: 0.6 }); break;
        case "msg": if ((e.pid == null || e.pid === local) && this.ui) this.ui.msg(e.text, e.cls); break;
      }
    }
  };

  // continuous cosmetics derived from the snapshot (never networked)
  FX.prototype.updateAmbient = function (dt, snap) {
    var cam = this.camera, P = this.particles, i;
    // falling leaves
    this.leafT -= dt;
    if (this.leafT <= 0) {
      this.leafT = 0.3;
      P.add({ x: cam.x + rand(-20, CONFIG.VIEW_W + 20), y: cam.y + rand(-10, CONFIG.VIEW_H),
        vx: rand(-6, 14), vy: rand(6, 14), z: rand(24, 40), vz: -rand(9, 15), life: 2.6,
        col: pick(["#3a7a36", "#4f9a44", "#caa84e", "#2a5a2a"]), kind: "leaf", layer: 1 });
    }
    var night = this.nightK(snap ? snap.dayT : 0);
    this.fireflyT -= dt;
    if (night > 0.45 && this.fireflyT <= 0) {
      this.fireflyT = 0.35;
      P.add({ x: cam.x + rand(0, CONFIG.VIEW_W), y: cam.y + rand(0, CONFIG.VIEW_H), vx: rand(-8, 8), vy: rand(-5, 5),
        z: rand(6, 16), vz: rand(-3, 3), life: 2.2, size: 1, col: "#d8e87a", kind: "spark", layer: 1 });
    }
    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT = 0.12;
      for (i = 0; i < this.layout.fires.length; i++) {
        var f = this.layout.fires[i];
        P.add({ x: f.x + rand(-3, 3), y: f.y + 2, z: 2, vz: rand(12, 26), vx: rand(-3, 3), life: rand(0.3, 0.6),
          size: 2, col: pick(["#f0a03a", "#e06a2a", "#f0d03a"]), layer: 1 });
        if (Math.random() < 0.25) P.add({ x: f.x, y: f.y, z: 10, vz: 14, life: 1.1, size: 2, col: "#6a6a62", kind: "smoke", layer: 1 });
      }
    }
    if (!snap) return;
    // banana trails (returned / countered)
    for (i = 0; i < snap.bananas.length; i++) {
      var b = snap.bananas[i];
      if (!b.returned && !b.countered) continue;
      if (Math.random() < 0.6) {
        var z = lerp(9, 1, clamp(b.traveled / b.maxD, 0, 1)) + (b.arc || 12) * 4 * 0.2;
        P.add({ x: b.x, y: b.y - z, life: 0.3, size: 2, col: b.countered ? "#ffe680" : "#f08a3a", kind: "spark", layer: 1 });
      }
    }
    // chest sparkles (snapshot chest order matches layout.chestSpots order)
    for (i = 0; i < snap.chests.length; i++) {
      var c = snap.chests[i];
      if (c.state === "open") continue;
      var spot = this.layout.chestSpots[i];
      if (!spot) continue;
      this.sparkT[i] = (this.sparkT[i] != null ? this.sparkT[i] : rand(0, 3)) - dt;
      if (this.sparkT[i] <= 0) {
        this.sparkT[i] = rand(1.6, 3.2);
        P.add({ x: spot.x + rand(-7, 7), y: spot.y - rand(4, 12), vz: 14, z: 2, life: 0.5, size: 1, col: "#fff8d0", kind: "spark", layer: 1 });
      }
    }
    // slide smoke from sliding players + a faint leaf-rustle at occupied hide trees
    for (i = 0; i < snap.players.length; i++) {
      var pl = snap.players[i];
      if (pl.slideT > 0 && Math.random() < 0.6)
        P.add({ x: pl.x, y: pl.y, vx: rand(-16, 16), vy: 6, life: 0.4, size: 3, col: "#9a8a6a", kind: "smoke", layer: 1 });
      if (pl.hidden && Math.random() < 0.10)     // subtle hint that someone is up there
        P.add({ x: pl.x + rand(-8, 8), y: pl.y - 44, vx: rand(-5, 5), vy: rand(6, 12), z: 4, life: 0.9,
          col: pick(["#3a7a36", "#4f9a44"]), kind: "leaf", layer: 1 });
    }
    // radio signal rings + beep
    if (snap.radioActive) {
      this.signalT -= dt;
      if (this.signalT <= 0) { this.signalT = 0.55; var tw = this.layout.towerTop;
        P.add({ x: tw.x, y: tw.y, r0: 3, r1: 46, life: 1.1, col: "#7ae08a", kind: "ring", lw: 1, layer: 1 }); }
      this.beepT -= dt;
      if (this.beepT <= 0) { this.beepT = 1.4; AudioSys.sfx("beep"); }
    }
    // helicopter rotor wash
    if (snap.heli && snap.heli.z < 110) {
      var h = snap.heli;
      if (Math.random() < 0.5) P.add({ x: h.x + rand(-30, 30), y: h.y + rand(-14, 14), vx: rand(-60, 60), vy: rand(-25, 25),
        life: 0.5, size: 2, col: pick(["#9a8a6a", "#7a7a72", "#cac0a0"]), kind: "smoke", layer: 0 });
      if (Math.random() < 0.4) P.add({ x: h.x + rand(-40, 40), y: h.y + rand(-20, 20), vx: rand(-80, 80), vy: rand(-30, 30),
        z: rand(2, 14), vz: rand(10, 50), grav: 60, life: 0.8, col: pick(["#3a7a36", "#4f9a44", "#caa84e"]), kind: "leaf", layer: 1 });
      if (Math.random() < 0.12) P.add({ x: h.x, y: h.y, r0: 8, r1: 46, life: 0.7, col: "#b8b096", kind: "ring", lw: 1, layer: 0 });
    }
  };

  FX.prototype.update = function (dt) {
    this.particles.update(dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.4);
    for (var i = this.floaters.length - 1; i >= 0; i--) {
      this.floaters[i].t += dt;
      if (this.floaters[i].t > this.floaters[i].life) this.floaters.splice(i, 1);
    }
  };

  root.Particles = Particles;
  root.Camera = Camera;
  root.FX = FX;
})(typeof window !== "undefined" ? window : this);
