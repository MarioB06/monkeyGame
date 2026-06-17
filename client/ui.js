/* ============================================================================
   UI -- DOM HUD, popup messages, and full-screen overlays (start/pause/over/
   win/lobby/countdown). BROWSER ONLY. Exposes window.UI. Tolerant of missing
   elements so the same class serves index.html (offline) and online.html.
   ========================================================================== */
(function (root) {
  "use strict";
  var M = root.MathUtils, clamp = M.clamp;
  function byId(id) { return document.getElementById(id); }

  function UI() {
    this.hud = byId("hud");
    this.hpFill = byId("hp-fill"); this.stFill = byId("st-fill"); this.cdFill = byId("cd-fill");
    this.partsEl = byId("hud-parts"); this.scoreEl = byId("hud-score"); this.comboEl = byId("hud-combo");
    this.objectiveEl = byId("objective"); this.msgsEl = byId("msgs");
    this.screens = {};
    ["start", "pause", "over", "win", "lobby", "countdown"].forEach(function (n) {
      var el = byId("screen-" + n); if (el) this.screens[n] = el;
    }, this);
    this.overStats = byId("over-stats"); this.winStats = byId("win-stats");
    this.lobbyList = byId("lobby-list"); this.lobbyCode = byId("lobby-code");
    this.countdownNum = byId("countdown-num");
    this._cache = {};
  }
  UI.prototype.showScreen = function (name) {
    for (var k in this.screens) {
      if (name === k) this.screens[k].classList.remove("hidden");
      else this.screens[k].classList.add("hidden");
    }
    if (this.hud) { if (name && name !== "pause") this.hud.classList.add("hidden"); else this.hud.classList.remove("hidden"); }
  };
  UI.prototype.setBars = function (hpK, stK, cdK, gold) {
    if (this.hpFill) this.hpFill.style.transform = "scaleX(" + clamp(hpK, 0, 1).toFixed(3) + ")";
    if (this.stFill) this.stFill.style.transform = "scaleX(" + clamp(stK, 0, 1).toFixed(3) + ")";
    if (this.cdFill) this.cdFill.style.transform = "scaleX(" + clamp(cdK, 0, 1).toFixed(3) + ")";
    var col = gold ? "#ffd84a" : "#e8c83a";
    if (this.cdFill && this._cache.cdCol !== col) { this._cache.cdCol = col; this.cdFill.style.background = col; }
  };
  UI.prototype.setParts = function (n, total) {
    if (!this.partsEl) return;
    var s = "PARTS " + n + "/" + total;
    if (this._cache.parts !== s) { this._cache.parts = s; this.partsEl.textContent = s; }
  };
  UI.prototype.setScore = function (v) {
    if (!this.scoreEl) return;
    var s = "SCORE " + v;
    if (this._cache.score !== s) { this._cache.score = s; this.scoreEl.textContent = s; }
  };
  UI.prototype.setCombo = function (n) {
    if (!this.comboEl) return;
    if (n >= 2) { this.comboEl.classList.remove("hidden");
      var s = "COMBO x" + n; if (this._cache.combo !== s) { this._cache.combo = s; this.comboEl.textContent = s; }
    } else this.comboEl.classList.add("hidden");
  };
  UI.prototype.setObjective = function (text) {
    if (!this.objectiveEl) return;
    if (this._cache.obj !== text) { this._cache.obj = text; this.objectiveEl.textContent = text; }
  };
  UI.prototype.msg = function (text, cls) {
    if (!this.msgsEl) return;
    var div = document.createElement("div");
    div.className = "msg" + (cls ? " " + cls : "");
    div.textContent = text;
    this.msgsEl.appendChild(div);
    while (this.msgsEl.children.length > 4) this.msgsEl.removeChild(this.msgsEl.children[0]);
    setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 2400);
  };
  UI.prototype.clearMsgs = function () { if (this.msgsEl) this.msgsEl.innerHTML = ""; };
  UI.prototype.setHTML = function (el, html) { if (el) el.innerHTML = html; };

  /* ---- lobby (online only) ---- */
  UI.prototype.renderLobby = function (data, localPid) {
    if (this.lobbyCode) this.lobbyCode.textContent = data.room;
    if (!this.lobbyList) return;
    var html = "";
    for (var i = 0; i < data.players.length; i++) {
      var p = data.players[i];
      var tag = (p.host ? "[HOST] " : "") + p.name + (p.pid === localPid ? " (YOU)" : "");
      html += '<div class="lobby-row ' + (p.ready ? "ready" : "") + '">' +
              '<span class="dot s' + p.slot + '"></span>' + tag +
              '<span class="rstate">' + (p.ready || p.host ? "READY" : "...") + "</span></div>";
    }
    this.lobbyList.innerHTML = html;
  };
  UI.prototype.setCountdown = function (secs) { if (this.countdownNum) this.countdownNum.textContent = secs; };

  root.UI = UI;
})(typeof window !== "undefined" ? window : this);
