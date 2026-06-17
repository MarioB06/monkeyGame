/* Integration test for the modular OFFLINE client (index.html stack) under a
   stubbed DOM/canvas/WebAudio. Loads every src/* and client/* module the page
   loads, boots app-offline, and drives the full flow: title -> play -> move/
   throw/slide/counter -> crack chest -> collect part -> force win -> restart ->
   game over -> restart. Fails on any exception. */
"use strict";
var fs = require("fs"), vm = require("vm"), path = require("path");
var ROOT = path.join(__dirname, "..");
var fails = [];
function step(name, fn) { try { fn(); console.log("ok   " + name); } catch (e) { fails.push(name + ": " + (e && e.stack || e)); console.log("FAIL " + name + " -> " + e); } }
function assert(c, m) { if (!c) throw new Error("assert: " + m); }

/* ---- DOM / canvas / audio stubs ---- */
function makeEl() {
  var el = { style: { setProperty: function () {} }, children: [], parentNode: null, textContent: "", innerHTML: "",
    classList: { _s: {}, add: function (c) { this._s[c] = 1; }, remove: function (c) { delete this._s[c]; }, contains: function (c) { return !!this._s[c]; } },
    listeners: {}, appendChild: function (c) { el.children.push(c); c.parentNode = el; return c; },
    removeChild: function (c) { var i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    addEventListener: function (t, f) { (el.listeners[t] = el.listeners[t] || []).push(f); }, removeEventListener: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 960, height: 540 }; } };
  return el;
}
function makeCtx() {
  var s = { canvas: null, imageSmoothingEnabled: false, globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, globalCompositeOperation: "", font: "" };
  return new Proxy(s, { get: function (t, p) {
    if (p in t) return t[p];
    return function () {
      if (p === "getImageData") { var w = Math.max(1, arguments[2] | 0), h = Math.max(1, arguments[3] | 0); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
      if (p === "createLinearGradient" || p === "createRadialGradient") return { addColorStop: function () {} };
      if (p === "measureText") return { width: 1 };
    };
  }, set: function (t, p, v) { t[p] = v; return true; } });
}
function makeCanvas() { var c = makeEl(); c.width = 8; c.height = 8; var ctx = null; c.getContext = function () { if (!ctx) { ctx = makeCtx(); ctx.canvas = c; } return ctx; }; return c; }

var registry = {};
var docListeners = {};
var win = {};
win.window = win; win.self = win;
win.innerWidth = 1280; win.innerHeight = 720;
win.requestAnimationFrame = function (cb) { win._raf = cb; };
win.addEventListener = function (t, f) { (win._l = win._l || {})[t] = (win._l[t] || []); win._l[t].push(f); };
win.removeEventListener = function () {};
win.AudioContext = function () {
  this.currentTime = 0; this.state = "running"; this.sampleRate = 44100; this.destination = {};
  this.createGain = function () { return { gain: { value: 0, setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }, connect: function () {} }; };
  this.createOscillator = function () { return { type: "", frequency: { setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }, connect: function () {}, start: function () {}, stop: function () {} }; };
  this.createBuffer = function (ch, len) { return { getChannelData: function () { return new Float32Array(len); } }; };
  this.createBufferSource = function () { return { buffer: null, connect: function () {}, start: function () {} }; };
  this.createBiquadFilter = function () { return { type: "", frequency: { value: 0 }, connect: function () {} }; };
  this.resume = function () {};
};
win.localStorage = { _v: {}, getItem: function (k) { return this._v[k] || null; }, setItem: function (k, v) { this._v[k] = String(v); } };
win.performance = { now: function () { return Date.now(); } };
win.document = {
  readyState: "complete", documentElement: makeEl(),
  createElement: function (t) { return t === "canvas" ? makeCanvas() : makeEl(); },
  getElementById: function (id) { if (!registry[id]) registry[id] = id === "game-canvas" ? makeCanvas() : makeEl(); return registry[id]; },
  addEventListener: function (t, f) { (docListeners[t] = docListeners[t] || []).push(f); }
};

global.window = win; global.self = win; global.document = win.document;
global.localStorage = win.localStorage; global.performance = win.performance;
global.AudioContext = win.AudioContext; global.requestAnimationFrame = win.requestAnimationFrame;

function load(rel) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), { filename: rel }); }

/* ---- drive helpers ---- */
var ts = 0;
function frames(n) { for (var i = 0; i < n; i++) { var cb = win._raf; win._raf = null; ts += 16.7; if (cb) cb(ts); if (!win._raf) throw new Error("rAF not re-armed"); } }
function fireWin(type, ev) { ev = ev || {}; if (!ev.preventDefault) ev.preventDefault = function () {}; (win._l[type] || []).forEach(function (f) { f(ev); }); }
function fireCanvas(type, ev) { ev = ev || {}; if (!ev.preventDefault) ev.preventDefault = function () {}; var cv = registry["game-canvas"]; (cv.listeners[type] || []).forEach(function (f) { f(ev); }); }
function keyDown(code) { fireWin("keydown", { code: code, repeat: false }); }
function keyUp(code) { fireWin("keyup", { code: code }); }

var G, CONFIG, FLAG;

