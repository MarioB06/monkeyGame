/* ============================================================================
   NET -- browser WebSocket client + snapshot buffer + interpolation.
   BROWSER ONLY. Exposes window.Net.

   Remote entities are interpolated ~INTERP_MS in the past for smoothness; the
   LOCAL player is rendered at the freshest server position (responsive on LAN).
   Discrete events are applied immediately on arrival (see app-online).
   ========================================================================== */
(function (root) {
  "use strict";
  var CONFIG = root.CONFIG, M = root.MathUtils, P = root.Protocol, lerp = M.lerp;

  function Net(urlBase, handlers) {
    var self = this;
    this.h = handlers || {};
    this.yourPid = null; this.seed = null; this.room = null;
    this.buffer = [];           // [{recv, s}]
    this.lastAck = 0;
    this.connected = false;
    this.ws = new WebSocket(urlBase);
    this.ws.onopen = function () { self.connected = true; if (self.h.onOpen) self.h.onOpen(); };
    this.ws.onclose = function () { self.connected = false; if (self.h.onClose) self.h.onClose(); };
    this.ws.onerror = function () { if (self.h.onError) self.h.onError({ msg: "CONNECTION ERROR" }); };
    this.ws.onmessage = function (ev) { self._recv(ev.data); };
  }
  Net.prototype._recv = function (str) {
    var m = P.decode(str); if (!m) return;
    switch (m.m) {
      case P.S2C.WELCOME: this.yourPid = m.yourPid; this.seed = m.seed; this.room = m.room; if (this.h.onWelcome) this.h.onWelcome(m); break;
      case P.S2C.LOBBY: if (this.h.onLobby) this.h.onLobby(m); break;
      case P.S2C.COUNTDOWN: if (this.h.onCountdown) this.h.onCountdown(m); break;
      case P.S2C.SNAPSHOT:
        this.buffer.push({ recv: performance.now(), s: m.s });
        if (this.buffer.length > 12) this.buffer.shift();
        this.lastAck = m.a || 0;
        if (this.h.onSnapshot) this.h.onSnapshot(m.e || [], m.s);
        break;
      case P.S2C.GAMEOVER: if (this.h.onGameOver) this.h.onGameOver(m); break;
      case P.S2C.ERROR: if (this.h.onError) this.h.onError(m); break;
      case P.S2C.PONG: break;
    }
  };
  Net.prototype.send = function (obj) { try { if (this.ws.readyState === 1) this.ws.send(P.encode(obj)); } catch (e) {} };
  Net.prototype.join = function (name, room) { this.send({ m: P.C2S.JOIN, name: name, room: room || "" }); };
  Net.prototype.ready = function (r) { this.send({ m: P.C2S.READY, ready: r }); };
  Net.prototype.start = function () { this.send({ m: P.C2S.START }); };
  Net.prototype.rematch = function () { this.send({ m: P.C2S.REMATCH }); };
  Net.prototype.sendInput = function (seq, move, aim, aimDist, flags) {
    this.send({ m: P.C2S.INPUT, seq: seq, move: move, aim: aim, aimDist: aimDist, flags: flags });
  };
  Net.prototype.close = function () { try { this.ws.close(); } catch (e) {} };

  // newest raw snapshot (for HUD / win checks)
  Net.prototype.latest = function () { return this.buffer.length ? this.buffer[this.buffer.length - 1].s : null; };

  // interpolated snapshot for rendering. Local player kept at freshest pos.
  Net.prototype.interpolated = function (renderTime) {
    var b = this.buffer;
    if (!b.length) return null;
    var newest = b[b.length - 1];
    if (b.length < 2) return newest.s;
    var older = b[0], newer = b[b.length - 1];
    for (var i = 0; i < b.length - 1; i++) {
      if (b[i].recv <= renderTime && b[i + 1].recv >= renderTime) { older = b[i]; newer = b[i + 1]; break; }
      older = b[i]; newer = b[i + 1];
    }
    var span = newer.recv - older.recv;
    var f = span > 0 ? M.clamp((renderTime - older.recv) / span, 0, 1) : 1;
    var yourPid = this.yourPid;
    function mapById(arr) { var m = {}; for (var i = 0; i < arr.length; i++) m[arr[i].id] = arr[i]; return m; }
    var oM = mapById(older.s.players), oMon = mapById(older.s.monkeys), oBan = mapById(older.s.bananas), oPk = mapById(older.s.pickups);

    var out = {};
    for (var k in newer.s) out[k] = newer.s[k];
    out.players = newer.s.players.map(function (np) {
      if (np.id === yourPid) return np;                       // freshest for local
      var op = oM[np.id]; if (!op) return np;
      var o = {}; for (var k in np) o[k] = np[k];
      o.x = lerp(op.x, np.x, f); o.y = lerp(op.y, np.y, f); o.riseZ = lerp(op.riseZ, np.riseZ, f);
      return o;
    });
    out.monkeys = newer.s.monkeys.map(function (nm) {
      var om = oMon[nm.id]; if (!om) return nm;
      var o = {}; for (var k in nm) o[k] = nm[k]; o.x = lerp(om.x, nm.x, f); o.y = lerp(om.y, nm.y, f); return o;
    });
    out.bananas = newer.s.bananas.map(function (nb) {
      var ob = oBan[nb.id]; if (!ob) return nb;
      var o = {}; for (var k in nb) o[k] = nb[k]; o.x = lerp(ob.x, nb.x, f); o.y = lerp(ob.y, nb.y, f); o.traveled = lerp(ob.traveled, nb.traveled, f); return o;
    });
    out.pickups = newer.s.pickups.map(function (npk) {
      var opk = oPk[npk.id]; if (!opk) return npk;
      var o = {}; for (var k in npk) o[k] = npk[k]; o.x = lerp(opk.x, npk.x, f); o.y = lerp(opk.y, npk.y, f); o.z = lerp(opk.z, npk.z, f); return o;
    });
    if (newer.s.heli && older.s.heli) {
      out.heli = { x: lerp(older.s.heli.x, newer.s.heli.x, f), y: newer.s.heli.y, z: lerp(older.s.heli.z, newer.s.heli.z, f), phase: newer.s.heli.phase };
    }
    return out;
  };

  root.Net = Net;
})(typeof window !== "undefined" ? window : this);
