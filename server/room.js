/* ============================================================================
   ROOM + HUB -- authoritative match management for online play.

   Hub: owns all rooms, assigns player ids, routes C2S messages.
   Room: one Sim instance + connected players + lifecycle
         (lobby -> countdown -> playing -> over).

   Decoupled from the transport: a "conn" is any object with send(str), close(),
   and assignable onmessage/onclose. This lets tests drive it with fakes.
   ========================================================================== */
"use strict";
var path = require("path");
var SimMod = require(path.join(__dirname, "..", "src", "sim.js"));
var CONFIG = require(path.join(__dirname, "..", "src", "config.js"));
var P = require(path.join(__dirname, "..", "src", "protocol.js"));

function code4() { var s = "", A = "ABCDEFGHJKLMNPQRSTUVWXYZ"; for (var i = 0; i < 4; i++) s += A[(Math.random() * A.length) | 0]; return s; }

/* ---------------- Room ---------------- */
function Room(hub, code, seed) {
  this.hub = hub;
  this.code = code;
  this.seed = seed != null ? seed : CONFIG.WORLD_SEED;
  this.players = [];          // {pid, name, ready, host, conn, seq}
  this.state = "lobby";       // lobby | countdown | playing | over
  this.sim = null;
  this.interval = null;
  this.countdownTimers = [];
}
Room.prototype.find = function (pid) { for (var i = 0; i < this.players.length; i++) if (this.players[i].pid === pid) return this.players[i]; return null; };
Room.prototype.broadcast = function (obj) {
  var s = P.encode(obj);
  for (var i = 0; i < this.players.length; i++) try { this.players[i].conn.send(s); } catch (e) {}
};
Room.prototype.lobbyData = function () {
  return { room: this.code, state: this.state, players: this.players.map(function (p, i) {
    return { pid: p.pid, name: p.name, ready: p.ready, host: p.host, slot: i };
  }) };
};
Room.prototype.sendLobby = function () { this.broadcast({ m: P.S2C.LOBBY, room: this.code, state: this.state, players: this.lobbyData().players }); };

Room.prototype.addPlayer = function (conn, name) {
  var host = this.players.length === 0;
  var p = { pid: conn.pid, name: (name || "PLAYER").slice(0, 10).toUpperCase(), ready: false, host: host, conn: conn, seq: 0 };
  this.players.push(p);
  conn.send(P.encode({ m: P.S2C.WELCOME, yourPid: conn.pid, room: this.code, seed: this.seed }));
  this.sendLobby();
  return p;
};
Room.prototype.removePlayer = function (pid) {
  var idx = -1, i;
  for (i = 0; i < this.players.length; i++) if (this.players[i].pid === pid) { idx = i; break; }
  if (idx < 0) return;
  var wasHost = this.players[idx].host;
  this.players.splice(idx, 1);
  if (this.sim && this.state === "playing") this.sim.removePlayer(pid);
  if (this.players.length === 0) { this.dispose(); this.hub.deleteRoom(this.code); return; }
  if (wasHost) this.players[0].host = true;
  this.sendLobby();
};
Room.prototype.setReady = function (pid, ready) {
  var p = this.find(pid); if (!p || this.state !== "lobby") return;
  p.ready = !!ready; this.sendLobby();
};
Room.prototype.canStart = function (pid) {
  var p = this.find(pid);
  if (!p || !p.host || this.state !== "lobby") return false;
  if (this.players.length < CONFIG.MP.MIN_PLAYERS) return false;
  for (var i = 0; i < this.players.length; i++) if (!this.players[i].host && !this.players[i].ready) return false;
  return true;
};
Room.prototype.start = function (pid) {
  if (!this.canStart(pid)) return;
  var self = this;
  this.state = "countdown";
  this.sendLobby();
  if (this.hub.testMode) { this.beginPlay(); return; }
  var secs = CONFIG.MP.COUNTDOWN;
  function tickC() {
    self.broadcast({ m: P.S2C.COUNTDOWN, secs: secs });
    if (secs <= 0) { self.beginPlay(); return; }
    secs--; self.countdownTimers.push(setTimeout(tickC, 1000));
  }
  tickC();
};
Room.prototype.beginPlay = function () {
  var self = this;
  this.state = "playing";
  this.sim = new SimMod.Sim({ mode: "mp", seed: this.seed });
  this.players.forEach(function (p) { self.sim.addPlayer(p.pid, p.name); });
  if (!this.hub.testMode) this.interval = setInterval(function () { self.tick(1 / CONFIG.MP.TICK_HZ); }, 1000 / CONFIG.MP.TICK_HZ);
};
Room.prototype.input = function (pid, msg) {
  if (this.state !== "playing" || !this.sim) return;
  var p = this.find(pid); if (p && msg.seq != null) p.seq = msg.seq;
  this.sim.setInput(pid, { move: msg.move, aim: msg.aim, aimDist: msg.aimDist, flags: msg.flags });
};
Room.prototype.tick = function (dt) {
  if (this.state !== "playing" || !this.sim) return;
  var events = this.sim.step(dt);
  var state = this.sim.snapshot();
  for (var i = 0; i < this.players.length; i++) {
    var p = this.players[i];
    try { p.conn.send(P.encode({ m: P.S2C.SNAPSHOT, s: state, e: events, a: p.seq })); } catch (e) {}
  }
  if (this.sim.phase === "over") this.endMatch();
};
Room.prototype.endMatch = function () {
  if (this.interval) { clearInterval(this.interval); this.interval = null; }
  this.state = "over";
  var standings = [];
  for (var id in this.sim.players) {
    var pl = this.sim.players[id];
    standings.push({ pid: id, name: pl.name, parts: pl.parts, kills: pl.kills, deaths: pl.deaths, score: pl.score });
  }
  var winner = this.sim.winnerPid;
  standings.sort(function (a, b) { return (b.pid === winner ? 1 : 0) - (a.pid === winner ? 1 : 0) || b.score - a.score; });
  this.broadcast({ m: P.S2C.GAMEOVER, winnerPid: winner, winnerName: this.sim.winnerName, standings: standings });
};
Room.prototype.rematch = function (pid) {
  if (this.state !== "over") return;
  this.dispose();
  this.state = "lobby";
  for (var i = 0; i < this.players.length; i++) this.players[i].ready = false;
  this.sim = null;
  this.sendLobby();
};
Room.prototype.dispose = function () {
  if (this.interval) { clearInterval(this.interval); this.interval = null; }
  this.countdownTimers.forEach(function (t) { clearTimeout(t); });
  this.countdownTimers = [];
};

