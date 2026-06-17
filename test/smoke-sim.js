/* Headless test of the pure simulation core (src/sim.js) -- no DOM, no canvas,
   no stubs. Drives Sim directly and asserts on snapshots + emitted events.
   Covers: SP chest->part->build->win, and MP pvp kill -> part scatter -> respawn. */
"use strict";
var path = require("path");
var Sim = require(path.join(__dirname, "..", "src", "sim.js")).Sim;
var FLAG = require(path.join(__dirname, "..", "src", "sim.js")).FLAG;
var CONFIG = require(path.join(__dirname, "..", "src", "config.js"));
var M = require(path.join(__dirname, "..", "src", "mathutils.js"));

var fails = [];
function step(name, fn) { try { fn(); console.log("ok   " + name); } catch (e) { fails.push(name + ": " + (e && e.stack || e)); console.log("FAIL " + name + " -> " + e); } }
function assert(c, m) { if (!c) throw new Error("assert: " + m); }
var DT = 1 / 30;
function run(sim, n) { var all = []; for (var i = 0; i < n; i++) all = all.concat(sim.step(DT)); return all; }
function aimAt(p, tx, ty) { return { aim: M.angTo(p.x, p.y, tx, ty), aimDist: M.dist(p.x, p.y, tx, ty) }; }

step("construct SP sim", function () {
  var sim = new Sim({ mode: "sp" });
  assert(sim.chests.length === 7, "7 chests, got " + sim.chests.length);
  assert(sim.monkeys.length >= 12, "monkeys spawned: " + sim.monkeys.length);
  var snap = sim.snapshot();
  assert(snap.phase === "playing", "starts playing");
});

step("SP: crack chest with bananas -> part drops -> collect", function () {
  var sim = new Sim({ mode: "sp" });
  sim.monkeys.length = 0;                        // isolate chest mechanics
  var p = sim.addPlayer("p1", "SOLO");
  var chest = sim.chests[0];
  p.x = chest.x; p.y = chest.y + 55;
  p.maxHp = p.hp = 100000;
  var a = aimAt(p, chest.x, chest.y);
  var opened = false, gotPart = false, evs, i;
  // phase 1: bonk the chest open from a distance
  for (i = 0; i < 240 && !opened; i++) {
    sim.setInput("p1", { move: { x: 0, y: 0 }, aim: a.aim, aimDist: a.aimDist, flags: FLAG.THROW });
    sim.step(DT);
    if (chest.state === "open") opened = true;
  }
  assert(opened, "chest opened");
  // phase 2: walk onto the dropped part to collect it
  for (i = 0; i < 120 && !gotPart; i++) {
    p.x = chest.x; p.y = chest.y + 8;            // stand on the part
    sim.setInput("p1", { move: { x: 0, y: 0 }, aim: 0, aimDist: 100, flags: 0 });
    evs = sim.step(DT);
    evs.forEach(function (e) { if (e.t === "pickup" && e.ptype === "part") gotPart = true; });
  }
  assert(p.parts === 1, "part collected, parts=" + p.parts);
  assert(p.partIds.indexOf(0) >= 0, "has partId 0");
});

step("SP: full win (6 parts -> build -> rescue -> over)", function () {
  var sim = new Sim({ mode: "sp" });
  sim.monkeys.length = 0;
  var p = sim.addPlayer("p1", "SOLO");
  p.partIds = [0, 1, 2, 3, 4, 5]; p.parts = 6;
  p.maxHp = p.hp = 100000;
  var st = sim.layout.station;
  p.x = st.doorX; p.y = st.doorY + 6;
  var built = false, won = false, evs;
  for (var i = 0; i < 400; i++) {
    sim.setInput("p1", { move: { x: 0, y: 0 }, aim: 0, aimDist: 100, flags: FLAG.INTERACT });
    evs = sim.step(DT);
    evs.forEach(function (e) { if (e.t === "buildDone") built = true; if (e.t === "gameOver") won = true; });
    if (won) break;
  }
  assert(built, "build completed");
  assert(sim.phase === "over", "phase over, got " + sim.phase);
  assert(sim.winnerPid === "p1", "winner is p1");
});

step("SP: lethal monkey damage -> game over (lost)", function () {
  var sim = new Sim({ mode: "sp" });
  var p = sim.addPlayer("p1");
  p.hurtT = 0; p.slideT = 0; p.hp = 5;
  p.hurt(9999, p.x + 10, p.y, null);
  assert(sim.phase === "over", "over after lethal");
  assert(sim.winnerPid === null && sim.lost === true, "lost flag set");
});

