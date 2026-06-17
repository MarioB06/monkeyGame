/* ============================================================================
   RENDER -- draws one (already-interpolated) snapshot. BROWSER ONLY.
   Exposes window.Renderer. Mode-agnostic: offline passes the live sim
   snapshot, online passes the interpolated network snapshot.
   ========================================================================== */
(function (root) {
  "use strict";
  var CONFIG = root.CONFIG, M = root.MathUtils, SPR = root.SPR;
  var px = root.px, blob = root.blob, drawText = root.drawText, drawTextShadow = root.drawTextShadow;
  var clamp = M.clamp, dist = M.dist, angTo = M.angTo, lerp = M.lerp;

  function Renderer(canvas, layout, fx, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.layout = layout;
    this.fx = fx;
    this.ui = ui || null;
    // precompute static object sprites once
    this.objects = layout.objects.map(function (o) {
      return { spr: SPR.objSprite(o), x: o.x, y: o.y, sortY: o.y };
    }).filter(function (e) { return e.spr; });
  }

  Renderer.prototype.shadow = function (g, x, y, w, alpha) {
    g.globalAlpha = alpha; blob(g, x, y + 1, w * 0.5, w * 0.17 + 1, "#06140a"); g.globalAlpha = 1;
  };

  // pick a player animation frame from snapshot fields + clock
  function playerSprite(p, tNow, isWinner) {
    var set = SPR.players[p.slot] || SPR.player;
    if (isWinner && p.riseZ > 2) return set.rise;
    if (p.slideT > 0) return set.slide;
    if (p.hurtT > CONFIG.PLAYER.IFRAMES - 0.3) return set.hurt;
    if (p.counterT > 0.02) return set.counter;
    var maxCd = p.goldT > 0 ? CONFIG.PLAYER.FAST_THROW_CD : CONFIG.PLAYER.THROW_CD;
    if (p.cooldown > maxCd - 0.16) return set.throwF;
    if (p.moving) return set.run[Math.floor(tNow * 10) % 4];
    return set.idle[Math.floor(tNow * 2.2) % 2];
  }

  Renderer.prototype.draw = function (snap, localPid, mouse, tNow) {
    var g = this.ctx, cam = this.fx.camera, layout = this.layout, self = this, i;
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#0a120c"; g.fillRect(0, 0, CONFIG.VIEW_W, CONFIG.VIEW_H);

    var camX = Math.round(cam.x + cam.sx), camY = Math.round(cam.y + cam.sy);
    var local = null;
    for (i = 0; i < snap.players.length; i++) if (snap.players[i].id === localPid) local = snap.players[i];

    g.save();
    g.translate(-camX, -camY);

    // ground
    g.drawImage(layout.groundCanvas, 0, 0);

    // animated grass tufts (in view)
    for (i = 0; i < layout.tufts.length; i++) {
      var tf = layout.tufts[i];
      if (tf.x < camX - 8 || tf.x > camX + CONFIG.VIEW_W + 8 || tf.y < camY - 8 || tf.y > camY + CONFIG.VIEW_H + 8) continue;
      g.drawImage(SPR.grass[Math.floor(tNow * 2 + tf.phase) % 2], Math.round(tf.x), Math.round(tf.y - 5));
    }

    this.fx.particles.draw(g, 0);

    // shadows
    for (i = 0; i < snap.players.length; i++) if (snap.players[i].alive) this.shadow(g, snap.players[i].x, snap.players[i].y, 12, 0.3);
    for (i = 0; i < snap.monkeys.length; i++) { var mm = snap.monkeys[i]; if (mm.state !== "dead") this.shadow(g, mm.x, mm.y, mm.type === "alpha" ? 16 : 10, 0.28); }
    for (i = 0; i < snap.bananas.length; i++) this.shadow(g, snap.bananas[i].x, snap.bananas[i].y, 5, 0.22);
    for (i = 0; i < snap.pickups.length; i++) this.shadow(g, snap.pickups[i].x, snap.pickups[i].y, 6, 0.2);
    if (snap.heli) { var k = clamp(1 - snap.heli.z / 450, 0.25, 1); g.globalAlpha = 0.28 * k; blob(g, snap.heli.x, snap.heli.y, 30 * (0.5 + k * 0.5), 30 * (0.5 + k * 0.5) * 0.3, "#06140a"); g.globalAlpha = 1; }

    // build y-sorted draw list
    var draws = [];
    var view = { l: camX - 80, r: camX + CONFIG.VIEW_W + 80, t: camY - 120, b: camY + CONFIG.VIEW_H + 80 };
    function inView(x, y) { return x > view.l && x < view.r && y > view.t && y < view.b; }
    for (i = 0; i < this.objects.length; i++) { var o = this.objects[i]; if (inView(o.x, o.y)) draws.push({ sortY: o.y, kind: "obj", e: o }); }
    for (i = 0; i < snap.chests.length; i++) { var sp = layout.chestSpots[i]; if (sp && inView(sp.x, sp.y)) draws.push({ sortY: sp.y, kind: "chest", e: snap.chests[i], sp: sp }); }
    for (i = 0; i < snap.pickups.length; i++) draws.push({ sortY: snap.pickups[i].y, kind: "pickup", e: snap.pickups[i] });
    for (i = 0; i < snap.monkeys.length; i++) { var m2 = snap.monkeys[i]; if (inView(m2.x, m2.y)) draws.push({ sortY: m2.y, kind: "monkey", e: m2 }); }
    for (i = 0; i < snap.players.length; i++) draws.push({ sortY: snap.players[i].y, kind: "player", e: snap.players[i] });
    for (i = 0; i < snap.bananas.length; i++) draws.push({ sortY: snap.bananas[i].y, kind: "banana", e: snap.bananas[i] });
    draws.sort(function (a, b) { return a.sortY - b.sortY; });

    for (i = 0; i < draws.length; i++) {
      var d = draws[i], e = d.e;
      if (d.kind === "obj") g.drawImage(e.spr, Math.round(e.x - e.spr.width / 2), Math.round(e.y - e.spr.height));
      else if (d.kind === "chest") { var cs = SPR.chest[e.state] || SPR.chest.closed; g.drawImage(cs, Math.round(d.sp.x - cs.width / 2), Math.round(d.sp.y - cs.height + 1)); }
      else if (d.kind === "pickup") this.drawPickup(g, e, tNow);
      else if (d.kind === "monkey") this.drawMonkey(g, e, tNow);
      else if (d.kind === "player") this.drawPlayer(g, e, snap, localPid, tNow);
      else if (d.kind === "banana") this.drawBanana(g, e, tNow);
    }

    this.fx.particles.draw(g, 1);

    // radio tower beacon
    var tw = layout.towerTop;
    var blinkOn = snap.radioActive ? (tNow * 4) % 1 < 0.5 : (tNow * 0.9) % 1 < 0.12;
    if (blinkOn) { px(g, tw.x - 2, tw.y - 2, 3, 3, "#ff4a3a"); g.globalAlpha = 0.25; px(g, tw.x - 5, tw.y - 5, 9, 9, "#ff4a3a"); g.globalAlpha = 1; }

    if (snap.heli) this.drawHeli(g, snap.heli, snap, tNow);
    this.drawGlows(g, snap, tNow);
    this.drawWorldUI(g, snap, local, tNow);

    g.restore();

    /* ----- screen space ----- */
    var night = this.fx.nightK(snap.dayT);
    if (night > 0.02) { g.fillStyle = "rgba(16, 22, 52," + (night * 0.30).toFixed(3) + ")"; g.fillRect(0, 0, CONFIG.VIEW_W, CONFIG.VIEW_H); }
    if (this.fx.hurtFlash > 0) { g.fillStyle = "rgba(200,30,20," + (this.fx.hurtFlash * 0.4).toFixed(3) + ")"; g.fillRect(0, 0, CONFIG.VIEW_W, CONFIG.VIEW_H); }
    if (local && local.alive && local.hp <= 30 && snap.phase === "playing") {
      g.globalAlpha = 0.15 + Math.sin(tNow * 6) * 0.08; g.strokeStyle = "#d8483a"; g.lineWidth = 6;
      g.strokeRect(3, 3, CONFIG.VIEW_W - 6, CONFIG.VIEW_H - 6); g.globalAlpha = 1;
    }
    this.drawObjectiveArrow(g, snap, local, tNow);
    if (mouse && snap.phase === "playing") g.drawImage(SPR.crosshair, Math.round(mouse.x) - 4, Math.round(mouse.y) - 4);

    // rescue white-out
    if (snap.phase === "rescue") {
      var fw = clamp((snap.rescueT - 2.6) / 1.6, 0, 1);
      if (fw > 0) { g.fillStyle = "rgba(245,250,240," + fw.toFixed(3) + ")"; g.fillRect(0, 0, CONFIG.VIEW_W, CONFIG.VIEW_H); }
    }

    // DOM HUD from local player
    if (this.ui && local) {
      var cdMax = local.goldT > 0 ? CONFIG.PLAYER.FAST_THROW_CD : CONFIG.PLAYER.THROW_CD;
      this.ui.setBars(local.hp / local.maxHp, local.stamina / CONFIG.PLAYER.STAMINA, 1 - local.cooldown / cdMax, local.goldT > 0);
      this.ui.setParts(local.parts, CONFIG.PART_TOTAL);
      this.ui.setScore(local.score);
      this.ui.setCombo(local.combo);
    }
  };

  Renderer.prototype.drawPlayer = function (g, p, snap, localPid, tNow) {
    if (!p.alive) return;                         // hidden while dead/respawning
    if (p.hidden) {
      // concealed: rivals see nothing (only the rustle in fx). You see yourself
      // faded up in the canopy so you know you're hidden.
      if (p.id === localPid) {
        var set = SPR.players[p.slot] || SPR.player, spr = set.idle[0];
        g.globalAlpha = 0.45;
        g.drawImage(spr, Math.round(p.x - spr.width / 2), Math.round(p.y - 46 - spr.height + 1));
        g.globalAlpha = 1;
        drawTextShadow(g, "HIDDEN", p.x, p.y - 58, "#9adf8a", 1, 0.5);
      }
      return;
    }
    var isWinner = snap.phase === "rescue" && snap.winnerPid === p.id;
    if (p.hurtT > 0 && Math.floor(tNow * 18) % 2 === 0 && snap.phase === "playing") {
      // blink, but still show tags below
    } else {
      var spr = playerSprite(p, tNow, isWinner);
      var dx = Math.round(p.x), dy = Math.round(p.y - p.riseZ);
      g.save(); g.translate(dx, dy); if (p.facing < 0) g.scale(-1, 1);
      g.drawImage(spr, Math.round(-spr.width / 2), -spr.height + 1); g.restore();
      if (p.counterT > 0.02) {
        var kk = p.counterT / CONFIG.PLAYER.COUNTER_WINDOW;
        g.globalAlpha = kk; g.strokeStyle = "#f0f0d0"; g.lineWidth = 2;
        g.beginPath(); g.arc(dx, dy - 10, 14, -0.9, 0.9); g.stroke(); g.globalAlpha = 1;
      }
    }
    // name + tiny HP tag for OTHER players (and parts pips)
    if (p.id !== localPid) {
      var col = (CONFIG.PLAYER_COLORS[p.slot] || { band: "#fff" }).band;
      drawTextShadow(g, p.name, p.x, p.y - 30, col, 1, 0.5);
      var bw = 16, bx = Math.round(p.x - bw / 2), by = Math.round(p.y - 26);
      px(g, bx - 1, by - 1, bw + 2, 3, "#16100a");
      px(g, bx, by, Math.round(bw * clamp(p.hp / p.maxHp, 0, 1)), 1, "#d8483a");
    }
    if (p.parts > 0) drawTextShadow(g, p.parts + "/" + CONFIG.PART_TOTAL, p.x, p.y - (p.id !== localPid ? 38 : 30), "#7ae08a", 1, 0.5);
    // build bar
    if (p.building) {
      var k2 = clamp(p.buildT / CONFIG.BUILD_TIME, 0, 1);
      var qx = Math.round(p.x - 16), qy = Math.round(p.y - 36);
      px(g, qx - 1, qy - 1, 34, 7, "#16100a"); px(g, qx, qy, 32, 5, "#3a3226"); px(g, qx + 1, qy + 1, Math.round(30 * k2), 3, "#7ae08a");
      drawTextShadow(g, "BUILDING", p.x, qy - 8, "#fff8d0", 1, 0.5);
    }
  };

  Renderer.prototype.drawMonkey = function (g, m, tNow) {
    var S = SPR.monkey[m.type], spr;
    var t = tNow + m.id * 0.7;
    var height = m.type === "alpha" ? 20 : 13;
    if (m.state === "dead") {
      var fade = clamp(1 - (m.deadT - 4) / 1.5, 0, 1);
      g.globalAlpha = fade; spr = S.dead;
      g.drawImage(spr, Math.round(m.x - spr.width / 2), Math.round(m.y - spr.height + 1)); g.globalAlpha = 1; return;
    }
    if (m.hitT > 0) spr = (Math.floor(t * 24) % 2) ? S.hitFlash : S.hit;
    else if (m.state === "windup") spr = S.windup;
    else if (m.state === "throwing") spr = S.throwF;
    else if (m.state === "hold") spr = S.hold;
    else if (m.moving) spr = S.walk[Math.floor(t * 8) % 2];
    else spr = S.idle[Math.floor(t * 2.5) % 2];
    g.save(); g.translate(Math.round(m.x), Math.round(m.y)); if (m.facing < 0) g.scale(-1, 1);
    g.drawImage(spr, Math.round(-spr.width / 2), -spr.height + 1); g.restore();
    if (m.state === "hold") g.drawImage(SPR.bananaR, Math.round(m.x - 4), Math.round(m.y - height - 9 + Math.sin(t * 10) * 1.5));
    if (m.state === "windup") drawTextShadow(g, "!", m.x - 1, m.y - height - 12, "#f05a3a", 1, 0);
  };

  Renderer.prototype.drawBanana = function (g, b, tNow) {
    var spr = b.countered ? SPR.bananaG : (b.returned ? SPR.bananaR : SPR.banana);
    var p = clamp(b.traveled / b.maxD, 0, 1);
    var z = lerp(9, 1, p) + (b.arc || 12) * 4 * p * (1 - p);
    var rot = tNow * 13 + b.id;
    g.save(); g.translate(Math.round(b.x), Math.round(b.y - z));
    g.rotate(Math.round(rot / 0.785) * 0.785); g.drawImage(spr, -5, -5); g.restore();
  };

  Renderer.prototype.drawPickup = function (g, pk, tNow) {
    var spr = pk.type === "part" ? SPR.part : pk.type === "heart" ? SPR.heart : pk.type === "star" ? SPR.star : SPR.gban;
    var t = tNow + pk.id;
    var bob = pk.z > 0 ? 0 : Math.sin(t * 4) * 1.5;
    var dy = Math.round(pk.y - pk.z - spr.height - 2 + bob);
    g.drawImage(spr, Math.round(pk.x - spr.width / 2), dy);
    if (pk.type === "part" && Math.floor(t * 3) % 2 === 0) px(g, pk.x - 2, dy + 4, 1, 1, "#ff8a7a");
    if (pk.type === "gban") { g.globalAlpha = 0.25 + Math.sin(t * 5) * 0.1; g.fillStyle = "#ffe680"; g.fillRect(Math.round(pk.x - 6), dy - 2, 12, 12); g.globalAlpha = 1; }
  };

  Renderer.prototype.drawHeli = function (g, h, snap, tNow) {
    var bobX = Math.sin(tNow * 1.7) * 3, bobZ = Math.sin(tNow * 2.3) * 2;
    var hx = Math.round(h.x + bobX), hy = Math.round(h.y - h.z + bobZ);
    if (h.phase !== "enter") {
      var winner = null;
      for (var i = 0; i < snap.players.length; i++) if (snap.players[i].id === snap.winnerPid) winner = snap.players[i];
      g.strokeStyle = "#d8d0b8"; g.lineWidth = 1; g.beginPath();
      g.moveTo(hx - 3, hy + 6); g.lineTo(hx - 3, Math.round(h.y - (winner ? winner.riseZ : 0) - 14)); g.stroke();
    }
    g.drawImage(SPR.heli, hx - 28, hy - 12);
    var rw = Math.abs(Math.sin(tNow * 26)) * 30 + 6;
    px(g, hx - 8 - rw, hy - 14, rw * 2, 2, "#2a2a24"); px(g, hx - 8 - rw * 0.7, hy - 15, rw * 1.4, 1, "#46464a");
    var tr = Math.abs(Math.sin(tNow * 31)) * 5 + 1;
    px(g, hx + 17, hy - 5 - tr, 2, tr * 2, "#2a2a24");
  };

  Renderer.prototype.drawGlows = function (g, snap, tNow) {
    var night = this.fx.nightK(snap.dayT), i;
    g.save(); g.globalCompositeOperation = "lighter";
    if (night > 0.1) for (i = 0; i < this.layout.lamps.length; i++) {
      var L = this.layout.lamps[i];
      g.globalAlpha = 0.07 * night * (0.85 + Math.sin(tNow * 7 + i * 2) * 0.15); g.fillStyle = "#f0d03a";
      g.beginPath(); g.arc(L.x, L.y, 17, 0, 6.283); g.fill();
      g.globalAlpha = 0.22 * night; g.fillRect(L.x - 2, L.y - 2, 4, 4);
    }
    for (i = 0; i < this.layout.fires.length; i++) {
      var f = this.layout.fires[i];
      g.globalAlpha = 0.10 + Math.sin(tNow * 11 + i) * 0.03 + night * 0.08; g.fillStyle = "#f0a03a";
      g.beginPath(); g.arc(f.x, f.y - 3, 13, 0, 6.283); g.fill();
    }
    g.restore(); g.globalAlpha = 1;
  };

  Renderer.prototype.drawWorldUI = function (g, snap, local, tNow) {
    var i;
    for (i = 0; i < this.fx.floaters.length; i++) {
      var f = this.fx.floaters[i];
      g.globalAlpha = clamp(1.4 - f.t / f.life * 1.4, 0, 1);
      drawTextShadow(g, f.text, f.x, f.y - f.t * 22, f.color, f.scale, 0.5);
    }
    g.globalAlpha = 1;
    if (!local || !local.alive || snap.phase !== "playing") return;
    var st = this.layout.station;
    // station prompt
    if (dist(local.x, local.y, st.doorX, st.doorY) < 40) {
      var label = local.parts >= CONFIG.PART_TOTAL ? "HOLD E: BUILD SIGNAL" : "PARTS " + local.parts + "/" + CONFIG.PART_TOTAL;
      drawTextShadow(g, label, st.doorX, st.doorY - 44, "#fff8d0", 1, 0.5);
    }
    for (i = 0; i < snap.chests.length; i++) {
      var c = snap.chests[i], sp = this.layout.chestSpots[i];
      if (c.state !== "open" && sp && dist(local.x, local.y, sp.x, sp.y) < 30) drawTextShadow(g, "BONK IT!", sp.x, sp.y - 24, "#f0d03a", 1, 0.5);
    }
    // hide-tree prompts
    if (local.hidden) {
      drawTextShadow(g, "E: CLIMB DOWN", local.x, local.y - 50, "#9adf8a", 1, 0.5);
    } else {
      var ht = this.layout.hideTrees;
      for (i = 0; i < ht.length; i++)
        if (dist(local.x, local.y, ht[i].x, ht[i].y) < 24) { drawTextShadow(g, "E: HIDE IN TREE", ht[i].x, ht[i].y - 36, "#9adf8a", 1, 0.5); break; }
    }
  };

  Renderer.prototype.objectiveTarget = function (snap, local) {
    if (!local || snap.phase !== "playing") return null;
    if (snap.radioActive) return null;
    if (local.parts >= CONFIG.PART_TOTAL) return { x: this.layout.station.doorX, y: this.layout.station.doorY };
    // nearest unopened part chest, else nearest part pickup
    var best = null, bd = 1e9, i;
    for (i = 0; i < snap.chests.length; i++) {
      var c = snap.chests[i], sp = this.layout.chestSpots[i];
      if (!sp || c.state === "open" || sp.bonus) continue;
      var d = dist(local.x, local.y, sp.x, sp.y); if (d < bd) { bd = d; best = { x: sp.x, y: sp.y, sub: true }; }
    }
    if (!best) for (i = 0; i < snap.pickups.length; i++) if (snap.pickups[i].type === "part") return { x: snap.pickups[i].x, y: snap.pickups[i].y, sub: true };
    return best;
  };
  Renderer.prototype.drawObjectiveArrow = function (g, snap, local, tNow) {
    var tg = this.objectiveTarget(snap, local); if (!tg) return;
    var cam = this.fx.camera;
    var sx = tg.x - cam.x, sy = tg.y - cam.y;
    if (sx > 16 && sx < CONFIG.VIEW_W - 16 && sy > 16 && sy < CONFIG.VIEW_H - 16) return;
    var cx = CONFIG.VIEW_W / 2, cy = CONFIG.VIEW_H / 2, dx = sx - cx, dy = sy - cy;
    var kx = dx !== 0 ? (cx - 18) / Math.abs(dx) : 1e9, ky = dy !== 0 ? (cy - 18) / Math.abs(dy) : 1e9;
    var k = Math.min(kx, ky, 1), ax = cx + dx * k, ay = cy + dy * k;
    g.save(); g.globalAlpha = (tg.sub ? 0.45 : 0.8) + Math.sin(tNow * 5) * 0.15;
    g.translate(Math.round(ax), Math.round(ay)); g.rotate(Math.atan2(dy, dx) + Math.PI / 2);
    g.drawImage(SPR.arrow, -5, -5); g.restore(); g.globalAlpha = 1;
  };

  root.Renderer = Renderer;
})(typeof window !== "undefined" ? window : this);