/* ---------------- Hub ---------------- */
function Hub(opts) {
  opts = opts || {};
  this.rooms = {};
  this.uid = 1;
  this.testMode = !!opts.testMode;
}
Hub.prototype.deleteRoom = function (code) { delete this.rooms[code]; };
Hub.prototype.getOrCreateRoom = function (code) {
  if (code && this.rooms[code]) return this.rooms[code];
  if (!code) { do { code = code4(); } while (this.rooms[code]); }
  var r = new Room(this, code, CONFIG.WORLD_SEED);
  this.rooms[code] = r;
  return r;
};
// register a new connection (transport-agnostic)
Hub.prototype.handleConn = function (conn) {
  var self = this;
  conn.pid = "u" + (this.uid++);
  conn.room = null;
  conn.onmessage = function (str) { self.route(conn, str); };
  conn.onclose = function () { self.leave(conn); };
};
Hub.prototype.leave = function (conn) {
  if (conn.room && this.rooms[conn.room]) this.rooms[conn.room].removePlayer(conn.pid);
  conn.room = null;
};
Hub.prototype.route = function (conn, str) {
  var msg = P.decode(str);
  if (!msg || !msg.m) return;
  var room = conn.room ? this.rooms[conn.room] : null;
  switch (msg.m) {
    case P.C2S.JOIN:
      if (conn.room) return;
      var requested = (msg.room || "").toUpperCase().slice(0, 4) || null;
      if (requested && this.rooms[requested]) {
        var ex = this.rooms[requested];
        if (ex.state !== "lobby") { conn.send(P.encode({ m: P.S2C.ERROR, code: "in_progress", msg: "MATCH ALREADY STARTED" })); return; }
        if (ex.players.length >= CONFIG.MP.MAX_PLAYERS) { conn.send(P.encode({ m: P.S2C.ERROR, code: "full", msg: "ROOM IS FULL" })); return; }
      }
      var r = this.getOrCreateRoom(requested);
      conn.room = r.code;
      r.addPlayer(conn, msg.name);
      break;
    case P.C2S.READY: if (room) room.setReady(conn.pid, msg.ready); break;
    case P.C2S.START: if (room) room.start(conn.pid); break;
    case P.C2S.INPUT: if (room) room.input(conn.pid, msg); break;
    case P.C2S.REMATCH: if (room) room.rematch(conn.pid); break;
    case P.C2S.LEAVE: this.leave(conn); break;
    case P.C2S.PING: conn.send(P.encode({ m: P.S2C.PONG, t: msg.t, serverTime: Date.now() })); break;
  }
};

module.exports = { Hub: Hub, Room: Room };