step("MP: player banana hits + kills rival, parts scatter, respawn", function () {
  var sim = new Sim({ mode: "mp" });
  sim.monkeys.length = 0;
  var a = sim.addPlayer("A", "ALPHA"), b = sim.addPlayer("B", "BRAVO");
  b.partIds = [0, 1, 2]; b.parts = 3;          // victim is carrying 3 parts
  b.x = 700; b.y = 700; a.x = 640; a.y = 700;
  b.maxHp = 40; b.hp = 40;
  var killed = false, scattered = 0, evs;
  for (var i = 0; i < 400 && !killed; i++) {
    a.x = b.x - 60; a.y = b.y;                  // keep A in front of B
    var aim = aimAt(a, b.x, b.y);
    sim.setInput("A", { move: { x: 0, y: 0 }, aim: aim.aim, aimDist: aim.aimDist, flags: FLAG.THROW });
    sim.setInput("B", { move: { x: 0, y: 0 }, aim: 0, aimDist: 100, flags: 0 });
    evs = sim.step(DT);
    evs.forEach(function (e) {
      if (e.t === "playerKilled" && e.pid === "B") { killed = true; }
    });
  }
  assert(killed, "B was killed by A");
  // B's 3 parts should now exist as pickups in the world
  var partPickups = sim.pickups.filter(function (q) { return q.type === "part"; });
  assert(partPickups.length >= 3, "3 parts scattered, got " + partPickups.length);
  assert(b.parts === 0, "victim lost parts");
  assert(a.score >= CONFIG.SCORE.KILL_PLAYER, "killer scored, score=" + a.score);
  // respawn after the timer
  b.x = 1; b.y = 1;
  run(sim, Math.ceil(CONFIG.MP.RESPAWN_SECS / DT) + 5);
  assert(b.alive, "B respawned");
});

step("MP: counter deflects an incoming banana", function () {
  var sim = new Sim({ mode: "mp" });
  sim.monkeys.length = 0;
  var a = sim.addPlayer("A"), b = sim.addPlayer("B");
  a.x = 700; a.y = 700; b.x = 760; b.y = 700;
  a.maxHp = b.maxHp = 100000; a.hp = b.hp = 100000;
  // A throws at B; B holds counter
  var aim = aimAt(a, b.x, b.y);
  sim.setInput("A", { aim: aim.aim, aimDist: aim.aimDist, flags: FLAG.THROW });
  sim.step(DT);
  sim.setInput("A", { flags: 0 });
  var deflected = false;
  for (var i = 0; i < 60 && !deflected; i++) {
    b.counterT = 1;                              // hold the window open for the test
    var evs = sim.step(DT);
    evs.forEach(function (e) { if (e.t === "counter") deflected = true; });
    if (sim.bananas.some(function (x) { return x.countered; })) deflected = true;
  }
  assert(deflected, "counter deflected the banana");
});

step("hide trees: climb in -> concealed & invulnerable -> climb out", function () {
  var sim = new Sim({ mode: "sp" });
  assert(sim.layout.hideTrees.length >= 3 && sim.layout.hideTrees.length <= 4, "3-4 hide trees, got " + sim.layout.hideTrees.length);
  sim.monkeys.length = 0;
  var p = sim.addPlayer("p1");
  var tree = sim.layout.hideTrees[0];
  p.x = tree.x; p.y = tree.y + 10;                       // stand next to it (<24)
  sim.setInput("p1", { move: { x: 0, y: 0 }, aim: 0, aimDist: 100, flags: FLAG.INTERACT });
  sim.step(DT);
  assert(p.hidden === true, "climbed in -> hidden");
  assert(p.invulnerable() === true, "hidden is invulnerable");
  assert(sim.nearestPlayer(p.x, p.y) === null, "hidden excluded from nearestPlayer");
  // a banana aimed at the hidden player should pass through (no damage)
  sim.setInput("p1", { flags: 0 });
  var before = p.hp;
  sim.spawnBanana({ owner: "m", x: p.x - 30, y: p.y - 8, angle: 0, range: 200, speed: 255, dmg: 50, arc: 4 });
  run(sim, 30);
  assert(p.hp === before, "hidden player not hit by banana");
  // climb down (climbCd has expired; press E again for an edge)
  sim.setInput("p1", { flags: FLAG.INTERACT });
  sim.step(DT);
  assert(p.hidden === false, "climbed down");
});

step("snapshot shape is serializable", function () {
  var sim = new Sim({ mode: "mp" });
  sim.addPlayer("A"); sim.addPlayer("B");
  run(sim, 30);
  var snap = sim.snapshot();
  var json = JSON.stringify(snap);
  assert(json.length > 50, "snapshot serializes");
  assert(snap.players.length === 2, "2 players in snapshot");
  assert(Array.isArray(snap.monkeys), "monkeys array present");
});

step("MP soak: 4 players random inputs (1200 steps)", function () {
  var sim = new Sim({ mode: "mp" });
  ["A", "B", "C", "D"].forEach(function (id) { sim.addPlayer(id, id); });
  var ids = ["A", "B", "C", "D"];
  for (var i = 0; i < 1200; i++) {
    ids.forEach(function (id) {
      sim.setInput(id, { move: { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1 },
        aim: Math.random() * 6.28, aimDist: 50 + Math.random() * 180,
        flags: (Math.random() < 0.3 ? FLAG.THROW : 0) | (Math.random() < 0.05 ? FLAG.SLIDE : 0) |
               (Math.random() < 0.05 ? FLAG.COUNTER : 0) | (Math.random() < 0.1 ? FLAG.INTERACT : 0) });
    });
    sim.step(DT);
  }
  assert(true, "no exceptions in 1200-step 4p soak");
});

console.log("");
if (fails.length) { console.log("FAILURES (" + fails.length + "):\n" + fails.join("\n\n")); process.exit(1); }
else console.log("ALL SIM TESTS PASSED");
