/* Server tests:
   PART 1 (logic): drive Hub with fake conns (testMode) through join -> ready ->
     start -> play, force a player to build and win, assert GAMEOVER + standings.
   PART 2 (wire): boot a real http + ws-lite server, connect two ws-lite clients,
     join/ready/start, and assert SNAPSHOT frames actually flow over the socket. */
"use strict";
var path = require("path"), http = require("http");
var Room = require(path.join(__dirname, "..", "server", "room.js"));
var wsLite = require(path.join(__dirname, "..", "server", "ws-lite.js"));
var CONFIG = require(path.join(__dirname, "..", "src", "config.js"));
var P = require(path.join(__dirname, "..", "src", "protocol.js"));
var FLAG = require(path.join(__dirname, "..", "src", "sim.js")).FLAG;

var fails = [];
function step(name, fn) { try { fn(); console.log("ok   " + name); } catch (e) { fails.push(name + ": " + (e && e.stack || e)); console.log("FAIL " + name + " -> " + e); } }
function assert(c, m) { if (!c) throw new Error("assert: " + m); }

/* ===================== PART 1: Hub logic (fake conns) ===================== */
function fakeConn() {
  return { sent: [], send: function (s) { this.sent.push(P.decode(s)); }, close: function () {}, onmessage: null, onclose: null };
}
function lastOf(conn, m) { for (var i = conn.sent.length - 1; i >= 0; i--) if (conn.sent[i].m === m) return conn.sent[i]; return null; }

step("lobby: join / ready / start", function () {
  var hub = new Room.Hub({ testMode: true });
  var a = fakeConn(), b = fakeConn();
  hub.handleConn(a); hub.handleConn(b);
  a.onmessage(P.encode({ m: P.C2S.JOIN, name: "ALPHA" }));
  var wa = lastOf(a, P.S2C.WELCOME);
  assert(wa, "host got WELCOME");
  var code = wa.room;
  b.onmessage(P.encode({ m: P.C2S.JOIN, name: "BRAVO", room: code }));
  var lob = lastOf(b, P.S2C.LOBBY);
  assert(lob && lob.players.length === 2, "2 players in lobby");
  // host can't start until guest readies
  a.onmessage(P.encode({ m: P.C2S.START }));
  assert(hub.rooms[code].state === "lobby", "no start before ready");
  b.onmessage(P.encode({ m: P.C2S.READY, ready: true }));
  a.onmessage(P.encode({ m: P.C2S.START }));
  assert(hub.rooms[code].state === "playing", "match started, state=" + hub.rooms[code].state);
});

step("match: snapshots stream + a player builds to win", function () {
  var hub = new Room.Hub({ testMode: true });
  var a = fakeConn(), b = fakeConn();
  hub.handleConn(a); hub.handleConn(b);
  a.onmessage(P.encode({ m: P.C2S.JOIN, name: "ALPHA" }));
  var code = lastOf(a, P.S2C.WELCOME).room;
  b.onmessage(P.encode({ m: P.C2S.JOIN, name: "BRAVO", room: code }));
  b.onmessage(P.encode({ m: P.C2S.READY, ready: true }));
  a.onmessage(P.encode({ m: P.C2S.START }));
  var room = hub.rooms[code], sim = room.sim;
  sim.monkeys.length = 0;                                  // isolate
  var A = sim.players[a.pid];
  A.partIds = [0, 1, 2, 3, 4, 5]; A.parts = 6; A.maxHp = A.hp = 100000;
  var st = sim.layout.station;
  var dt = 1 / CONFIG.MP.TICK_HZ, over = null;
  for (var i = 0; i < 400 && room.state === "playing"; i++) {
    A.x = st.doorX; A.y = st.doorY + 6;
    room.input(a.pid, { seq: i, move: { x: 0, y: 0 }, aim: 0, aimDist: 100, flags: FLAG.INTERACT });
    room.tick(dt);
  }
  over = lastOf(a, P.S2C.GAMEOVER);
  assert(room.state === "over", "room over, state=" + room.state);
  assert(over && over.winnerPid === a.pid, "ALPHA won");
  assert(over.standings && over.standings.length === 2, "standings present");
  // snapshots were sent during play
  var snaps = a.sent.filter(function (x) { return x.m === P.S2C.SNAPSHOT; });
  assert(snaps.length > 5, "snapshots streamed: " + snaps.length);
  assert(snaps[0].s && snaps[0].s.players.length === 2, "snapshot carries 2 players");
});

