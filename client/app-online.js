/* ============================================================================
   APP-ONLINE -- competitive multiplayer boot. Connects to the Node server,
   drives the lobby, then renders interpolated snapshots while streaming local
   input. The authoritative sim lives on the server; this client never steps it.
   BROWSER ONLY (served over http from server/server.js).
   ========================================================================== */
(function (root) {
  "use strict";
  var CONFIG = root.CONFIG, WorldGen = root.WorldGen, AudioSys = root.AudioSys;
  var INTERP_MS = CONFIG.MP.INTERP_MS;

  function byId(id) { return document.getElementById(id); }

  function App() {
    var self = this;
    this.canvas = byId("game-canvas");
    this.wrap = byId("game-wrap");
    root.buildSprites();
    this.ui = new root.UI();
    this.state = "menu";              // menu | lobby | countdown | playing | over
    this.net = null;
    this.layout = null; this.fx = null; this.renderer = null;
    this.input = new root.Input(this.canvas, { onKey: function (c) { self.onKey(c); } });
    this.seq = 0;
    this.lastSnap = null;
    this.amReady = false;
    this.amHost = false;

    // menu / lobby DOM
    this.nameInput = byId("name-input");
    this.roomInput = byId("room-input");
    byId("btn-join").addEventListener("click", function () { self.doJoin(); });
    byId("btn-ready").addEventListener("click", function () { self.amReady = !self.amReady; self.net && self.net.ready(self.amReady); self.refreshLobbyButtons(); });
    byId("btn-start").addEventListener("click", function () { self.net && self.net.start(); });
    var rb = byId("btn-rematch"); if (rb) rb.addEventListener("click", function () { self.net && self.net.rematch(); });
    var lb = byId("btn-leave"); if (lb) lb.addEventListener("click", function () { location.reload(); });

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
    function frame(ts) { window.requestAnimationFrame(frame); var dt = Math.min(0.05, (ts - self.last) / 1000) || 0; self.last = ts; self.tick(dt, ts / 1000); }
    window.requestAnimationFrame(frame);
  }

  App.prototype.onKey = function (c) {
    if (c === "KeyM") this.ui.msg(AudioSys.toggleMute() ? "SOUND OFF" : "SOUND ON");
    if (c === "Enter" && this.state === "menu") this.doJoin();
  };

  App.prototype.doJoin = function () {
    if (this.net) return;
    var self = this;
    var name = (this.nameInput && this.nameInput.value || "PLAYER").trim() || "PLAYER";
    var room = (this.roomInput && this.roomInput.value || "").trim();
    AudioSys.init(); AudioSys.resume();
    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    var urlBase = proto + (location.host || "localhost:8080") + "/";
    this.setStatus("CONNECTING...");
    this.net = new root.Net(urlBase, {
      onOpen: function () { self.net.join(name, room); },
      onClose: function () { self.setStatus("DISCONNECTED - RELOAD TO RECONNECT"); },
      onError: function (m) { self.setStatus((m && m.msg) || "CONNECTION ERROR"); },
      onWelcome: function (m) { self.onWelcome(m); },
      onLobby: function (m) { self.onLobby(m); },
      onCountdown: function (m) { self.state = "countdown"; self.ui.showScreen("countdown"); self.ui.setCountdown(m.secs); AudioSys.sfx("tick"); },
      onSnapshot: function (events, snap) { self.onSnapshot(events, snap); },
      onGameOver: function (m) { self.onGameOver(m); }
    });
  };
  App.prototype.setStatus = function (txt) { var el = byId("net-msg"); if (el) el.textContent = txt; };

  App.prototype.onWelcome = function (m) {
    this.layout = WorldGen.buildLayout(m.seed);
    var gg = root.buildGround(this.layout); this.layout.groundCanvas = gg.groundCanvas;
    this.fx = new root.FX(this.layout, m.yourPid, this.ui);
    this.renderer = new root.Renderer(this.canvas, this.layout, this.fx, this.ui);
    this.fx.camera.jumpTo(CONFIG.WORLD_W / 2, CONFIG.WORLD_H / 2);
    this.state = "lobby";
    this.ui.showScreen("lobby");
    this.setStatus("");
  };
  App.prototype.onLobby = function (m) {
    if (this.state === "playing" || this.state === "countdown") return;
    this.state = "lobby";
    this.ui.showScreen("lobby");
    this.ui.renderLobby(m, this.net.yourPid);
    for (var i = 0; i < m.players.length; i++) if (m.players[i].pid === this.net.yourPid) { this.amHost = m.players[i].host; this.amReady = m.players[i].ready; }
    this._lobby = m;
    this.refreshLobbyButtons();
  };
  App.prototype.refreshLobbyButtons = function () {
    var readyBtn = byId("btn-ready"), startBtn = byId("btn-start");
    if (readyBtn) { readyBtn.textContent = this.amReady ? "NOT READY" : "READY"; readyBtn.style.display = this.amHost ? "none" : ""; }
    if (startBtn) {
      startBtn.style.display = this.amHost ? "" : "none";
      var can = false, m = this._lobby;
      if (m && m.players.length >= CONFIG.MP.MIN_PLAYERS) { can = true; for (var i = 0; i < m.players.length; i++) if (!m.players[i].host && !m.players[i].ready) can = false; }
      startBtn.disabled = !can;
      startBtn.textContent = can ? "START MATCH" : "WAITING FOR PLAYERS";
    }
  };
  App.prototype.onSnapshot = function (events, snap) {
    if (this.state !== "playing") { this.state = "playing"; this.ui.showScreen(null); }
    if (this.fx) this.fx.applyEvents(events);
    this.lastSnap = snap;
  };
  App.prototype.onGameOver = function (m) {
    this.state = "over";
    var won = m.winnerPid === this.net.yourPid;
    AudioSys.sfx(won ? "win" : "lose");
    var ot = byId("over-title"); if (ot) { ot.textContent = won ? "YOU ESCAPED!" : (m.winnerName || "RIVAL") + " ESCAPED"; ot.className = won ? "gold" : "red"; }
    var html = "";
    for (var i = 0; i < m.standings.length; i++) {
      var s = m.standings[i];
      html += '<div class="' + (s.pid === m.winnerPid ? "win-row" : "") + '">' + (i + 1) + ". <b>" + s.name + "</b> &nbsp; parts " + s.parts + "/" + CONFIG.PART_TOTAL + " &nbsp; bonks " + s.kills + " &nbsp; score " + s.score + "</div>";
    }
    this.ui.setHTML(byId("over-stats"), html);
    this.ui.showScreen("over");
  };

  App.prototype.tick = function (dt, tNow) {
    if (this.state === "playing" && this.net && this.renderer) {
      var rsnap = this.net.interpolated(performance.now() - INTERP_MS);
      if (rsnap) {
        var local = null;
        for (var i = 0; i < rsnap.players.length; i++) if (rsnap.players[i].id === this.net.yourPid) local = rsnap.players[i];
        if (local) {
          var inp = this.input.state(this.fx.camera, local.x, local.y);
          this.net.sendInput(this.seq++, inp.move, inp.aim, inp.aimDist, inp.flags);
          var aimX = this.input.mouse.x + this.fx.camera.x, aimY = this.input.mouse.y + this.fx.camera.y;
          if (rsnap.phase === "rescue") this.fx.camera.focus = { x: this.layout.helipad.x, y: this.layout.helipad.y - 30 };
          else this.fx.camera.focus = null;
          this.fx.camera.follow(dt, local.x, local.y, aimX, aimY);
        }
        this.fx.updateAmbient(dt, rsnap);
        this.fx.update(dt);
        this.renderer.draw(rsnap, this.net.yourPid, this.input.mouse, tNow);
      }
    } else if (this.renderer && this.layout) {
      // lobby / countdown / over: scenic backdrop (or frozen last frame)
      if (this.fx) { this.fx.updateAmbient(dt, this.lastSnap || this.backdrop()); this.fx.update(dt); this.fx.camera.follow(dt, CONFIG.WORLD_W / 2, CONFIG.WORLD_H / 2, CONFIG.WORLD_W / 2, CONFIG.WORLD_H / 2); }
      this.renderer.draw(this.lastSnap || this.backdrop(), this.net ? this.net.yourPid : null, null, tNow);
    }
  };
  App.prototype.backdrop = function () {
    if (this._bd) return this._bd;
    var chests = [];
    for (var i = 0; i < this.layout.chestSpots.length; i++) chests.push({ id: i + 1, state: "closed" });
    this._bd = { players: [], monkeys: [], bananas: [], pickups: [], chests: chests, heli: null, dayT: 0.15, radioActive: false, phase: "lobby", rescueT: 0, winnerPid: null };
    return this._bd;
  };

  function boot() { root.__APP__ = new App(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : this);