step("boot the offline module stack", function () {
  ["src/config.js", "src/mathutils.js", "src/worldgen.js", "src/sim.js", "src/protocol.js",
   "client/sprites.js", "client/audio.js", "client/fx.js", "client/groundgen.js",
   "client/render.js", "client/input.js", "client/ui.js", "client/app-offline.js"].forEach(load);
  G = win.__GAME__;
  CONFIG = win.CONFIG; FLAG = win.Protocol.FLAG;
  assert(G, "__GAME__ exposed");
  assert(G.state === "start", "starts on title");
  frames(20);
});

step("Enter starts the run", function () { keyDown("Enter"); assert(G.state === "play", "playing"); frames(10); });

step("movement", function () {
  var p = G.sim.players.p1; var x0 = p.x, y0 = p.y;
  keyDown("KeyD"); keyDown("KeyW"); frames(40); keyUp("KeyD"); keyUp("KeyW");
  assert(Math.abs(p.x - x0) + Math.abs(p.y - y0) > 20, "player moved");
});

step("throw via mouse", function () {
  fireCanvas("mousemove", { clientX: 700, clientY: 300 });
  fireCanvas("mousedown", { button: 0 });
  frames(4);
  assert(G.sim.bananas.length >= 1, "banana thrown");
  fireWin("mouseup", { button: 0 });
  frames(40);
});

step("slide / counter / pause / mute keys", function () {
  keyDown("KeyD"); keyDown("ShiftLeft"); frames(2); keyUp("ShiftLeft"); keyUp("KeyD"); frames(20);
  keyDown("Space"); keyUp("Space"); frames(5);
  keyDown("KeyP"); assert(G.state === "pause", "paused"); frames(5);
  keyDown("KeyP"); assert(G.state === "play", "resumed");
  keyDown("KeyM"); keyDown("KeyM"); frames(3);
});

step("crack a chest -> collect a part", function () {
  G.sim.monkeys.length = 0;
  var p = G.sim.players.p1; p.maxHp = p.hp = 100000;
  var chest = G.sim.chests[0], sp = G.layout.chestSpots[0];
  var opened = false, i;
  for (i = 0; i < 260 && !opened; i++) {
    p.x = sp.x; p.y = sp.y + 55;
    G.fx.camera.x = p.x - CONFIG.VIEW_W / 2; G.fx.camera.y = p.y - CONFIG.VIEW_H / 2;
    G.input.mouse.x = sp.x - G.fx.camera.x; G.input.mouse.y = sp.y - G.fx.camera.y;
    G.input.mb.left = true;
    frames(1);
    if (chest.state === "open") opened = true;
  }
  G.input.mb.left = false;
  assert(opened, "chest opened");
  var got = false;
  for (i = 0; i < 120 && !got; i++) { p.x = sp.x; p.y = sp.y + 8; frames(1); if (p.parts >= 1) got = true; }
  assert(p.parts >= 1, "part collected");
});

step("force win (6 parts -> build at station -> rescue -> win screen)", function () {
  var p = G.sim.players.p1; p.partIds = [0, 1, 2, 3, 4, 5]; p.parts = 6; p.maxHp = p.hp = 100000;
  var st = G.layout.station; p.x = st.doorX; p.y = st.doorY + 6;
  keyDown("KeyE");
  for (var i = 0; i < 420 && G.state === "play"; i++) { p.x = st.doorX; p.y = st.doorY + 6; frames(1); }
  keyUp("KeyE");
  assert(G.state === "win", "won, state=" + G.state);
  frames(10);
});

step("R restarts after win", function () { keyDown("KeyR"); assert(G.state === "play", "restarted"); frames(10); });

step("game over via adjacent monkey, then restart", function () {
  var p = G.sim.players.p1; p.hurtT = 0; p.slideT = 0; p.hp = 1; p.maxHp = 100;
  var m = G.sim.monkeys[0]; m.x = p.x + 12; m.y = p.y; m.state = "chase"; m.alerted = true; m.meleeCd = 0; m.hitT = 0;
  for (var i = 0; i < 120 && G.state === "play"; i++) { m.x = p.x + 12; m.y = p.y; frames(1); }
  assert(G.state === "over", "game over, state=" + G.state);
  keyDown("KeyR"); assert(G.state === "play", "restarted after over");
  frames(10);
});

step("hide tree: E toggles hidden through the client stack", function () {
  var p = G.sim.players.p1; p.hurtT = 0;
  var tree = G.layout.hideTrees[0];
  p.x = tree.x; p.y = tree.y + 10;
  keyDown("KeyE"); frames(2);
  assert(p.hidden === true, "hidden after E next to a tree");
  keyUp("KeyE"); frames(32);                 // wait out climbCd (0.4s) + reset the edge
  keyDown("KeyE"); frames(2);
  assert(p.hidden === false, "climbed down after E again");
  keyUp("KeyE"); frames(4);
});

step("soak: 400 frames of random input", function () {
  var codes = ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "Space", "KeyE"];
  for (var i = 0; i < 400; i++) {
    if (Math.random() < 0.2) keyDown(codes[(Math.random() * codes.length) | 0]);
    if (Math.random() < 0.2) keyUp(codes[(Math.random() * codes.length) | 0]);
    if (Math.random() < 0.2) fireCanvas("mousemove", { clientX: Math.random() * 960, clientY: Math.random() * 540 });
    if (Math.random() < 0.1) { G.input.mb.left = Math.random() < 0.5; }
    frames(1);
  }
});

console.log("");
if (fails.length) { console.log("FAILURES (" + fails.length + "):\n" + fails.join("\n\n")); process.exit(1); }
else console.log("ALL OFFLINE TESTS PASSED");