step("pvp: banana kill scatters parts (over the room)", function () {
  var hub = new Room.Hub({ testMode: true });
  var a = fakeConn(), b = fakeConn();
  hub.handleConn(a); hub.handleConn(b);
  a.onmessage(P.encode({ m: P.C2S.JOIN, name: "A" }));
  var code = lastOf(a, P.S2C.WELCOME).room;
  b.onmessage(P.encode({ m: P.C2S.JOIN, name: "B", room: code }));
  b.onmessage(P.encode({ m: P.C2S.READY, ready: true }));
  a.onmessage(P.encode({ m: P.C2S.START }));
  var room = hub.rooms[code], sim = room.sim;
  sim.monkeys.length = 0;
  var A = sim.players[a.pid], B = sim.players[b.pid];
  B.partIds = [0, 1]; B.parts = 2; B.maxHp = 30; B.hp = 30;
  B.x = 700; B.y = 700;
  var dt = 1 / CONFIG.MP.TICK_HZ, killed = false;
  for (var i = 0; i < 400 && !killed; i++) {
    A.x = B.x - 60; A.y = B.y;
    var aim = Math.atan2(B.y - A.y, B.x - A.x);
    room.input(a.pid, { seq: i, move: { x: 0, y: 0 }, aim: aim, aimDist: 80, flags: FLAG.THROW });
    var evs = sim.step(dt);                       // step directly to read events
    for (var j = 0; j < evs.length; j++) if (evs[j].t === "playerKilled" && evs[j].pid === b.pid) killed = true;
  }
  assert(killed, "B was killed");
  assert(sim.pickups.filter(function (q) { return q.type === "part"; }).length >= 2, "parts scattered");
});

/* ===================== PART 2: real WebSocket wire ===================== */
CONFIG.MP.COUNTDOWN = 0;                 // skip the 3s lobby countdown for the test
var wireServer = http.createServer(function (req, res) { res.writeHead(404); res.end(); });
var wireHub = new Room.Hub();           // real timers
wsLite.attach(wireServer, function (conn) { wireHub.handleConn(conn); });

wireServer.listen(0, "127.0.0.1", function () {
  var port = wireServer.address().port;
  var base = "ws://127.0.0.1:" + port + "/";
  var c1 = {}, c2 = {}, code = null, driver = null;
  var got = { welcome: 0, lobby: 0, snap1: 0, snap2: 0, over1: 0, over2: 0 };

  function finish() {
    if (driver) clearInterval(driver);
    step("wire: handshake + lobby + snapshots over real sockets", function () {
      assert(got.welcome >= 1, "WELCOME received over the wire");
      assert(got.lobby >= 1, "LOBBY received");
      assert(got.snap1 > 3 && got.snap2 > 3, "both clients got snapshots (" + got.snap1 + "," + got.snap2 + ")");
    });
    step("wire: a real match plays to a win and GAMEOVER reaches both clients", function () {
      assert(got.over1 >= 1 && got.over2 >= 1, "both clients got GAMEOVER (" + got.over1 + "," + got.over2 + ")");
    });
    try { wireServer.close(); } catch (e) {}
    for (var k in wireHub.rooms) wireHub.rooms[k].dispose();
    console.log("");
    if (fails.length) { console.log("FAILURES (" + fails.length + "):\n" + fails.join("\n\n")); process.exit(1); }
    else { console.log("ALL SERVER TESTS PASSED"); process.exit(0); }
  }

  // once the match is live, force the host to gather 6 parts and hold E at the
  // station so the build completes -> server should broadcast GAMEOVER to both.
  function startDriver() {
    driver = setInterval(function () {
      var room = wireHub.rooms[code];
      if (!room || room.state !== "playing" || !room.sim) return;
      room.sim.monkeys.length = 0;
      var hostPid = room.players[0].pid, hp = room.sim.players[hostPid];
      if (!hp) return;
      hp.partIds = [0, 1, 2, 3, 4, 5]; hp.parts = 6; hp.maxHp = hp.hp = 100000;
      var st = room.sim.layout.station; hp.x = st.doorX; hp.y = st.doorY + 6;
      c1.conn.send(P.encode({ m: P.C2S.INPUT, seq: 1, move: { x: 0, y: 0 }, aim: 0, aimDist: 100, flags: 8 }));
    }, 40);
  }

  wsLite.connect(base, function (conn) {
    c1.conn = conn;
    conn.onmessage = function (s) {
      var m = P.decode(s);
      if (m.m === P.S2C.WELCOME) { got.welcome++; code = m.room; setTimeout(joinSecond, 60); }
      if (m.m === P.S2C.SNAPSHOT) got.snap1++;
      if (m.m === P.S2C.GAMEOVER) got.over1++;
    };
    conn.send(P.encode({ m: P.C2S.JOIN, name: "ONE" }));
  });
  function joinSecond() {
    wsLite.connect(base, function (conn) {
      c2.conn = conn;
      conn.onmessage = function (s) {
        var m = P.decode(s);
        if (m.m === P.S2C.LOBBY) got.lobby++;
        if (m.m === P.S2C.SNAPSHOT) got.snap2++;
        if (m.m === P.S2C.GAMEOVER) got.over2++;
      };
      conn.send(P.encode({ m: P.C2S.JOIN, name: "TWO", room: code }));
      setTimeout(function () {
        c2.conn.send(P.encode({ m: P.C2S.READY, ready: true }));
        setTimeout(function () { c1.conn.send(P.encode({ m: P.C2S.START })); startDriver(); }, 60);
      }, 80);
    });
  }
  setTimeout(finish, 8500);             // lobby + ~2.6s build + ~4.4s rescue + GAMEOVER
});
