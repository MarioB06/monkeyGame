/* ============================================================================
   APP-OFFLINE -- single-player boot. Runs the Sim locally (mode 'sp'), feeds
   local input, consumes the event stream for FX, and renders. No server.
   Plays straight from file://. BROWSER ONLY.
   ========================================================================== */
(function (root) {
  "use strict";
  var CONFIG = root.CONFIG, M = root.MathUtils, SimMod = root.Sim, WorldGen = root.WorldGen, AudioSys = root.AudioSys;
  var clamp = M.clamp;
  var PID = "p1";

  function Game() {
    var self = this;
    this.canvas = document.getElementById("game-canvas");
    this.wrap = document.getElementById("game-wrap");
    root.buildSprites();
    this.layout = WorldGen.buildLayout(CONFIG.WORLD_SEED);
    var gg = root.buildGround(this.layout);
    this.layout.groundCanvas = gg.groundCanvas;
    this.ui = new root.UI();
    this.fx = new root.FX(this.layout, PID, this.ui);
    this.renderer = new root.Renderer(this.canvas, this.layout, this.fx, this.ui);
    this.input = new root.Input(this.canvas, {
      onKey: function (c) { self.onKey(c); },
      onClick: function () { if (self.state === "start") self.startRun(); }
    });
    this.state = "start";
    this.freeze = 0;
    this.lastSnap = null;
    this.best = 0;
    try { this.best = parseInt(localStorage.getItem("monkeyCityBest") || "0", 10) || 0; } catch (e) {}

    this.newSim();
    this.fx.camera.jumpTo(this.sim.players[PID].x, this.sim.players[PID].y);
    this.ui.showScreen("start");

    function fit() {
      var s = Math.min(window.innerWidth / CONFIG.VIEW_W, window.innerHeight / CONFIG.VIEW_H);
      if (s >= 1) s = Math.floor(s);
      s = Math.max(0.4, s);
      self.wrap.style.width = Math.round(CONFIG.VIEW_W * s) + "px";
      self.wrap.style.height = Math.round(CONFIG.VIEW_H * s) + "px";
      document.documentElement.style.setProperty("--ui", Math.max(1, Math.round(s)));
    }
    fit(); window.addEventListener("resize", fit);

    this.last = 0;
    function frame(ts) { window.requestAnimationFrame(frame); var dt = clamp((ts - self.last) / 1000, 0, 0.05); self.last = ts; self.tick(dt, ts / 1000); }
    window.requestAnimationFrame(frame);
  }

  Game.prototype.newSim = function () {
    this.sim = new SimMod.Sim({ mode: "sp", seed: CONFIG.WORLD_SEED });
    this.sim.addPlayer(PID, "YOU");
    this.fx.particles.list.length = 0;
    this.fx.floaters.length = 0;
    this.fx.hurtFlash = 0;
    this.freeze = 0;
    this.ui.clearMsgs();
    this.ui.setObjective("CRACK THE CHESTS - FIND " + CONFIG.PART_TOTAL + " PARTS");
    this.lastSnap = this.sim.snapshot();
  };
  Game.prototype.startRun = function () {
    if (this.state !== "start") return;
    this.state = "play"; this.ui.showScreen(null); AudioSys.sfx("uiStart");
    this.ui.msg("FIND THE ELECTRONIC PARTS!", "good");
  };
  Game.prototype.restart = function () {
    this.newSim();
    this.fx.camera.jumpTo(this.sim.players[PID].x, this.sim.players[PID].y);
    this.state = "play"; this.ui.showScreen(null); AudioSys.sfx("uiStart");
  };
  Game.prototype.onKey = function (c) {
    if (c === "Enter" || c === "NumpadEnter") { if (this.state === "start") this.startRun(); return; }
    if (c === "KeyP") {
      if (this.state === "play") { this.state = "pause"; this.ui.showScreen("pause"); }
      else if (this.state === "pause") { this.state = "play"; this.ui.showScreen(null); }
      return;
    }
    if (c === "KeyR") { if (this.state === "over" || this.state === "win") this.restart(); return; }
    if (c === "KeyM") { this.ui.msg(AudioSys.toggleMute() ? "SOUND OFF" : "SOUND ON"); return; }
  };

  Game.prototype.endGame = function (ev) {
    var won = ev.winnerPid === PID && !ev.lost;
    this.state = won ? "win" : "over";
    var p = this.sim.players[PID];
    if (p && p.score > this.best) { this.best = p.score; try { localStorage.setItem("monkeyCityBest", String(this.best)); } catch (e) {} }
    AudioSys.sfx(won ? "win" : "lose");
    var mins = Math.floor(this.sim.time / 60), secs = Math.floor(this.sim.time % 60);
    var tstr = mins + ":" + (secs < 10 ? "0" : "") + secs;
    var html = "SCORE <b>" + (p ? p.score : 0) + "</b> &nbsp; BEST <b>" + this.best + "</b><br>" +
      "PARTS <b>" + (p ? p.parts : 0) + "/" + CONFIG.PART_TOTAL + "</b> &nbsp; MONKEYS BONKED <b>" + (p ? p.kills : 0) + "</b><br>" +
      "TIME <b>" + tstr + "</b>" + (won ? " &nbsp; MAX COMBO <b>x" + (p ? p.maxCombo : 0) + "</b>" : "");
    this.ui.setHTML(won ? this.ui.winStats : this.ui.overStats, html);
    this.ui.showScreen(won ? "win" : "over");
  };

  Game.prototype.tick = function (dt, tNow) {
    if (this.state === "play") {
      var p = this.sim.players[PID];
      var inp = this.input.state(this.fx.camera, p.x, p.y);
      this.sim.setInput(PID, inp);

      if (this.freeze > 0) {
        this.freeze -= dt;                       // hit-stop: hold the frame
      } else {
        var events = this.sim.step(dt);
        this.fx.applyEvents(events);
        for (var i = 0; i < events.length; i++) {
          var e = events[i];
          if (e.t === "monkeyKilled" || e.t === "counter") this.freeze = Math.max(this.freeze, 0.05);
          else if (e.t === "monkeyHit") this.freeze = Math.max(this.freeze, 0.02);
          else if (e.t === "gameOver") { this.endGame(e); }
        }
        this.lastSnap = this.sim.snapshot();
        this.fx.updateAmbient(dt, this.lastSnap);
        this.fx.update(dt);
        var aimX = this.input.mouse.x + this.fx.camera.x, aimY = this.input.mouse.y + this.fx.camera.y;
        if (this.sim.phase === "rescue") this.fx.camera.focus = { x: this.layout.helipad.x, y: this.layout.helipad.y - 30 };
        else this.fx.camera.focus = null;
        this.fx.camera.follow(dt, p.x, p.y, aimX, aimY);
      }
      this.renderer.draw(this.lastSnap, PID, this.input.mouse, tNow);
    } else {
      // start / pause / over / win: draw the frozen world behind the overlay
      if (this.lastSnap) this.renderer.draw(this.lastSnap, PID, this.state === "pause" ? this.input.mouse : null, tNow);
    }
  };

  function boot() { root.__GAME__ = new Game(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : this);
