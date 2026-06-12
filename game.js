/* ============================================================================
   MONKEY CITY: SIGNAL LOST
   A pixel-art 2.5D jungle-ruin adventure in plain JS + Canvas 2D.

   - No frameworks, no assets, no modules: runs straight from file://
   - All sprites are generated in code at boot (see "SPRITE FACTORY").
   - The world ground layer is pre-rendered once into an offscreen canvas;
     everything standing on it is y-sorted every frame for the 2.5D look.
   - Structure:
       CONFIG ............ all balancing constants
       utils / RNG ....... math helpers + seeded random for world gen
       PIXEL FONT ........ tiny 3x5 bitmap font for in-canvas text
       AUDIO ............. Web Audio synthesized sound effects
       SPRITE FACTORY .... procedural pixel sprites
       Input ............. keyboard + mouse
       Particles ......... generic particle system (2 layers)
       Camera ............ smooth follow + screen shake
       WORLD ............. zones, ground prerender, solid objects
       ENTITIES .......... Player, Monkey, Banana, Chest, Pickup, Helicopter
       UI ................ DOM HUD, popups, screens
       Game .............. state machine + main loop
   ========================================================================== */

"use strict";
(function () {

/* ============================================================================
   CONFIG -- tweak the game here
   ========================================================================== */
var CONFIG = {
  VIEW_W: 480, VIEW_H: 270,          // internal pixel resolution
  WORLD_W: 1600, WORLD_H: 1200,      // world size in pixels
  WORLD_SEED: 20260612,              // fixed seed -> same map every run

  PLAYER: {
    SPEED: 116,            // run speed px/s
    HP: 100,
    STAMINA: 100,
    STAM_REGEN: 30,        // per second (after a short delay)
    STAM_DELAY: 0.55,      // seconds after sliding before regen starts
    SLIDE_COST: 32,
    SLIDE_SPEED: 305,      // slide burst speed
    SLIDE_TIME: 0.30,      // slide duration (full i-frames)
    SLIDE_CD: 0.15,        // delay before next slide
    THROW_CD: 0.50,        // seconds between bananas
    FAST_THROW_CD: 0.22,   // while golden banana power is active
    GOLD_TIME: 7,          // golden banana duration
    IFRAMES: 0.95,         // invulnerability after a hit
    COUNTER_WINDOW: 0.18,  // active counter time after pressing
    COUNTER_CD: 0.55,
    COUNTER_RADIUS: 30,    // how close a banana must be to deflect
    RADIUS: 5              // feet collision radius
  },

  BANANA: {
    SPEED: 255,            // player banana speed
    RANGE: 235,            // max throw distance (lands at cursor inside this)
    DMG: 25,
    ARC: 13,               // visual arc height
    RETURN_SPEED: 165,     // returned (caught) banana speed
    RETURN_DMG: 14,
    MONKEY_DMG: 10,        // normal monkey throw damage
    COUNTER_SPEED_MULT: 1.75,
    COUNTER_DMG_MULT: 2.2
  },

  // Per-type monkey stats. catch = chance to catch an incoming banana.
  MONKEY: {
    normal: { hp: 50,  speed: 56, aggro: 125, throwRange: 100, catch: 0.12,
              meleeDmg: 8,  throwDmg: 10, throwCd: [1.6, 2.6], score: 100, scale: 1   },
    guard:  { hp: 80,  speed: 64, aggro: 150, throwRange: 115, catch: 0.30,
              meleeDmg: 11, throwDmg: 12, throwCd: [1.3, 2.2], score: 200, scale: 1.18 },
    alpha:  { hp: 230, speed: 72, aggro: 185, throwRange: 140, catch: 0.55,
              meleeDmg: 16, throwDmg: 16, throwCd: [1.0, 1.7], score: 1000, scale: 1.7 }
  },
  MONKEY_LEASH: 150,        // wander distance from home
  MONKEY_ALERT_LEASH: 330,  // leash while angry
  CATCH_HOLD: [0.5, 0.95],  // how long a monkey holds a caught banana

  CHEST_HP: 2,              // banana hits to crack a chest open
  PART_TOTAL: 6,            // electronic parts needed

  DROPS: { HEART: 0.20, GOLD: 0.15 },  // monkey death drop chances
  HEART_HEAL: 30,

  SCORE: { HIT: 10, CHEST: 150, PART: 250, COUNTER: 75, CATCH_PENALTY: 0 },
  COMBO_TIME: 2.5,          // seconds to keep a combo alive

  BUILD_TIME: 2.6,          // seconds to build the signal device
  DAY_LENGTH: 95,           // seconds for a full day/night cycle

  CAMERA_LERP: 6.5,
  CAMERA_LOOKAHEAD: 22
};

/* ============================================================================
   UTILS + RNG
   ========================================================================== */
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t)  { return a + (b - a) * t; }
function dist(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
function angTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
function rand(a, b)  { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(arr)   { return arr[Math.floor(Math.random() * arr.length)]; }
function chance(p)   { return Math.random() < p; }

// Deterministic RNG (mulberry32) -- used only for world generation so the
// map layout is identical every run.
function mulberry32(seed) {
  var s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var WR = mulberry32(CONFIG.WORLD_SEED);      // world random
function wrand(a, b)  { return a + WR() * (b - a); }
function wrandi(a, b) { return Math.floor(wrand(a, b + 1)); }
function wpick(arr)   { return arr[Math.floor(WR() * arr.length)]; }

// distance from point to segment (used to keep trees off the dirt paths)
function segDist(px_, py_, x1, y1, x2, y2) {
  var dx = x2 - x1, dy = y2 - y1;
  var l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(px_, py_, x1, y1);
  var t = clamp(((px_ - x1) * dx + (py_ - y1) * dy) / l2, 0, 1);
  return dist(px_, py_, x1 + t * dx, y1 + t * dy);
}

/* ============================================================================
   PIXEL FONT -- tiny 3x5 bitmap font drawn with fillRect
   '#' = pixel on. Rows separated by '|'. Variable width per glyph.
   ========================================================================== */
var FONT = {
  "A": ".#.|#.#|###|#.#|#.#", "B": "##.|#.#|##.|#.#|##.", "C": ".##|#..|#..|#..|.##",
  "D": "##.|#.#|#.#|#.#|##.", "E": "###|#..|##.|#..|###", "F": "###|#..|##.|#..|#..",
  "G": "###|#..|#.#|#.#|###", "H": "#.#|#.#|###|#.#|#.#", "I": "###|.#.|.#.|.#.|###",
  "J": "..#|..#|..#|#.#|.#.", "K": "#.#|#.#|##.|#.#|#.#", "L": "#..|#..|#..|#..|###",
  "M": "#...#|##.##|#.#.#|#...#|#...#", "N": "#..#|##.#|#.##|#..#|#..#",
  "O": "###|#.#|#.#|#.#|###", "P": "##.|#.#|##.|#..|#..", "Q": ".#.|#.#|#.#|#.#|.##",
  "R": "##.|#.#|##.|#.#|#.#", "S": ".##|#..|.#.|..#|##.", "T": "###|.#.|.#.|.#.|.#.",
  "U": "#.#|#.#|#.#|#.#|###", "V": "#.#|#.#|#.#|#.#|.#.",
  "W": "#...#|#...#|#.#.#|#.#.#|.#.#.", "X": "#.#|#.#|.#.|#.#|#.#",
  "Y": "#.#|#.#|.#.|.#.|.#.", "Z": "###|..#|.#.|#..|###",
  "0": "###|#.#|#.#|#.#|###", "1": ".#.|##.|.#.|.#.|###", "2": "##.|..#|.#.|#..|###",
  "3": "###|..#|.##|..#|###", "4": "#.#|#.#|###|..#|..#", "5": "###|#..|##.|..#|##.",
  "6": ".##|#..|###|#.#|###", "7": "###|..#|.#.|.#.|.#.", "8": "###|#.#|###|#.#|###",
  "9": "###|#.#|###|..#|##.",
  "!": "#|#|#|.|#", "?": "###|..#|.#.|...|.#.", ".": ".|.|.|.|#", ",": ".|.|.|#|#",
  ":": ".|#|.|#|.", "/": "..#|..#|.#.|#..|#..", "-": "...|...|###|...|...",
  "+": "...|.#.|###|.#.|...", "'": "#|#|.|.|.", "(": ".#|#.|#.|#.|.#",
  ")": "#.|.#|.#|.#|#.", ">": "#..|.#.|..#|.#.|#..", "<": "..#|.#.|#..|.#.|..#",
  "%": "#.#|..#|.#.|#..|#.#", "x": "...|#.#|.#.|#.#|...",
  " ": "...|...|...|...|..."
};
// pre-split glyph rows once
var FONT_GLYPHS = {};
(function () {
  for (var k in FONT) FONT_GLYPHS[k] = FONT[k].split("|");
})();

function textW(str, scale) {
  scale = scale || 1;
  var w = 0;
  for (var i = 0; i < str.length; i++) {
    var g = FONT_GLYPHS[str[i]] || FONT_GLYPHS[str[i].toUpperCase()] || FONT_GLYPHS["?"];
    w += (g[0].length + 1) * scale;
  }
  return w - scale;
}

// Draw bitmap text. align: 0=left, 0.5=center, 1=right
function drawText(g, str, x, y, color, scale, align) {
  scale = scale || 1;
  if (align) x -= textW(str, scale) * align;
  g.fillStyle = color;
  var cx = x;
  for (var i = 0; i < str.length; i++) {
    var gl = FONT_GLYPHS[str[i]] || FONT_GLYPHS[str[i].toUpperCase()] || FONT_GLYPHS["?"];
    for (var r = 0; r < gl.length; r++) {
      var row = gl[r];
      for (var c = 0; c < row.length; c++) {
        if (row[c] === "#") g.fillRect(cx + c * scale, y + r * scale, scale, scale);
      }
    }
    cx += (gl[0].length + 1) * scale;
  }
}
// Same but with a 1px drop shadow for readability over the world.
function drawTextShadow(g, str, x, y, color, scale, align) {
  scale = scale || 1;
  drawText(g, str, x + scale, y + scale, "rgba(0,0,0,0.7)", scale, align);
  drawText(g, str, x, y, color, scale, align);
}

/* ============================================================================
   AUDIO -- tiny Web Audio synthesizer. Created lazily on first user input
   (browser autoplay policy). Every call is wrapped so audio can never
   break the game.
   ========================================================================== */
var AudioSys = {
  ctx: null, master: null, muted: false, failed: false,

  init: function () {
    if (this.ctx || this.failed) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.failed = true; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.failed = true; }
  },

  resume: function () {
    try { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); } catch (e) {}
  },

  toggleMute: function () {
    this.muted = !this.muted;
    try { if (this.master) this.master.gain.value = this.muted ? 0 : 0.4; } catch (e) {}
    return this.muted;
  },

  // single sliding tone
  tone: function (f0, f1, dur, type, vol, delay) {
    if (!this.ctx || this.muted) return;
    try {
      var t = this.ctx.currentTime + (delay || 0);
      var o = this.ctx.createOscillator();
      var gn = this.ctx.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(Math.max(20, f0), t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      gn.gain.setValueAtTime(vol || 0.15, t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(gn); gn.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  },

  // filtered white-noise burst
  noise: function (dur, vol, freq, delay) {
    if (!this.ctx || this.muted) return;
    try {
      var t = this.ctx.currentTime + (delay || 0);
      var len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var src = this.ctx.createBufferSource();
      src.buffer = buf;
      var fl = this.ctx.createBiquadFilter();
      fl.type = "lowpass"; fl.frequency.value = freq || 800;
      var gn = this.ctx.createGain();
      gn.gain.setValueAtTime(vol || 0.2, t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(fl); fl.connect(gn); gn.connect(this.master);
      src.start(t);
    } catch (e) {}
  },

  // named sound effects
  sfx: function (name, p) {
    if (!this.ctx || this.muted) return;
    var T = this.tone.bind(this), N = this.noise.bind(this);
    switch (name) {
      case "throw":     N(0.07, 0.10, 2400); T(620, 290, 0.10, "square", 0.06); break;
      case "mthrow":    N(0.06, 0.08, 1800); T(420, 220, 0.10, "square", 0.06); break;
      case "hitMonkey": T(320, 110, 0.12, "square", 0.18); N(0.05, 0.12, 900); break;
      case "kill":      T(420, 90, 0.22, "square", 0.2); N(0.12, 0.15, 600); break;
      case "thunk":     T(150, 80, 0.08, "square", 0.16); N(0.05, 0.18, 400); break;
      case "catch":     T(330, 330, 0.08, "square", 0.16); T(247, 247, 0.12, "square", 0.16, 0.09); break;
      case "counter":   T(880, 1760, 0.12, "square", 0.2); N(0.06, 0.1, 3000); break;
      case "hurt":      T(220, 70, 0.25, "sawtooth", 0.24); N(0.1, 0.18, 500); break;
      case "slide":     N(0.13, 0.10, 1500); break;
      case "chestHit":  T(210, 150, 0.07, "square", 0.16); T(1100, 700, 0.05, "square", 0.07); break;
      case "chestOpen": T(523, 523, 0.09, "square", 0.16); T(659, 659, 0.09, "square", 0.16, 0.09);
                        T(784, 784, 0.09, "square", 0.16, 0.18); T(1046, 1046, 0.16, "square", 0.18, 0.27); break;
      case "part":      T(660, 660, 0.08, "square", 0.16); T(880, 880, 0.08, "square", 0.16, 0.08);
                        T(1320, 1320, 0.14, "square", 0.16, 0.16); break;
      case "pickup":    T(880, 1320, 0.08, "square", 0.14); break;
      case "heart":     T(520, 780, 0.12, "sine", 0.2); break;
      case "power":     T(440, 880, 0.1, "square", 0.16); T(880, 1760, 0.15, "square", 0.16, 0.1); break;
      case "tick":      T(990, 990, 0.03, "square", 0.08); break;
      case "built":     T(523, 523, 0.1, "square", 0.18); T(659, 659, 0.1, "square", 0.18, 0.1);
                        T(784, 784, 0.1, "square", 0.18, 0.2); T(1046, 1046, 0.3, "square", 0.2, 0.3); break;
      case "beep":      T(1180, 1180, 0.06, "sine", 0.12); break;
      case "heli":      N(0.05, 0.20, 220); break;
      case "roar":      T(130, 55, 0.45, "sawtooth", 0.3); N(0.3, 0.16, 300); break;
      case "lose":      T(392, 392, 0.18, "square", 0.2); T(330, 330, 0.18, "square", 0.2, 0.18);
                        T(262, 262, 0.18, "square", 0.2, 0.36); T(196, 196, 0.42, "square", 0.22, 0.54); break;
      case "win":       T(523, 523, 0.12, "square", 0.2); T(659, 659, 0.12, "square", 0.2, 0.12);
                        T(784, 784, 0.12, "square", 0.2, 0.24); T(1046, 1046, 0.2, "square", 0.2, 0.36);
                        T(784, 784, 0.1, "square", 0.18, 0.56); T(1046, 1046, 0.42, "square", 0.22, 0.66); break;
      case "uiStart":   T(660, 660, 0.08, "square", 0.16); T(880, 880, 0.14, "square", 0.16, 0.08); break;
      case "combo":     T(600 + (p || 0) * 55, 600 + (p || 0) * 55, 0.07, "square", 0.1); break;
      case "denied":    T(180, 140, 0.12, "square", 0.16); break;
      case "spark":     T(1400 + Math.random() * 800, 900, 0.05, "square", 0.06); break;
    }
  }
};

/* ============================================================================
   SPRITE FACTORY -- every sprite is drawn in code into a small offscreen
   canvas at boot. Characters get an automatic 1px dark outline.
   ========================================================================== */
function mk(w, h) {
  var c = document.createElement("canvas");
  c.width = w; c.height = h;
  var g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  return { c: c, g: g };
}
function px(g, x, y, w, h, col) {
  g.fillStyle = col;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
// chunky ellipse made of 1px-tall rows (no antialiasing)
function blob(g, cx, cy, rx, ry, col) {
  g.fillStyle = col;
  for (var r = -ry; r <= ry; r++) {
    var t = r / (ry + 0.001);
    var w = Math.round(rx * Math.sqrt(Math.max(0, 1 - t * t)));
    if (w > 0) g.fillRect(Math.round(cx - w), Math.round(cy + r), w * 2, 1);
  }
}
// build a small sprite from row-strings + palette {char: color}
function rowsSprite(rows, pal) {
  var h = rows.length, w = 0, i;
  for (i = 0; i < h; i++) w = Math.max(w, rows[i].length);
  var m = mk(w, h);
  for (var y = 0; y < h; y++) {
    var row = rows[y];
    for (var x = 0; x < row.length; x++) {
      var col = pal[row[x]];
      if (col) px(m.g, x, y, 1, 1, col);
    }
  }
  return m.c;
}
// add a 1px outline around all opaque pixels (returns a new, larger canvas)
function outlined(src, color) {
  try {
    var m = mk(src.width + 2, src.height + 2);
    m.g.drawImage(src, 1, 1);
    var img = m.g.getImageData(0, 0, m.c.width, m.c.height);
    var d = img.data, W = m.c.width, H = m.c.height;
    var solid = new Uint8Array(W * H);
    var x, y;
    for (y = 0; y < H; y++)
      for (x = 0; x < W; x++)
        solid[y * W + x] = d[(y * W + x) * 4 + 3] > 40 ? 1 : 0;
    var out = mk(W, H);
    out.g.fillStyle = color || "#16100a";
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (!solid[y * W + x]) {
          var n = (x > 0 && solid[y * W + x - 1]) || (x < W - 1 && solid[y * W + x + 1]) ||
                  (y > 0 && solid[(y - 1) * W + x]) || (y < H - 1 && solid[(y + 1) * W + x]);
          if (n) out.g.fillRect(x, y, 1, 1);
        }
      }
    }
    out.g.drawImage(m.c, 0, 0);
    return out.c;
  } catch (e) { return src; }   // canvas tainting can't happen, but stay safe
}
// pure white silhouette copy (hit flash)
function whiteCopy(src) {
  var m = mk(src.width, src.height);
  m.g.drawImage(src, 0, 0);
  m.g.globalCompositeOperation = "source-in";
  m.g.fillStyle = "#ffffff";
  m.g.fillRect(0, 0, src.width, src.height);
  return m.c;
}

var SPR = {};   // global sprite store, filled by buildSprites()

/* ---------------- player frames (drawn facing right) -------------------- */
var PCOL = {
  skin: "#e8b078", skinD: "#c08850", hair: "#2e1c10",
  band: "#cf4836", bandD: "#9a3226",
  shirt: "#7a8a40", shirtD: "#5a6830",
  pack: "#8a5a2e", packD: "#6a4422",
  pants: "#3a4662", boot: "#241a10", belt: "#503a1e"
};
// shared standing body. opts: bob, legB/legF (x offsets), legShort, armF, armB
function playerFrame(opts) {
  var m = mk(20, 22), g = m.g, o = opts || {};
  var bob = o.bob || 0;
  // legs (hip y=15 .. feet y=20)
  var lb = o.legB || 0, lf = o.legF || 0, ls = o.legShort ? 1 : 0;
  px(g, 7 + lb, 15, 2, 4 - ls, PCOL.pants); px(g, 7 + lb, 19 - ls, 2, 2, PCOL.boot);
  px(g, 11 + lf, 15, 2, 4 - ls, PCOL.pants); px(g, 11 + lf, 19 - ls, 2, 2, PCOL.boot);
  // torso
  px(g, 6, 8 + bob, 8, 7, PCOL.shirt);
  px(g, 12, 9 + bob, 2, 6, PCOL.shirtD);            // right-side shade
  px(g, 6, 14 + bob, 8, 1, PCOL.belt);
  px(g, 9, 14 + bob, 1, 1, "#d8b03a");              // buckle
  // backpack (on the back = left, since we face right)
  px(g, 3, 9 + bob, 3, 5, PCOL.pack);
  px(g, 3, 9 + bob, 3, 1, PCOL.packD);
  px(g, 6, 9 + bob, 8, 1, PCOL.packD);              // strap
  // back arm
  if (o.armB === "swing") { px(g, 4, 10 + bob, 2, 3, PCOL.shirtD); px(g, 4, 13 + bob, 2, 1, PCOL.skinD); }
  if (o.armB === "trail") { px(g, 3, 11 + bob, 2, 3, PCOL.shirtD); px(g, 3, 14 + bob, 2, 1, PCOL.skinD); }
  if (o.armB === "up")    { px(g, 5, 2 + bob, 2, 5, PCOL.shirtD);  px(g, 5, 1 + bob, 2, 1, PCOL.skinD); }
  if (o.armB === "out")   { px(g, 2, 9 + bob, 4, 2, PCOL.shirtD);  px(g, 1, 9 + bob, 1, 2, PCOL.skinD); }
  // head (x7..14, y0..7)
  px(g, 7, 0 + bob, 8, 2, PCOL.hair);
  px(g, 7, 2 + bob, 1, 4, PCOL.hair);               // back of head
  px(g, 8, 2 + bob, 7, 5, PCOL.skin);
  px(g, 8, 2 + bob, 7, 1, PCOL.band);               // bandana
  px(g, 7, 2 + bob, 1, 1, PCOL.bandD);
  px(g, 5, 3 + bob, 2, 2, PCOL.band);               // bandana tails
  px(g, 12, 4 + bob, 1, 1, "#1a120a");              // eye
  px(g, 8, 6 + bob, 7, 1, PCOL.skinD);              // chin shade
  px(g, 9, 7 + bob, 3, 1, PCOL.skinD);              // neck
  if (o.mouth) px(g, 13, 5 + bob, 1, 1, "#5a1f14"); // ouch mouth
  // front arm
  var fa = o.armF || "down";
  if (fa === "down")  { px(g, 13, 9 + bob, 2, 4, PCOL.shirt); px(g, 13, 13 + bob, 2, 1, PCOL.skin); }
  if (fa === "swingF"){ px(g, 13, 9 + bob, 2, 2, PCOL.shirt); px(g, 14, 11 + bob, 2, 2, PCOL.shirt); px(g, 15, 13 + bob, 2, 1, PCOL.skin); }
  if (fa === "swingB"){ px(g, 12, 9 + bob, 2, 2, PCOL.shirt); px(g, 11, 11 + bob, 2, 2, PCOL.shirt); px(g, 10, 13 + bob, 2, 1, PCOL.skin); }
  if (fa === "throw") { px(g, 13, 8 + bob, 2, 2, PCOL.shirt); px(g, 15, 8 + bob, 3, 2, PCOL.shirt); px(g, 18, 8 + bob, 1, 2, PCOL.skin); }
  if (fa === "up")    { px(g, 13, 7 + bob, 2, 2, PCOL.shirt); px(g, 14, 4 + bob, 2, 3, PCOL.shirt); px(g, 14, 3 + bob, 2, 1, PCOL.skin); }
  if (fa === "out")   { px(g, 14, 9 + bob, 4, 2, PCOL.shirt); px(g, 18, 9 + bob, 1, 2, PCOL.skin); }
  return outlined(m.c);
}
function playerSlideFrame() {
  var m = mk(24, 14), g = m.g;
  // legs trailing left, body diagonal, head up front-right
  px(g, 2, 9, 4, 2, PCOL.boot);
  px(g, 5, 8, 5, 3, PCOL.pants);
  px(g, 9, 6, 8, 5, PCOL.shirt);
  px(g, 9, 4, 4, 3, PCOL.pack);                      // backpack hump
  px(g, 16, 8, 2, 4, PCOL.shirtD);                   // bracing arm
  px(g, 16, 12, 2, 1, PCOL.skin);
  px(g, 15, 1, 7, 2, PCOL.hair);                     // head
  px(g, 16, 2, 6, 5, PCOL.skin);
  px(g, 16, 2, 6, 1, PCOL.band);
  px(g, 20, 4, 1, 1, "#1a120a");
  return outlined(m.c);
}

/* ---------------- monkey frames ----------------------------------------- */
var MSPEC = {
  normal: { W: 16, H: 15, fur: "#8a5a32", furD: "#6a4324", belly: "#caa06a", face: "#d8b088" },
  guard:  { W: 18, H: 17, fur: "#6e4624", furD: "#523218", belly: "#b08a52", face: "#c8a070" },
  alpha:  { W: 26, H: 22, fur: "#54341c", furD: "#3c2412", belly: "#9a7444", face: "#b89060" }
};
// one monkey frame. type: 'normal'|'guard'|'alpha'. pose: see switch below.
function monkeyFrame(type, pose) {
  var s = MSPEC[type];
  var big = type === "alpha";
  var W = s.W, H = s.H;
  var m = mk(W + 4, H), g = m.g;
  var bob = (pose === "idle1" || pose === "walk1") ? 1 : 0;
  var bw = big ? 14 : 8;            // body width
  var bx = big ? 6 : 4;
  var bTop = (big ? 9 : 6) + bob;
  var legY = H - 2, legW = big ? 3 : 2;

  // tail (curling up-left)
  var tx = bx - 1, ty = bTop + 2;
  px(g, tx, ty, 1, 2, s.furD); px(g, tx - 1, ty - 2, 1, 2, s.furD);
  px(g, tx - 2, ty - 4, 1, 2, s.furD); px(g, tx - 1, ty - 5, 1, 1, s.furD);

  // legs
  var l0 = 0, l1 = 0;
  if (pose === "walk0") { l0 = -1; l1 = 1; }
  if (pose === "walk1") { l0 = 1;  l1 = -1; }
  px(g, bx + 1 + l0, legY, legW, 2, s.furD);
  px(g, bx + bw - legW - 1 + l1, legY, legW, 2, s.furD);

  // body + belly
  px(g, bx, bTop, bw, legY - bTop, s.fur);
  px(g, bx + Math.round(bw * 0.45), bTop + 2, Math.round(bw * 0.4), legY - bTop - 3, s.belly);

  // head (forward = right)
  var hw = big ? 13 : 8, hh = big ? 12 : 8;
  var hx = big ? 12 : 8, hy = bob;
  if (big) {  // alpha mane
    px(g, hx - 2, hy, hw + 3, hh - 1, "#2c1a0c");
  }
  px(g, hx, hy, hw, hh - 1, s.fur);
  px(g, hx + 2, hy + 2, hw - 3, hh - 4, s.face);
  // ears
  px(g, hx - 1, hy + 2, 2, 2, s.fur); px(g, hx + hw - 1, hy + 2, 2, 2, s.fur);
  px(g, hx, hy + 3, 1, 1, "#c87a6a"); px(g, hx + hw - 1, hy + 3, 1, 1, "#c87a6a");
  // eyes + nose
  var ey = hy + (big ? 4 : 3);
  if (pose === "hit") {
    px(g, hx + 3, ey, 1, 1, "#1a120a"); px(g, hx + 5, ey, 1, 1, "#1a120a");
    px(g, hx + 4, ey + 2, 2, 1, "#5a1f14");           // ow
  } else {
    px(g, hx + 3, ey, 1, 1, "#1a120a");
    px(g, hx + (big ? 7 : 5), ey, 1, 1, "#1a120a");
    if (big) { px(g, hx + 2, ey - 1, 3, 1, s.furD); px(g, hx + 6, ey - 1, 3, 1, s.furD); } // angry brows
  }
  px(g, hx + (big ? 5 : 4), ey + 2, 1, 1, s.furD);    // nostril
  if (big) px(g, hx + hw - 3, ey + 3, 1, 2, "#d8c0a0");  // scar

  // guard headband
  if (type === "guard") {
    px(g, hx, hy + 1, hw, 1, "#c03a2a");
    px(g, hx - 1, hy + 2, 1, 2, "#c03a2a");           // knot tail
  }
  // guard stick (resting on shoulder)
  if (type === "guard" && pose !== "dead") {
    px(g, bx - 2, bTop - 4, 1, 7, "#6a4a22");
    px(g, bx - 1, bTop - 1, 1, 3, "#6a4a22");
  }

  // arms
  var armW2 = big ? 3 : 2;
  var shY = bTop + 1, frontX = bx + bw - 1;
  function bananaInHand(hxx, hyy) {  // tiny banana pixels held in hand
    px(g, hxx, hyy, 3, 1, "#f2d23c"); px(g, hxx + 1, hyy - 1, 2, 1, "#f2d23c");
  }
  switch (pose) {
    case "walk0": px(g, frontX, shY, armW2, 3, s.furD); px(g, bx - 1, shY + 1, armW2, 3, s.furD); break;
    case "walk1": px(g, frontX - 1, shY + 1, armW2, 3, s.furD); px(g, bx, shY, armW2, 3, s.furD); break;
    case "windup":
      px(g, frontX, shY - 4, armW2, 4, s.furD);
      bananaInHand(frontX, shY - 6);
      break;
    case "throw": px(g, frontX, shY, 4, armW2, s.furD); break;
    case "hold":
      px(g, bx, shY - 4, armW2, 5, s.furD);
      px(g, bx + bw - armW2, shY - 4, armW2, 5, s.furD);
      break;
    case "hit":
      px(g, bx - 2, shY, 3, armW2, s.furD); px(g, frontX, shY, 3, armW2, s.furD);
      break;
    default:      px(g, frontX, shY, armW2, 4, s.furD); break;
  }
  return outlined(m.c);
}
function monkeyDeadFrame(type) {
  var s = MSPEC[type];
  var big = type === "alpha";
  var W = big ? 30 : 20, H = big ? 14 : 10;
  var m = mk(W, H), g = m.g;
  blob(g, W * 0.42, H - 4, W * 0.36, 3, s.fur);            // body lying flat
  px(g, W - (big ? 12 : 8), H - 8, big ? 10 : 7, big ? 7 : 6, s.fur);  // head on its side
  px(g, W - (big ? 10 : 7), H - 6, big ? 7 : 5, big ? 4 : 3, s.face);
  // X eyes
  px(g, W - (big ? 8 : 6), H - 5, 1, 1, "#1a120a");
  px(g, W - (big ? 6 : 4), H - 5, 1, 1, "#1a120a");
  px(g, 1, H - 5, 3, 1, s.furD);                            // tail flopped out
  return outlined(m.c);
}

/* ---------------- items, chest, helicopter ------------------------------ */
function bananaSprite(body, shade, tip) {
  return outlined(rowsSprite([
    "...tt...",
    "..tyyt..",
    ".tyYyt..",
    ".tyYt...",
    "tyYy....",
    "tyyt....",
    ".tt.....",
  ], { t: tip, y: body, Y: shade }));
}
function chestSprite(state) {
  var m = mk(18, 14), g = m.g;
  var wood = "#8a5430", woodL = "#a06a40", woodD = "#5e3a20";
  var met = "#9aa0aa", metD = "#6a7078";
  if (state === "open") {
    px(g, 1, 0, 16, 4, woodD);              // lid flipped up (back panel)
    px(g, 2, 1, 14, 2, wood);
    px(g, 2, 4, 14, 3, "#241608");          // dark inside
    px(g, 4, 4, 10, 2, "#f0d03a");          // glow inside
    px(g, 1, 7, 16, 6, wood);               // box front
    px(g, 1, 7, 16, 1, woodL);
    px(g, 3, 7, 2, 6, metD); px(g, 13, 7, 2, 6, metD);
  } else {
    px(g, 2, 1, 14, 2, woodL);              // rounded lid
    px(g, 1, 3, 16, 4, wood);
    px(g, 1, 7, 16, 6, wood);
    px(g, 1, 7, 16, 1, woodD);              // lid seam
    px(g, 2, 10, 14, 1, woodD);             // plank line
    px(g, 3, 1, 2, 12, met);  px(g, 13, 1, 2, 12, met);
    px(g, 3, 3, 2, 1, metD);  px(g, 13, 3, 2, 1, metD);
    px(g, 8, 6, 3, 4, "#d8b03a");           // lock
    px(g, 9, 8, 1, 1, "#5e3a20");
    if (state === "cracked") {              // crack zig-zag + popped lock
      px(g, 6, 2, 1, 2, "#241608"); px(g, 7, 4, 1, 2, "#241608");
      px(g, 6, 6, 1, 3, "#241608"); px(g, 11, 3, 1, 3, "#241608");
      px(g, 8, 6, 3, 4, woodD);             // lock smashed dark
    }
  }
  return outlined(m.c);
}
function heliSprite() {
  var m = mk(48, 18), g = m.g;
  var body = "#5a663a", bodyD = "#46522c", glass = "#9adfe8";
  px(g, 26, 6, 18, 3, bodyD);               // tail boom
  px(g, 42, 2, 3, 6, body);                 // tail fin
  blob(g, 16, 9, 13, 6, body);              // main body
  px(g, 4, 6, 8, 5, glass);                 // cockpit glass
  px(g, 4, 6, 8, 1, "#cdeef4");
  px(g, 14, 7, 8, 5, bodyD);                // side door
  px(g, 16, 8, 4, 3, "#e8e8e0");            // door cross panel
  px(g, 17, 8, 2, 3, "#d8483a"); px(g, 16, 9, 4, 1, "#d8483a");
  px(g, 6, 15, 16, 1, "#2a2a24");           // skids
  px(g, 24, 15, 12, 1, "#2a2a24");
  px(g, 9, 13, 1, 2, "#2a2a24"); px(g, 28, 13, 1, 2, "#2a2a24");
  px(g, 20, 1, 2, 4, "#2a2a24");            // rotor mast
  return outlined(m.c, "#10140c");
}

/* ---------------- environment sprites ----------------------------------- */
function treeSprite(variant) {
  var m = mk(44, 52), g = m.g;
  var t1 = "#1d3d1f", t2 = "#2a5a2a", t3 = "#3a7a36", hi = "#4f9a44";
  // trunk + roots
  px(g, 19, 36, 6, 14, "#4a3018");
  px(g, 18, 47, 8, 3, "#3a2412");
  px(g, 16, 49, 3, 2, "#3a2412"); px(g, 25, 49, 3, 2, "#3a2412");
  px(g, 21, 36, 2, 12, "#5e3e20");
  // canopy blobs
  blob(g, 22, 22, 20, 14, t1);
  blob(g, 18, 18, 14, 10, t2);
  blob(g, 27, 16, 11, 9, t2);
  blob(g, 20, 13, 10, 7, t3);
  // leafy speckles
  var rr = mulberry32(variant * 977 + 5);
  for (var i = 0; i < 26; i++) px(g, 6 + rr() * 32, 6 + rr() * 22, 2, 1, rr() < 0.5 ? hi : t3);
  // hanging vines
  for (i = 0; i < 3; i++) {
    var vx = 8 + Math.floor(rr() * 28);
    px(g, vx, 30, 1, 5 + Math.floor(rr() * 7), t1);
  }
  if (variant === 2) {   // banana bunch easter egg
    px(g, 28, 30, 3, 2, "#f2d23c"); px(g, 29, 32, 2, 2, "#f2d23c");
  }
  return m.c;
}
function palmSprite() {
  var m = mk(36, 46), g = m.g;
  // curved trunk
  px(g, 16, 36, 4, 10, "#7a5a30"); px(g, 17, 28, 4, 9, "#8a6a3a");
  px(g, 19, 20, 4, 9, "#7a5a30"); px(g, 20, 14, 4, 7, "#8a6a3a");
  // fronds
  var f = "#3a8a3a", fd = "#2a6a2c";
  px(g, 10, 8, 12, 2, f);  px(g, 4, 10, 8, 2, fd);
  px(g, 22, 6, 10, 2, f);  px(g, 30, 9, 5, 2, fd);
  px(g, 14, 4, 3, 8, f);   px(g, 22, 10, 3, 7, fd);
  px(g, 18, 2, 4, 4, f);
  px(g, 20, 12, 3, 2, "#5e3e20"); px(g, 23, 13, 2, 2, "#5e3e20"); // coconuts
  return m.c;
}
function bushSprite(v) {
  var m = mk(16, 10), g = m.g;
  blob(g, 8, 6, 7, 3, "#234c22");
  blob(g, 6, 4, 5, 3, "#326a30");
  blob(g, 11, 5, 4, 2, "#3a7a36");
  if (v === 1) { px(g, 5, 4, 1, 1, "#d84848"); px(g, 10, 6, 1, 1, "#d84848"); }
  return m.c;
}
function rockSprite() {
  var m = mk(14, 10), g = m.g;
  blob(g, 7, 6, 6, 3, "#5e6266");
  px(g, 3, 3, 7, 3, "#6a6e72");
  px(g, 4, 2, 4, 2, "#7a7e82");
  px(g, 8, 7, 3, 1, "#3a8a3a");      // moss
  return outlined(m.c, "#23262a");
}
function rubbleSprite(v) {
  var m = mk(20, 12), g = m.g;
  var rr = mulberry32(v * 31 + 7);
  for (var i = 0; i < 14; i++) {
    var cols = ["#6a6e72", "#7a7e82", "#5e5a52", "#8a857a"];
    px(g, 1 + rr() * 16, 3 + rr() * 7, 2 + rr() * 3, 2 + rr() * 2, cols[Math.floor(rr() * 4)]);
  }
  px(g, 3, 8, 3, 1, "#3a7a36"); px(g, 14, 5, 2, 1, "#3a7a36");
  return m.c;
}
function carSpriteH(colMain) {
  var m = mk(40, 18), g = m.g;
  var dark = "#23262a";
  px(g, 2, 7, 36, 7, colMain);               // body
  px(g, 2, 7, 36, 2, "#ffffff22");
  px(g, 8, 2, 18, 6, colMain);               // cabin
  px(g, 10, 3, 6, 4, "#1c2a30");             // windows (dark, broken)
  px(g, 18, 3, 6, 4, "#1c2a30");
  px(g, 12, 4, 1, 2, "#cdeef4");             // glass shard glint
  px(g, 2, 9, 4, 3, "#caa84e");              // headlight
  px(g, 35, 9, 3, 3, "#7a2a1a");             // tail light
  // rust + moss
  px(g, 6, 11, 5, 2, "#7a4a22"); px(g, 26, 8, 6, 2, "#7a4a22");
  px(g, 14, 1, 8, 2, "#3a7a36"); px(g, 30, 6, 5, 1, "#3a7a36");
  px(g, 7, 13, 6, 4, dark); px(g, 28, 13, 6, 4, dark);   // flat wheels
  px(g, 9, 14, 2, 2, "#46464a"); px(g, 30, 14, 2, 2, "#46464a");
  return outlined(m.c, "#15171a");
}
function carSpriteV(colMain) {
  var m = mk(20, 26), g = m.g;
  px(g, 3, 3, 14, 20, colMain);              // roof view-ish back
  px(g, 4, 5, 12, 5, "#1c2a30");             // rear window
  px(g, 4, 12, 12, 6, "#3a7a36");            // mossy roof
  px(g, 4, 20, 12, 3, "#1c2a30");            // windshield
  px(g, 1, 6, 2, 5, "#23262a"); px(g, 17, 6, 2, 5, "#23262a");   // wheels
  px(g, 1, 17, 2, 5, "#23262a"); px(g, 17, 17, 2, 5, "#23262a");
  px(g, 5, 1, 3, 2, "#7a2a1a"); px(g, 12, 1, 3, 2, "#7a2a1a");   // tail lights
  px(g, 8, 14, 4, 2, "#7a4a22");             // rust
  return outlined(m.c, "#15171a");
}
function lampSprite(broken) {
  var m = mk(14, 36), g = m.g;
  px(g, 4, 33, 6, 3, "#3a3e44");             // base
  if (broken) {
    px(g, 6, 14, 2, 19, "#4a4e54");          // lower pole
    px(g, 7, 8, 2, 7, "#4a4e54");            // kinked
    px(g, 8, 6, 4, 2, "#4a4e54");
    px(g, 10, 8, 4, 4, "#2a2e34");           // dead head hanging
    px(g, 6, 18, 1, 8, "#2a5a2a");           // vine on pole
  } else {
    px(g, 6, 4, 2, 29, "#4a4e54");
    px(g, 6, 4, 6, 2, "#4a4e54");            // arm
    px(g, 10, 5, 4, 4, "#3a3e44");           // head
    px(g, 11, 6, 2, 2, "#f0e0a0");           // glass
    px(g, 6, 20, 1, 9, "#2a5a2a");           // vine
  }
  return m.c;
}
function hutSprite() {
  var m = mk(44, 34), g = m.g;
  blob(g, 22, 18, 20, 12, "#6a5026");        // thatch dome
  blob(g, 22, 13, 16, 8, "#8a6a32");
  blob(g, 22, 9, 11, 5, "#4a6a2a");          // leafy top
  px(g, 17, 22, 10, 12, "#2a1c10");          // door
  px(g, 19, 22, 6, 1, "#6a4a22");
  px(g, 4, 26, 4, 2, "#caa84e"); px(g, 36, 28, 5, 2, "#caa84e");  // banana piles
  return m.c;
}
function totemSprite() {
  var m = mk(16, 34), g = m.g;
  var cols = ["#b05a3a", "#3a8a8a", "#caa84e"];
  for (var i = 0; i < 3; i++) {
    var y = 2 + i * 10;
    px(g, 2, y, 12, 10, cols[i]);
    px(g, 1, y, 14, 2, "#6a4422");           // band
    px(g, 4, y + 3, 2, 2, "#1a120a");        // eyes
    px(g, 10, y + 3, 2, 2, "#1a120a");
    px(g, 5, y + 7, 6, 1, "#1a120a");        // mouth
  }
  px(g, 0, 2, 3, 3, "#6a4422"); px(g, 13, 2, 3, 3, "#6a4422");    // wings
  return outlined(m.c, "#1a140c");
}
function fountainSprite() {
  var m = mk(56, 40), g = m.g;
  blob(g, 28, 30, 26, 9, "#8a8a82");         // outer ring
  blob(g, 28, 28, 22, 7, "#9a9a92");
  blob(g, 28, 28, 18, 5, "#2e5a4e");         // stagnant water
  px(g, 14, 26, 5, 2, "#3a8a5a"); px(g, 34, 30, 6, 2, "#3a8a5a"); // algae
  px(g, 24, 8, 8, 18, "#9a9a92");            // broken pedestal
  px(g, 24, 8, 8, 2, "#aaaaa2");
  px(g, 26, 4, 4, 5, "#8a8a82");             // snapped top
  px(g, 27, 10, 1, 10, "#5a5a52");           // crack
  px(g, 30, 12, 4, 6, "#2a5a2a");            // vine
  return m.c;
}
function columnSprite() {
  var m = mk(12, 30), g = m.g;
  px(g, 1, 26, 10, 4, "#8a8a82");            // base slab
  px(g, 3, 6, 6, 21, "#9a9a92");
  px(g, 4, 6, 1, 21, "#aaaaa2");             // flute highlight
  px(g, 7, 6, 1, 21, "#6a6a62");
  px(g, 3, 4, 6, 3, "#9a9a92");              // jagged broken top
  px(g, 5, 2, 3, 3, "#9a9a92");
  px(g, 3, 18, 2, 6, "#2a5a2a");             // moss
  return outlined(m.c, "#2a2a26");
}
function signSprite() {
  var m = mk(24, 26), g = m.g;
  px(g, 3, 8, 2, 18, "#5a5048"); px(g, 19, 8, 2, 18, "#5a5048");  // posts
  px(g, 1, 2, 22, 10, "#7a6a4a");            // rusty board
  px(g, 2, 3, 20, 8, "#9a8a62");
  px(g, 3, 4, 8, 2, "#c8b89a");              // peeled paint stripes
  px(g, 13, 4, 6, 2, "#c8b89a");
  px(g, 3, 8, 12, 2, "#c8b89a");
  px(g, 17, 8, 2, 2, "#3a2e22");             // bullet hole
  px(g, 6, 12, 3, 2, "#2a5a2a");             // moss
  return outlined(m.c, "#1f1a12");
}
function fireSprite() {
  var m = mk(16, 10), g = m.g;
  px(g, 1, 6, 3, 3, "#6a6e72"); px(g, 6, 8, 3, 2, "#6a6e72");     // stones
  px(g, 12, 6, 3, 3, "#6a6e72"); px(g, 3, 8, 2, 2, "#5e6266");
  px(g, 4, 5, 8, 2, "#5e3e20"); px(g, 6, 3, 2, 4, "#4a3018");     // logs
  return m.c;
}
function stationSprite() {
  var m = mk(130, 76), g = m.g;
  // main concrete block
  px(g, 0, 14, 130, 62, "#8a8a82");
  px(g, 0, 14, 130, 3, "#a0a098");           // roof edge highlight
  px(g, 0, 8, 130, 6, "#6a6a62");            // roof slab
  px(g, 6, 10, 30, 3, "#3a7a36");            // roof vegetation
  px(g, 90, 9, 24, 3, "#3a7a36");
  // wall panel lines
  for (var i = 1; i < 5; i++) px(g, i * 26, 17, 1, 59, "#7a7a72");
  px(g, 0, 44, 130, 1, "#7a7a72");
  // door with warning stripes
  px(g, 56, 50, 18, 26, "#4a4e54");
  px(g, 57, 51, 16, 24, "#5a5e64");
  for (i = 0; i < 4; i++) px(g, 57, 52 + i * 6, 16, 3, i % 2 ? "#caa84e" : "#3a3e44");
  px(g, 70, 62, 2, 3, "#d8b03a");            // handle
  // boarded window + intact window
  px(g, 18, 30, 16, 12, "#1c2024");
  px(g, 17, 32, 18, 3, "#6a4e2e"); px(g, 17, 37, 18, 3, "#6a4e2e");
  px(g, 96, 28, 18, 14, "#16282e");
  px(g, 98, 30, 5, 5, "#2a4a52");            // glass glint
  // dish on roof
  blob(g, 112, 6, 9, 5, "#b8b8b0");
  px(g, 111, 6, 3, 6, "#8a8a82");
  // painted label
  drawText(g, "RADIO", 40, 22, "#d8d0b8", 2, 0);
  drawText(g, "STATION", 36, 34, "#b8b0a0", 1, 0);
  // moss + cracks
  px(g, 0, 70, 24, 6, "#3a6a32"); px(g, 100, 68, 30, 8, "#3a6a32");
  px(g, 40, 60, 2, 16, "#2a5a2a");
  px(g, 84, 20, 1, 20, "#5a5a52"); px(g, 85, 38, 1, 10, "#5a5a52");
  return m.c;
}
function towerSprite() {
  var m = mk(30, 96), g = m.g;
  var steel = "#7a6a52", steelD = "#5a4e3c";
  // converging lattice legs
  for (var i = 0; i < 8; i++) {
    var y = 88 - i * 11;
    var inset = i * 1.2;
    px(g, 4 + inset, y - 11, 2, 12, steel);
    px(g, 24 - inset, y - 11, 2, 12, steel);
    px(g, 5 + inset, y - 4, 19 - inset * 2, 2, steelD);   // cross brace
  }
  px(g, 12, 6, 6, 4, steel);                 // top platform
  px(g, 14, 0, 2, 7, "#4a4e54");             // antenna spike
  px(g, 13, 0, 4, 2, "#8a2a1a");             // beacon (lit at runtime)
  px(g, 6, 60, 2, 10, "#2a5a2a");            // vines on leg
  px(g, 22, 40, 2, 14, "#2a5a2a");
  return m.c;
}
// ruined building generator -- unique per instance, seeded
function buildingSprite(w, h, seed) {
  var rr = mulberry32(seed);
  var m = mk(w, h), g = m.g;
  var walls = ["#8a857a", "#7d8a80", "#928a78", "#857a6e"];
  var wall = walls[Math.floor(rr() * walls.length)];
  var roofH = 14;
  px(g, 0, roofH, w, h - roofH, wall);
  px(g, 0, roofH, w, 2, "#ffffff22");                       // top light edge
  px(g, 0, 0, w, roofH, "#5a564e");                         // roof slab
  px(g, 0, roofH - 2, w, 2, "#46423a");
  // roof vegetation
  for (var i = 0; i < w / 14; i++)
    px(g, rr() * (w - 10), 2 + rr() * (roofH - 7), 6 + rr() * 8, 3, rr() < 0.5 ? "#3a6a32" : "#2a5a2a");
  // window grid
  var cols = Math.max(2, Math.floor((w - 16) / 22));
  var rows2 = Math.max(1, Math.floor((h - roofH - 18) / 24));
  for (var r = 0; r < rows2; r++) {
    for (var c = 0; c < cols; c++) {
      var wx = 10 + c * ((w - 20) / Math.max(1, cols - 1) || 0) - (cols === 1 ? -((w - 20) / 2 - 5) : 0);
      if (cols > 1) wx = 8 + c * ((w - 28) / (cols - 1));
      var wy = roofH + 8 + r * 24;
      var kind = rr();
      px(g, wx, wy, 12, 14, "#1c2024");                     // frame
      if (kind < 0.35) {                                    // boarded
        px(g, wx - 1, wy + 2, 14, 3, "#6a4e2e");
        px(g, wx - 1, wy + 8, 14, 3, "#5e442a");
      } else if (kind < 0.6) {                              // broken shards
        px(g, wx + 2, wy + 2, 3, 4, "#2a4a52");
        px(g, wx + 8, wy + 7, 2, 3, "#2a4a52");
      } else {
        px(g, wx + 1, wy + 1, 10, 5, "#22343a");            // dusty glass
        px(g, wx + 2, wy + 2, 2, 2, "#3a5a64");
      }
    }
  }
  // big crack
  var cx = 6 + rr() * (w - 12), cy = roofH + 4;
  for (i = 0; i < (h - roofH) / 6; i++) {
    px(g, cx, cy, 1, 5, "#55504a");
    cx += rr() < 0.5 ? -2 : 2; cy += 5;
  }
  // hanging vines from roof
  for (i = 0; i < w / 16; i++) {
    var vx = 4 + rr() * (w - 8);
    var vl = 8 + rr() * (h * 0.45);
    px(g, vx, roofH, 2, vl, "#2a5226");
    px(g, vx - 1, roofH + vl - 3, 1, 2, "#3a7a36");
    px(g, vx + 2, roofH + 4 + rr() * vl * 0.5, 1, 2, "#3a7a36");
  }
  // moss along the bottom
  for (i = 0; i < w / 6; i++)
    px(g, rr() * (w - 4), h - 5 + rr() * 3, 3 + rr() * 4, 2, rr() < 0.5 ? "#3a6a32" : "#41773a");
  return m.c;
}

/* ---------------- assemble the SPR store -------------------------------- */
function buildSprites() {
  // player
  SPR.player = {
    idle: [playerFrame({}), playerFrame({ bob: 1 })],
    run: [
      playerFrame({ legB: -2, legF: 2, armF: "swingB", armB: "swing" }),
      playerFrame({ legShort: 1, bob: 1 }),
      playerFrame({ legB: 2, legF: -2, armF: "swingF", armB: "trail" }),
      playerFrame({ legShort: 1, bob: 1 })
    ],
    throwF: playerFrame({ armF: "throw", armB: "trail" }),
    counter: playerFrame({ armF: "up", armB: "out" }),
    hurt: playerFrame({ armF: "out", armB: "out", mouth: true }),
    rise: playerFrame({ armF: "up", armB: "up", legShort: 1 }),
    slide: playerSlideFrame()
  };
  // monkeys
  SPR.monkey = {};
  ["normal", "guard", "alpha"].forEach(function (t) {
    var s = {
      idle: [monkeyFrame(t, "idle0"), monkeyFrame(t, "idle1")],
      walk: [monkeyFrame(t, "walk0"), monkeyFrame(t, "walk1")],
      windup: monkeyFrame(t, "windup"),
      throwF: monkeyFrame(t, "throw"),
      hold: monkeyFrame(t, "hold"),
      hit: monkeyFrame(t, "hit"),
      dead: monkeyDeadFrame(t)
    };
    s.hitFlash = whiteCopy(s.hit);
    SPR.monkey[t] = s;
  });
  // projectiles + items
  SPR.banana  = bananaSprite("#f2d23c", "#fae88a", "#8a6a1a");
  SPR.bananaR = bananaSprite("#f08a3a", "#ffc05a", "#7a2a12");   // returned
  SPR.bananaG = bananaSprite("#ffe680", "#ffffff", "#b08a20");   // countered
  SPR.part  = outlined(rowsSprite([
    ".g.g.g.g..",
    "##########",
    "#cccccccc#",
    "#cRcccLcc#",
    "#cccccccc#",
    "##########",
    ".g.g.g.g.."
  ], { "#": "#10241a", c: "#2a7a4a", R: "#ff4a3a", L: "#caa84e", g: "#d8b03a" }));
  SPR.heart = outlined(rowsSprite([
    ".rr.rr.",
    "rhrrrrr",
    "rrrrrrr",
    ".rrrrr.",
    "..rrr..",
    "...r..."
  ], { r: "#e04848", h: "#ff9a8a" }));
  SPR.star = outlined(rowsSprite([
    "...g...",
    "..ggg..",
    ".ggwgg.",
    "gggwggg",
    ".ggwgg.",
    "..ggg..",
    "...g..."
  ], { g: "#e8c83a", w: "#fff8d0" }));
  SPR.gban = bananaSprite("#ffd84a", "#fff0a0", "#a07a18");
  SPR.crosshair = outlined(rowsSprite([
    "...w...",
    "...w...",
    ".......",
    "ww.w.ww",
    ".......",
    "...w...",
    "...w..."
  ], { w: "#f0f0e0" }), "#10100c");
  SPR.arrow = outlined(rowsSprite([
    "....g....",
    "...ggg...",
    "..ggggg..",
    ".ggggggg.",
    "ggggggggg",
    "...ggg...",
    "...ggg...",
    "...ggg..."
  ], { g: "#f0d03a" }), "#3a2a08");
  // chest + heli
  SPR.chest = { closed: chestSprite("closed"), cracked: chestSprite("cracked"), open: chestSprite("open") };
  SPR.heli = heliSprite();
  // environment
  SPR.trees = [treeSprite(0), treeSprite(1), treeSprite(2), treeSprite(3)];
  SPR.palms = [palmSprite()];
  SPR.bushes = [bushSprite(0), bushSprite(1)];
  SPR.rocks = [rockSprite()];
  SPR.rubbles = [rubbleSprite(0), rubbleSprite(1), rubbleSprite(2)];
  SPR.carH = [carSpriteH("#8a3a2a"), carSpriteH("#3a6a8a"), carSpriteH("#8a7a3a")];
  SPR.carV = [carSpriteV("#5a7a4a"), carSpriteV("#7a4a5a")];
  SPR.lamp = lampSprite(false);
  SPR.lampB = lampSprite(true);
  SPR.hut = hutSprite();
  SPR.totem = totemSprite();
  SPR.fountain = fountainSprite();
  SPR.column = columnSprite();
  SPR.sign = signSprite();
  SPR.fire = fireSprite();
  SPR.station = stationSprite();
  SPR.tower = towerSprite();
  // animated grass tufts (2 frames)
  var g0 = mk(7, 6), g1 = mk(7, 6);
  [[g0.g, 0], [g1.g, 1]].forEach(function (pair) {
    var gg = pair[0], f = pair[1];
    px(gg, 1, 2, 1, 4, "#3a7a36"); px(gg, 3 + f, 0, 1, 6, "#4f9a44");
    px(gg, 5, 1 + f, 1, 5, "#3a7a36"); px(gg, 2 + f, 3, 1, 3, "#2a5a2a");
  });
  SPR.grass = [g0.c, g1.c];
  // flowers
  SPR.flowers = [
    rowsSprite(["..r..", ".rrr.", "..r..", "..s..", "..s.."], { r: "#d85a5a", s: "#3a7a36" }),
    rowsSprite(["..y..", ".yyy.", "..y..", "..s..", "..s.."], { y: "#e8c83a", s: "#3a7a36" }),
    rowsSprite(["..w..", ".www.", "..w..", "..s..", "..s.."], { w: "#e8e8e0", s: "#3a7a36" })
  ];
}

/* ============================================================================
   INPUT -- keyboard state + mouse aim. Discrete actions are forwarded to
   the Game so things like "throw" trigger exactly once per press.
   ========================================================================== */
function Input(game, canvas) {
  var self = this;
  this.keys = {};                       // e.code -> bool
  this.mouse = { x: 240, y: 135 };      // in internal canvas pixels

  function canvasPos(e) {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    self.mouse.x = (e.clientX - r.left) * (CONFIG.VIEW_W / r.width);
    self.mouse.y = (e.clientY - r.top) * (CONFIG.VIEW_H / r.height);
  }

  window.addEventListener("keydown", function (e) {
    var c = e.code || e.key;
    // keep the page from scrolling on game keys
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(c) >= 0)
      e.preventDefault();
    AudioSys.init(); AudioSys.resume();
    if (!e.repeat) {
      self.keys[c] = true;
      game.onKeyDown(c);
    }
  });
  window.addEventListener("keyup", function (e) {
    self.keys[e.code || e.key] = false;
  });
  window.addEventListener("blur", function () { self.keys = {}; });

  canvas.addEventListener("mousemove", canvasPos);
  canvas.addEventListener("mousedown", function (e) {
    canvasPos(e);
    AudioSys.init(); AudioSys.resume();
    e.preventDefault();
    game.onMouseDown(e.button);
  });
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  // clicking anywhere also starts the game from the title screen
  window.addEventListener("mousedown", function () {
    AudioSys.init(); AudioSys.resume();
    if (game.state === "start") game.startRun();
  });
}
Input.prototype.axis = function () {
  var k = this.keys, x = 0, y = 0;
  if (k.KeyA || k.ArrowLeft) x -= 1;
  if (k.KeyD || k.ArrowRight) x += 1;
  if (k.KeyW || k.ArrowUp) y -= 1;
  if (k.KeyS || k.ArrowDown) y += 1;
  if (x && y) { x *= 0.7071; y *= 0.7071; }
  return { x: x, y: y };
};

/* ============================================================================
   PARTICLES -- one pool, two draw layers (0 = on the ground, 1 = in the air)
   kinds: px, spark, leaf, ring, smoke
   ========================================================================== */
function Particles() { this.list = []; }
Particles.prototype.add = function (p) {
  p.t = 0;
  p.life = p.life || 0.6;
  p.kind = p.kind || "px";
  p.layer = p.layer === 0 ? 0 : 1;
  p.size = p.size || 2;
  p.vx = p.vx || 0; p.vy = p.vy || 0;
  p.z = p.z || 0; p.vz = p.vz || 0;
  p.grav = p.grav || 0;
  p.phase = Math.random() * 6.28;
  if (this.list.length < 700) this.list.push(p);
};
// quick radial burst helper
Particles.prototype.burst = function (x, y, n, opts) {
  opts = opts || {};
  for (var i = 0; i < n; i++) {
    var a = rand(0, 6.283), sp = rand(opts.spMin || 20, opts.spMax || 70);
    this.add({
      x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6,
      z: opts.z || 4, vz: rand(20, 60), grav: 160,
      life: rand(0.25, opts.life || 0.6),
      size: opts.size || 2, col: opts.cols ? pick(opts.cols) : (opts.col || "#f2d23c"),
      kind: opts.kind || "px", layer: 1
    });
  }
};
Particles.prototype.update = function (dt) {
  var l = this.list;
  for (var i = l.length - 1; i >= 0; i--) {
    var p = l[i];
    p.t += dt;
    if (p.t >= p.life) { l.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.grav) p.vz -= p.grav * dt;
    p.z += p.vz * dt;
    if (p.z < 0) { p.z = 0; p.vz *= -0.4; if (Math.abs(p.vz) < 8) p.vz = 0; }
    if (p.kind === "leaf") { p.x += Math.sin(p.t * 5 + p.phase) * 14 * dt; }
  }
};
Particles.prototype.draw = function (g, layer, time) {
  var l = this.list;
  for (var i = 0; i < l.length; i++) {
    var p = l[i];
    if (p.layer !== layer) continue;
    var k = 1 - p.t / p.life;
    if (p.kind === "ring") {
      g.globalAlpha = k * 0.8;
      g.strokeStyle = p.col;
      g.lineWidth = p.lw || 1;
      g.beginPath();
      g.arc(p.x, p.y, (p.r0 || 2) + (p.r1 || 30) * (p.t / p.life), 0, 6.283);
      g.stroke();
      g.globalAlpha = 1;
    } else if (p.kind === "smoke") {
      g.globalAlpha = k * 0.35;
      var s = p.size + p.t * 8;
      g.fillStyle = p.col || "#888880";
      g.fillRect(p.x - s / 2, p.y - p.z - s / 2, s, s);
      g.globalAlpha = 1;
    } else if (p.kind === "leaf") {
      g.globalAlpha = Math.min(1, k * 2);
      g.fillStyle = p.col;
      var tumble = Math.sin(p.t * 9 + p.phase) > 0;
      g.fillRect(p.x, p.y - p.z, tumble ? 2 : 1, tumble ? 1 : 2);
      g.globalAlpha = 1;
    } else {                              // px / spark
      g.globalAlpha = p.kind === "spark" ? k : Math.min(1, k * 1.6);
      g.fillStyle = p.col;
      var sz = Math.max(1, Math.round(p.size * (p.kind === "spark" ? 1 : k)));
      g.fillRect(Math.round(p.x - sz / 2), Math.round(p.y - p.z - sz / 2), sz, sz);
      g.globalAlpha = 1;
    }
  }
};

/* ============================================================================
   CAMERA -- smooth follow + shake, clamped to the world
   ========================================================================== */
function Camera() {
  this.x = 0; this.y = 0;
  this.shake = 0;
  this.sx = 0; this.sy = 0;     // current shake offset
  this.focus = null;            // optional override target {x,y}
}
Camera.prototype.jumpTo = function (x, y) {
  this.x = clamp(x - CONFIG.VIEW_W / 2, 0, CONFIG.WORLD_W - CONFIG.VIEW_W);
  this.y = clamp(y - CONFIG.VIEW_H / 2, 0, CONFIG.WORLD_H - CONFIG.VIEW_H);
};
Camera.prototype.update = function (dt, game) {
  var tx, ty;
  if (this.focus) { tx = this.focus.x; ty = this.focus.y; }
  else {
    var p = game.player;
    // small look-ahead toward the aim cursor
    var aim = game.aimWorld();
    tx = p.x + clamp(aim.x - p.x, -160, 160) / 160 * CONFIG.CAMERA_LOOKAHEAD;
    ty = p.y + clamp(aim.y - p.y, -100, 100) / 100 * CONFIG.CAMERA_LOOKAHEAD * 0.7;
  }
  var k = Math.min(1, dt * CONFIG.CAMERA_LERP);
  this.x = lerp(this.x, clamp(tx - CONFIG.VIEW_W / 2, 0, CONFIG.WORLD_W - CONFIG.VIEW_W), k);
  this.y = lerp(this.y, clamp(ty - CONFIG.VIEW_H / 2, 0, CONFIG.WORLD_H - CONFIG.VIEW_H), k);
  // shake
  this.shake = Math.max(0, this.shake - dt * 14);
  var a = this.shake;
  this.sx = rand(-a, a); this.sy = rand(-a, a);
};
Camera.prototype.addShake = function (a) { this.shake = Math.min(7, this.shake + a); };

/* ============================================================================
   WORLD -- pre-rendered ground + static objects + collision rects.
   The map is hand-laid-out with seeded random detail, so it is identical
   every run. Zones: start, overgrown street, monkey camp, ruined plaza,
   chest grove, radio station, helipad.
   ========================================================================== */
function WorldObject(spr, x, y, collW, collH, solid) {
  this.spr = spr;
  this.x = x; this.y = y;          // y = baseline (feet line) for sorting
  this.collW = collW; this.collH = collH;
  this.solid = !!solid;
  this.sortY = y;
}
WorldObject.prototype.rect = function () {
  return { l: this.x - this.collW / 2, r: this.x + this.collW / 2,
           t: this.y - this.collH, b: this.y };
};
WorldObject.prototype.draw = function (g) {
  g.drawImage(this.spr, Math.round(this.x - this.spr.width / 2), Math.round(this.y - this.spr.height));
};

function buildWorld() {
  var W = CONFIG.WORLD_W, H = CONFIG.WORLD_H;
  var world = {
    objects: [], solids: [], lamps: [], fires: [], tufts: [],
    playerSpawn: { x: 220, y: 1000 },
    station: { x: 1320, y: 240, doorX: 1320, doorY: 256 },
    towerTop: { x: 1430, y: 148 },
    helipad: { x: 1370, y: 468 },
    chestSpots: [
      { x: 180, y: 210,  guard: true  },   // chest grove NW
      { x: 350, y: 330,  guard: true  },   // chest grove SE
      { x: 830, y: 470,  guard: true  },   // ruined plaza
      { x: 1300, y: 1010, guard: true },   // monkey camp
      { x: 430, y: 724,  guard: true  },   // overgrown street (west)
      { x: 1480, y: 660, guard: true  },   // eastern ruins
      { x: 1532, y: 1116, guard: false, bonus: true }  // hidden bonus chest
    ],
    monkeySpots: [
      { x: 520, y: 540, type: "normal" }, { x: 650, y: 700, type: "normal" },
      { x: 900, y: 530, type: "normal" }, { x: 660, y: 380, type: "normal" },
      { x: 860, y: 300, type: "normal" }, { x: 1150, y: 850, type: "normal" },
      { x: 1350, y: 900, type: "normal" }, { x: 1200, y: 1020, type: "normal" },
      { x: 1420, y: 1060, type: "normal" }, { x: 140, y: 360, type: "normal" },
      { x: 1500, y: 770, type: "normal" },
      { x: 1320, y: 300, type: "alpha" }          // boss guards the station
    ]
  };

  /* ---------- ground layer (painted once) ---------- */
  var gr = mk(W, H), g = gr.g;
  world.groundCanvas = gr.c;

  // base jungle floor with noise
  px(g, 0, 0, W, H, "#2e5a28");
  var i, x, y;
  for (i = 0; i < 2600; i++) {
    var c = WR();
    px(g, WR() * W, WR() * H, 2 + WR() * 4, 2 + WR() * 3,
       c < 0.4 ? "#356331" : (c < 0.8 ? "#27511f" : "#3a6e30"));
  }
  for (i = 0; i < 220; i++)   // rare dirt + leaf-litter freckles
    px(g, WR() * W, WR() * H, 2, 2, WR() < 0.5 ? "#54452a" : "#6a5a30");

  // darker jungle border band
  for (i = 0; i < 700; i++) {
    var bx = WR() * W, by = WR() * H;
    if (bx > 90 && bx < W - 90 && by > 90 && by < H - 90) continue;
    px(g, bx, by, 4 + WR() * 6, 3 + WR() * 4, WR() < 0.5 ? "#1d3d1f" : "#234c22");
  }

  // dirt paths between zones (thick ragged polylines)
  var paths = [
    [[220, 950], [330, 820], [420, 700], [440, 616]],
    [[560, 380], [470, 350], [420, 330]],
    [[1280, 860], [1190, 740], [1120, 668]],
    [[1320, 256], [1350, 380], [1370, 420]],
    [[1255, 250], [1100, 330], [1010, 460], [940, 576]],
    [[1370, 540], [1340, 700], [1300, 800]],
    [[250, 400], [250, 520], [300, 564]]
  ];
  world.paths = paths;
  paths.forEach(function (path) {
    for (var s = 0; s < path.length - 1; s++) {
      var ax = path[s][0], ay = path[s][1], bx2 = path[s + 1][0], by2 = path[s + 1][1];
      var steps = Math.ceil(dist(ax, ay, bx2, by2) / 5);
      for (var st = 0; st <= steps; st++) {
        var t = st / steps;
        var cx2 = lerp(ax, bx2, t) + wrand(-3, 3), cy2 = lerp(ay, by2, t) + wrand(-3, 3);
        blob(g, cx2, cy2, 7 + WR() * 3, 4 + WR() * 2, WR() < 0.7 ? "#6a5430" : "#5e4a2a");
      }
    }
  });

  // trampled clearings: start camp + monkey camp
  blob(g, 220, 990, 130, 90, "#3f7233");
  blob(g, 200, 1010, 30, 18, "#6a5430");
  blob(g, 1290, 950, 200, 150, "#7a5e34");
  for (i = 0; i < 90; i++)
    px(g, 1090 + WR() * 400, 800 + WR() * 300, 2, 2, WR() < 0.5 ? "#6a5028" : "#8a6e3e");
  // chest grove floor (darker, leafy)
  blob(g, 250, 250, 180, 150, "#27511f");
  for (i = 0; i < 80; i++)
    px(g, 90 + WR() * 320, 110 + WR() * 280, 2, 2, WR() < 0.5 ? "#54452a" : "#1d3d1f");

  /* ---------- roads (the overgrown street) ---------- */
  function roadH(rx, ry, rw, rh) {
    px(g, rx, ry - 14, rw, 14, "#6a675e");                  // sidewalks
    px(g, rx, ry + rh, rw, 14, "#6a675e");
    for (var sx2 = rx; sx2 < rx + rw; sx2 += 16) {
      px(g, sx2, ry - 14, 1, 14, "#56544c"); px(g, sx2, ry + rh, 1, 14, "#56544c");
    }
    px(g, rx, ry, rw, rh, "#3c3c40");                       // asphalt
    for (var n = 0; n < rw / 4; n++)
      px(g, rx + WR() * rw, ry + WR() * rh, 2 + WR() * 3, 1 + WR() * 2, WR() < 0.5 ? "#44444a" : "#36363a");
    for (var d = rx + 10; d < rx + rw; d += 26)             // faded lane dashes
      if (WR() > 0.3) px(g, d, ry + rh / 2 - 1, 10, 2, "#a8a08a");
  }
  function roadV(rx, ry, rw, rh) {
    px(g, rx - 14, ry, 14, rh, "#6a675e");
    px(g, rx + rw, ry, 14, rh, "#6a675e");
    for (var sy2 = ry; sy2 < ry + rh; sy2 += 16) {
      px(g, rx - 14, sy2, 14, 1, "#56544c"); px(g, rx + rw, sy2, 14, 1, "#56544c");
    }
    px(g, rx, ry, rw, rh, "#3c3c40");
    for (var n = 0; n < rh / 4; n++)
      px(g, rx + WR() * rw, ry + WR() * rh, 1 + WR() * 2, 2 + WR() * 3, WR() < 0.5 ? "#44444a" : "#36363a");
    for (var d = ry + 10; d < ry + rh; d += 26)
      if (WR() > 0.3) px(g, rx + rw / 2 - 1, d, 2, 10, "#a8a08a");
  }
  roadH(16, 576, W - 32, 80);
  roadV(720, 16, 80, H - 32);
  // cracks, potholes and grass punching through the asphalt
  for (i = 0; i < 26; i++) {
    var crx = 30 + WR() * (W - 60), cry = 580 + WR() * 70;
    if (WR() < 0.4) { crx = 724 + WR() * 70; cry = 30 + WR() * (H - 60); }
    for (var cs = 0; cs < 8; cs++) {
      px(g, crx, cry, 1, 2, "#2a2a2e");
      crx += wrand(-2, 3); cry += wrand(-1, 3);
    }
  }
  for (i = 0; i < 9; i++) {
    var phx = 40 + WR() * (W - 80), phy = 584 + WR() * 62;
    if (WR() < 0.4) { phx = 726 + WR() * 66; phy = 40 + WR() * (H - 80); }
    blob(g, phx, phy, 4 + WR() * 4, 2 + WR() * 2, "#2a2a2e");
    blob(g, phx, phy, 2 + WR() * 2, 1 + WR() * 1, "#54452a");
  }
  for (i = 0; i < 50; i++) {
    var ghx = 30 + WR() * (W - 60), ghy = 578 + WR() * 74;
    if (WR() < 0.4) { ghx = 722 + WR() * 74; ghy = 30 + WR() * (H - 60); }
    px(g, ghx, ghy, 2, 2, WR() < 0.5 ? "#356331" : "#3a6e30");
  }

  /* ---------- ruined plaza paving ---------- */
  for (y = 250; y < 540; y += 16) {
    for (x = 520; x < 940; x += 16) {
      if (WR() < 0.80) {
        px(g, x, y, 15, 15, WR() < 0.7 ? "#8a8578" : "#7d786c");
        if (WR() < 0.18) px(g, x + WR() * 10, y + WR() * 10, 4, 1, "#5a5650");   // cracks
        if (WR() < 0.10) px(g, x + WR() * 10, y + WR() * 10, 3, 3, "#356331");   // weeds
      }
    }
  }

  /* ---------- helipad ---------- */
  blob(g, 1370, 468, 62, 46, "#c8c8c0");
  blob(g, 1370, 468, 56, 41, "#7a7a72");
  px(g, 1348, 448, 7, 40, "#c8c8c0");           // big H
  px(g, 1385, 448, 7, 40, "#c8c8c0");
  px(g, 1355, 464, 30, 7, "#c8c8c0");
  for (i = 0; i < 14; i++)
    px(g, 1320 + WR() * 100, 430 + WR() * 75, 3, 1, WR() < 0.5 ? "#5a5a52" : "#3a6e30");

  /* ---------- puddles, flowers, pebbles ---------- */
  var puddles = [[480, 760], [1060, 480], [620, 1050], [980, 720], [340, 480]];
  puddles.forEach(function (pd) {
    blob(g, pd[0], pd[1], 10 + WR() * 8, 4 + WR() * 3, "#3a5a66");
    blob(g, pd[0] - 2, pd[1] - 1, 4, 2, "#5a7a86");
  });
  for (i = 0; i < 90; i++) {
    var fx = 40 + WR() * (W - 80), fy = 40 + WR() * (H - 80);
    g.drawImage(SPR.flowers[wrandi(0, 2)], Math.round(fx), Math.round(fy));
  }
  for (i = 0; i < 260; i++)
    px(g, WR() * W, WR() * H, 1, 1, WR() < 0.5 ? "#7a7e82" : "#1d3d1f");

  /* ---------- world border solids ---------- */
  world.solids.push({ l: -40, t: -40, r: W + 40, b: 16 });
  world.solids.push({ l: -40, t: H - 16, r: W + 40, b: H + 40 });
  world.solids.push({ l: -40, t: 0, r: 16, b: H });
  world.solids.push({ l: W - 16, t: 0, r: W + 40, b: H });

  /* ---------- static objects ---------- */
  function addObj(spr, ox, oy, cw, ch, solid) {
    var o = new WorldObject(spr, ox, oy, cw, ch, solid);
    world.objects.push(o);
    if (solid) world.solids.push(o.rect());
    return o;
  }

  // ruined buildings: [centerX, baselineY, spriteW, spriteH]
  var builds = [
    [250, 790, 170, 110], [560, 180, 170, 120], [1010, 190, 140, 100],
    [480, 890, 160, 120], [980, 905, 140, 110], [130, 520, 120, 90]
  ];
  builds.forEach(function (b, bi) {
    addObj(buildingSprite(b[2], b[3], 100 + bi * 37), b[0], b[1], b[2], b[3] - 26, true);
  });

  // radio station + tower (collision is handled like a building)
  addObj(SPR.station, world.station.x, world.station.y, 130, 46, true);
  addObj(SPR.tower, 1430, 240, 18, 12, true);

  // crashed cars
  addObj(SPR.carH[0], 480, 640, 38, 12, true);
  addObj(SPR.carH[1], 940, 604, 38, 12, true);
  addObj(SPR.carH[2], 1240, 632, 38, 12, true);
  addObj(SPR.carV[0], 760, 380, 18, 22, true);
  addObj(SPR.carV[1], 310, 1052, 18, 22, true);   // overgrown wreck at camp

  // street lamps (kept in a list for night glow)
  var lampDefs = [
    [240, 572, 0], [600, 572, 1], [960, 572, 0], [1320, 572, 0],
    [420, 672, 0], [1140, 672, 1], [1480, 672, 0],
    [706, 300, 0], [814, 520, 0], [706, 900, 0], [814, 1060, 1]
  ];
  lampDefs.forEach(function (L) {
    addObj(L[2] ? SPR.lampB : SPR.lamp, L[0], L[1], 6, 5, true);
    if (!L[2]) world.lamps.push({ x: L[0] + 5, y: L[1] - 29 });   // glow at the head
  });

  // monkey camp decorations
  addObj(SPR.hut, 1180, 890, 38, 16, true);
  addObj(SPR.hut, 1340, 968, 38, 16, true);
  addObj(SPR.hut, 1230, 1070, 38, 16, true);
  addObj(SPR.totem, 1410, 870, 10, 8, true);
  addObj(SPR.fire, 1280, 965, 12, 6, false);
  world.fires.push({ x: 1280, y: 960 });
  // player's little camp
  addObj(SPR.fire, 190, 1015, 12, 6, false);
  world.fires.push({ x: 190, y: 1010 });
  addObj(SPR.sign, 310, 930, 16, 5, true);
  addObj(SPR.sign, 850, 692, 16, 5, true);

  // plaza ruins
  addObj(SPR.fountain, 740, 430, 46, 16, true);
  [[570, 300], [910, 300], [570, 545], [910, 545]].forEach(function (cp) {
    addObj(SPR.column, cp[0], cp[1], 10, 7, true);
  });
  [[640, 485], [845, 330], [1090, 640], [380, 560], [1180, 380]].forEach(function (rp, ri) {
    addObj(SPR.rubbles[ri % 3], rp[0], rp[1], 16, 8, true);
  });
  [[520, 470], [880, 510], [1460, 540], [240, 660], [1090, 240]].forEach(function (rp) {
    addObj(SPR.rocks[0], rp[0], rp[1], 11, 6, true);
  });

  /* ---------- trees ---------- */
  // keep-clear regions for scattered trees
  var clearRects = [
    { l: 500, t: 220, r: 960, b: 560 },     // plaza
    { l: 1070, t: 760, r: 1540, b: 1140 },  // camp
    { l: 1140, t: 70, r: 1520, b: 300 },    // station
    { l: 0, t: 540, r: W, b: 700 },         // h-road corridor
    { l: 690, t: 0, r: 830, b: H }          // v-road corridor
  ];
  builds.forEach(function (b) {
    clearRects.push({ l: b[0] - b[2] / 2 - 14, t: b[1] - b[3] - 14, r: b[0] + b[2] / 2 + 14, b: b[1] + 14 });
  });
  function nearPath(tx2, ty2) {
    for (var pi = 0; pi < paths.length; pi++) {
      var p2 = paths[pi];
      for (var s2 = 0; s2 < p2.length - 1; s2++)
        if (segDist(tx2, ty2, p2[s2][0], p2[s2][1], p2[s2 + 1][0], p2[s2 + 1][1]) < 28) return true;
    }
    return false;
  }
  function treeBlocked(tx2, ty2, treeList, minDist) {
    if (dist(tx2, ty2, 220, 990) < 160) return true;            // start camp
    if (dist(tx2, ty2, 1370, 468) < 105) return true;           // helipad
    for (var ci = 0; ci < world.chestSpots.length; ci++)
      if (dist(tx2, ty2, world.chestSpots[ci].x, world.chestSpots[ci].y) < 46) return true;
    for (ci = 0; ci < world.monkeySpots.length; ci++)
      if (dist(tx2, ty2, world.monkeySpots[ci].x, world.monkeySpots[ci].y) < 40) return true;
    for (ci = 0; ci < clearRects.length; ci++) {
      var r2 = clearRects[ci];
      if (tx2 > r2.l && tx2 < r2.r && ty2 > r2.t && ty2 < r2.b) return true;
    }
    if (nearPath(tx2, ty2)) return true;
    for (ci = 0; ci < treeList.length; ci++)
      if (dist(tx2, ty2, treeList[ci][0], treeList[ci][1]) < minDist) return true;
    return false;
  }
  var treePts = [];
  // dense border ring (visual jungle wall; the real wall is the border solid)
  for (x = 30; x < W - 20; x += 44) {
    treePts.push([x + wrand(-10, 10), 36 + wrand(-6, 14)]);
    treePts.push([x + wrand(-10, 10), H - 14 + wrand(-12, 2)]);
  }
  for (y = 70; y < H - 40; y += 46) {
    treePts.push([28 + wrand(-6, 12), y + wrand(-10, 10)]);
    treePts.push([W - 28 + wrand(-12, 6), y + wrand(-10, 10)]);
  }
  // hidden chest nook: ring of trees with a small gap (entrance from the west)
  [[1480, 1080], [1530, 1070], [1568, 1100], [1568, 1150], [1500, 1160]].forEach(function (tp) {
    treePts.push(tp);
  });
  // scattered jungle
  var scattered = [];
  for (i = 0; i < 240 && scattered.length < 46; i++) {
    var tx = 60 + WR() * (W - 120), ty = 80 + WR() * (H - 140);
    if (treeBlocked(tx, ty, scattered, 52)) continue;
    scattered.push([tx, ty]);
  }
  // dense grove in the chest area
  for (i = 0; i < 120 && scattered.length < 60; i++) {
    var gx = 90 + WR() * 330, gy = 110 + WR() * 290;
    if (treeBlocked(gx, gy, scattered, 44)) continue;
    scattered.push([gx, gy]);
  }
  treePts = treePts.concat(scattered);
  treePts.forEach(function (tp, ti) {
    if (ti % 7 === 3) addObj(SPR.palms[0], tp[0], tp[1], 8, 6, true);
    else addObj(SPR.trees[ti % 4], tp[0], tp[1], 10, 7, true);
  });

  // bushes (walk-through) + animated grass tufts
  for (i = 0; i < 250 && world.tufts.length < 46; i++) {
    var ux = 50 + WR() * (W - 100), uy = 50 + WR() * (H - 100);
    if (nearPath(ux, uy)) continue;
    world.tufts.push({ x: ux, y: uy, phase: WR() * 6.28 });
  }
  for (i = 0; i < 90; i++) {
    var bx2 = 50 + WR() * (W - 100), by3 = 70 + WR() * (H - 140);
    if (treeBlocked(bx2, by3, [], 0)) continue;
    addObj(SPR.bushes[wrandi(0, 1)], bx2, by3, 0, 0, false);
    if (world.objects.length > 420) break;
  }

  return world;
}

/* ---------- collision helpers ---------- */
// push a circle (feet) out of all solid rects + world bounds
function resolveCircle(x, y, r, solids) {
  for (var i = 0; i < solids.length; i++) {
    var s = solids[i];
    var cx = clamp(x, s.l, s.r), cy = clamp(y, s.t, s.b);
    var dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 === 0) {     // centre is inside the box: exit through nearest face
        var pl = x - s.l, pr = s.r - x, pt = y - s.t, pb = s.b - y;
        var mn = Math.min(pl, pr, pt, pb);
        if (mn === pl) x = s.l - r; else if (mn === pr) x = s.r + r;
        else if (mn === pt) y = s.t - r; else y = s.b + r;
      } else {
        var d = Math.sqrt(d2);
        x = cx + dx / d * r; y = cy + dy / d * r;
      }
    }
  }
  return { x: x, y: y };
}
function pointBlocked(x, y, solids) {
  for (var i = 0; i < solids.length; i++) {
    var s = solids[i];
    if (x > s.l && x < s.r && y > s.t && y < s.b) return true;
  }
  return false;
}

/* ============================================================================
   PLAYER
   ========================================================================== */
function Player(game, x, y) {
  this.game = game;
  this.x = x; this.y = y;
  this.hp = CONFIG.PLAYER.HP; this.maxHp = CONFIG.PLAYER.HP;
  this.stamina = CONFIG.PLAYER.STAMINA;
  this.stamDelay = 0;
  this.cooldown = 0;          // banana throw cooldown
  this.goldT = 0;             // golden banana (fast throw) timer
  this.slideT = 0; this.slideCd = 0;
  this.slideDX = 1; this.slideDY = 0;
  this.counterT = 0;          // active counter window
  this.counterCd = 0;
  this.counterFxT = 0;        // swing visual
  this.hurtT = 0;             // i-frames
  this.hurtAnimT = 0;
  this.throwAnimT = 0;
  this.facing = 1;
  this.moving = false;
  this.animT = 0;
  this.riseZ = 0;             // lifted by the helicopter
  this.sortY = y;
}
Player.prototype.invulnerable = function () {
  return this.hurtT > 0 || this.slideT > 0 || this.game.state === "rescue";
};
Player.prototype.update = function (dt) {
  var g = this.game, C = CONFIG.PLAYER;
  this.cooldown = Math.max(0, this.cooldown - dt);
  this.goldT = Math.max(0, this.goldT - dt);
  this.slideCd = Math.max(0, this.slideCd - dt);
  this.counterT = Math.max(0, this.counterT - dt);
  this.counterCd = Math.max(0, this.counterCd - dt);
  this.counterFxT = Math.max(0, this.counterFxT - dt);
  this.hurtT = Math.max(0, this.hurtT - dt);
  this.hurtAnimT = Math.max(0, this.hurtAnimT - dt);
  this.throwAnimT = Math.max(0, this.throwAnimT - dt);
  this.animT += dt;

  // stamina regen
  this.stamDelay = Math.max(0, this.stamDelay - dt);
  if (this.stamDelay <= 0 && this.slideT <= 0)
    this.stamina = Math.min(C.STAMINA, this.stamina + C.STAM_REGEN * dt);

  var locked = g.controlLocked();
  var ax = 0, ay = 0;
  if (!locked) {
    var a = g.input.axis();
    ax = a.x; ay = a.y;
  }
  this.moving = (ax !== 0 || ay !== 0) && this.slideT <= 0;

  var vx, vy;
  if (this.slideT > 0) {
    this.slideT -= dt;
    var k = 0.45 + 0.55 * (this.slideT / C.SLIDE_TIME);   // ease-out burst
    vx = this.slideDX * C.SLIDE_SPEED * k;
    vy = this.slideDY * C.SLIDE_SPEED * k;
    if (Math.random() < 0.6)
      g.particles.add({ x: this.x - this.slideDX * 6, y: this.y, vx: -this.slideDX * 16, vy: 6,
                        life: 0.4, size: 3, col: "#9a8a6a", kind: "smoke", layer: 1 });
    if (this.slideT <= 0) this.slideCd = C.SLIDE_CD;
  } else {
    vx = ax * C.SPEED; vy = ay * C.SPEED;
  }
  this.x += vx * dt; this.y += vy * dt;
  var fix = resolveCircle(this.x, this.y, C.RADIUS, g.solids);
  this.x = clamp(fix.x, 20, CONFIG.WORLD_W - 20);
  this.y = clamp(fix.y, 20, CONFIG.WORLD_H - 20);

  // face the aim cursor
  if (!locked) {
    var aim = g.aimWorld();
    this.facing = aim.x >= this.x ? 1 : -1;
  }
  this.sortY = this.y;
};
Player.prototype.tryThrow = function () {
  var g = this.game, C = CONFIG.PLAYER;
  if (g.controlLocked() || this.cooldown > 0 || this.slideT > 0) return;
  var aim = g.aimWorld();
  var d = clamp(dist(this.x, this.y, aim.x, aim.y), 40, CONFIG.BANANA.RANGE);
  var ang = angTo(this.x, this.y - 10, aim.x, aim.y);
  g.bananas.push(new Banana(g, {
    owner: "p", x: this.x + this.facing * 6, y: this.y - 10,
    angle: ang, range: d, speed: CONFIG.BANANA.SPEED, dmg: CONFIG.BANANA.DMG,
    arc: CONFIG.BANANA.ARC * (0.5 + 0.5 * d / CONFIG.BANANA.RANGE)
  }));
  this.cooldown = this.goldT > 0 ? C.FAST_THROW_CD : C.THROW_CD;
  this.throwAnimT = 0.16;
  AudioSys.sfx("throw");
};
Player.prototype.trySlide = function () {
  var g = this.game, C = CONFIG.PLAYER;
  if (g.controlLocked() || this.slideT > 0 || this.slideCd > 0) return;
  if (this.stamina < C.SLIDE_COST) { AudioSys.sfx("denied"); return; }
  var a = g.input.axis();
  if (a.x === 0 && a.y === 0) { a.x = this.facing; a.y = 0; }
  var len = Math.sqrt(a.x * a.x + a.y * a.y);
  this.slideDX = a.x / len; this.slideDY = a.y / len;
  this.slideT = C.SLIDE_TIME;
  this.stamina -= C.SLIDE_COST;
  this.stamDelay = C.STAM_DELAY;
  AudioSys.sfx("slide");
  g.particles.burst(this.x, this.y, 5, { cols: ["#9a8a6a", "#7a6a4a"], spMax: 40, size: 2 });
};
Player.prototype.tryCounter = function () {
  var g = this.game, C = CONFIG.PLAYER;
  if (g.controlLocked() || this.counterCd > 0) return;
  this.counterT = C.COUNTER_WINDOW;
  this.counterCd = C.COUNTER_CD;
  this.counterFxT = 0.2;
  AudioSys.noise(0.06, 0.07, 2600);    // whiff swish (success adds its own sfx)
};
Player.prototype.hurt = function (dmg, fromX, fromY) {
  var g = this.game;
  if (this.invulnerable() || g.state !== "play") return false;
  this.hp -= dmg;
  this.hurtT = CONFIG.PLAYER.IFRAMES;
  this.hurtAnimT = 0.3;
  // knockback away from the source
  if (fromX !== undefined) {
    var ang = angTo(fromX, fromY, this.x, this.y);
    this.x += Math.cos(ang) * 7; this.y += Math.sin(ang) * 7;
  }
  g.camera.addShake(3);
  g.hurtFlash = 0.45;
  g.resetCombo();
  AudioSys.sfx("hurt");
  g.particles.burst(this.x, this.y - 8, 7, { cols: ["#d8483a", "#8a2a1a"], spMax: 60 });
  if (this.hp <= 0) { this.hp = 0; g.gameOver(); }
  return true;
};
Player.prototype.draw = function (g) {
  // blink during i-frames
  if (this.hurtT > 0 && Math.floor(this.animT * 18) % 2 === 0 && this.game.state === "play") return;
  var S = SPR.player, spr;
  if (this.game.state === "rescue" && this.riseZ > 2) spr = S.rise;
  else if (this.slideT > 0) spr = S.slide;
  else if (this.hurtAnimT > 0) spr = S.hurt;
  else if (this.throwAnimT > 0) spr = S.throwF;
  else if (this.counterFxT > 0.1) spr = S.counter;
  else if (this.moving) spr = S.run[Math.floor(this.animT * 10) % 4];
  else spr = S.idle[Math.floor(this.animT * 2.2) % 2];

  var dx = Math.round(this.x), dy = Math.round(this.y - this.riseZ);
  g.save();
  g.translate(dx, dy);
  if (this.facing < 0) g.scale(-1, 1);
  g.drawImage(spr, Math.round(-spr.width / 2), -spr.height + 1);
  g.restore();

  // counter swing arc
  if (this.counterFxT > 0) {
    var k = 1 - this.counterFxT / 0.2;
    g.globalAlpha = 1 - k;
    g.strokeStyle = "#f0f0d0";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(dx, dy - 10, 12 + k * 10, -1.1 * this.facing + (this.facing < 0 ? Math.PI : 0) - 0.9, -1.1 * this.facing + (this.facing < 0 ? Math.PI : 0) + 0.9);
    g.stroke();
    g.globalAlpha = 1;
  }
};

/* ============================================================================
   MONKEY -- states: idle, wander, chase, windup, throwing, hold, return, dead
   ========================================================================== */
function Monkey(game, x, y, type) {
  this.game = game;
  this.type = type;
  this.stats = CONFIG.MONKEY[type];
  this.x = x; this.y = y;
  this.home = { x: x, y: y };
  this.hp = this.stats.hp;
  this.state = "idle";
  this.stateT = rand(0.4, 1.6);
  this.target = { x: x, y: y };
  this.throwCd = rand(this.stats.throwCd[0], this.stats.throwCd[1]);
  this.meleeCd = 0;
  this.hitT = 0;              // stun after being hit
  this.deadT = 0;
  this.alerted = false;
  this.guardChest = null;     // set for chest guards
  this.facing = 1;
  this.animT = Math.random() * 9;
  this.radius = type === "alpha" ? 7 : 4;
  this.height = type === "alpha" ? 20 : 13;
  this.roared = false;
  this.sortY = y;
}
Monkey.prototype.alive = function () { return this.state !== "dead"; };
Monkey.prototype.canCatch = function () {
  return this.alive() && this.hitT <= 0 && this.state !== "hold" && this.state !== "windup";
};
Monkey.prototype.leashCenter = function () {
  return this.guardChest ? { x: this.guardChest.x, y: this.guardChest.y } : this.home;
};
Monkey.prototype.update = function (dt) {
  var g = this.game, st = this.stats, p = g.player;
  this.animT += dt;
  if (this.state === "dead") { this.deadT += dt; return; }

  this.throwCd = Math.max(0, this.throwCd - dt);
  this.meleeCd = Math.max(0, this.meleeCd - dt);
  if (this.hitT > 0) { this.hitT -= dt; return; }   // stunned

  var dP = dist(this.x, this.y, p.x, p.y);
  var aggroR = st.aggro * (this.alerted ? 1.6 : 1);
  var lc = this.leashCenter();
  var leashR = this.alerted ? CONFIG.MONKEY_ALERT_LEASH : CONFIG.MONKEY_LEASH;
  var speed = st.speed;
  var vx = 0, vy = 0;
  var playing = g.state === "play";   // don't attack during cinematics

  switch (this.state) {
    case "idle":
      this.stateT -= dt;
      if (playing && dP < aggroR) this.enterChase();
      else if (this.stateT <= 0) {
        var a = rand(0, 6.28), r = rand(20, leashR * 0.7);
        this.target = { x: lc.x + Math.cos(a) * r, y: lc.y + Math.sin(a) * r };
        this.state = "wander"; this.stateT = rand(1.2, 2.6);
      }
      break;

    case "wander":
      this.stateT -= dt;
      var dT = dist(this.x, this.y, this.target.x, this.target.y);
      if (playing && dP < aggroR) { this.enterChase(); break; }
      if (dT < 6 || this.stateT <= 0) { this.state = "idle"; this.stateT = rand(0.5, 1.8); break; }
      vx = (this.target.x - this.x) / dT * speed * 0.55;
      vy = (this.target.y - this.y) / dT * speed * 0.55;
      break;

    case "chase":
      if (!playing) { this.state = "idle"; this.stateT = 1; break; }
      this.facing = p.x >= this.x ? 1 : -1;
      if (dist(this.x, this.y, lc.x, lc.y) > leashR * 1.9 && dP > aggroR) {
        this.state = "return"; break;
      }
      if (dP < st.throwRange && this.throwCd <= 0 && dP > 26) {
        this.state = "windup"; this.stateT = 0.45; break;
      }
      // melee when very close
      if (dP < 15 && this.meleeCd <= 0) {
        if (p.hurt(st.meleeDmg, this.x, this.y)) {
          this.meleeCd = 1.15;
          g.particles.burst(p.x, p.y - 6, 4, { cols: ["#e8e0c8"], spMax: 50 });
        } else this.meleeCd = 0.4;
      }
      if (dP > 14) {
        vx = (p.x - this.x) / dP * speed;
        vy = (p.y - this.y) / dP * speed;
      }
      break;

    case "windup":
      this.facing = p.x >= this.x ? 1 : -1;
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.throwBananaAt(p, false);
        this.state = "throwing"; this.stateT = 0.25;
        this.throwCd = rand(st.throwCd[0], st.throwCd[1]);
      }
      break;

    case "throwing":
      this.stateT -= dt;
      if (this.stateT <= 0) this.state = "chase";
      break;

    case "hold":   // holding a caught banana over its head
      this.facing = p.x >= this.x ? 1 : -1;
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.throwBananaAt(p, true);
        this.state = "throwing"; this.stateT = 0.25;
      }
      break;

    case "return":
      var dH = dist(this.x, this.y, lc.x, lc.y);
      if (dH < 10) { this.state = "idle"; this.stateT = rand(0.5, 1.5); break; }
      if (playing && dP < aggroR * 0.8) { this.enterChase(); break; }
      vx = (lc.x - this.x) / dH * speed * 0.8;
      vy = (lc.y - this.y) / dH * speed * 0.8;
      break;
  }

  // soft separation so monkeys don't stack
  var list = g.monkeys;
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    if (o === this || !o.alive()) continue;
    var d2 = dist(this.x, this.y, o.x, o.y);
    if (d2 > 0.01 && d2 < 12) {
      vx += (this.x - o.x) / d2 * 30;
      vy += (this.y - o.y) / d2 * 30;
    }
  }

  if (vx || vy) {
    if (this.state === "wander" || this.state === "return")
      this.facing = vx >= 0 ? 1 : -1;
    this.x += vx * dt; this.y += vy * dt;
    var fix = resolveCircle(this.x, this.y, this.radius, g.solids);
    this.x = clamp(fix.x, 22, CONFIG.WORLD_W - 22);
    this.y = clamp(fix.y, 22, CONFIG.WORLD_H - 22);
  }
  this.moving = !!(vx || vy);
  this.sortY = this.y;
};
Monkey.prototype.enterChase = function () {
  this.state = "chase";
  if (this.type === "alpha" && !this.roared) {
    this.roared = true;
    AudioSys.sfx("roar");
    this.game.camera.addShake(3);
    this.game.ui.msg("THE ALPHA HAS SEEN YOU!", "bad");
  }
};
Monkey.prototype.throwBananaAt = function (p, returned) {
  var g = this.game;
  // aim at the player with a touch of lead so running straight away is unsafe
  var tx = p.x + (p.facing * (p.moving ? 14 : 0)) + rand(-8, 8);
  var ty = p.y + rand(-6, 6);
  var d = dist(this.x, this.y, tx, ty) + 14;
  var mkOne = function (angOff) {
    g.bananas.push(new Banana(g, {
      owner: "m", returned: returned,
      x: this.x + this.facing * 5, y: this.y - this.height + 2,
      angle: angTo(this.x, this.y - 8, tx, ty) + angOff,
      range: d, arc: 16,
      speed: returned ? CONFIG.BANANA.RETURN_SPEED : CONFIG.BANANA.RETURN_SPEED * 0.92,
      dmg: returned ? CONFIG.BANANA.RETURN_DMG : this.stats.throwDmg
    }));
  }.bind(this);
  mkOne(0);
  if (this.type === "alpha" && !returned && chance(0.45)) { mkOne(0.22); mkOne(-0.22); }  // fan attack
  AudioSys.sfx("mthrow");
};
Monkey.prototype.catchBanana = function () {
  this.state = "hold";
  this.stateT = rand(CONFIG.CATCH_HOLD[0], CONFIG.CATCH_HOLD[1]);
  this.alerted = true;
  AudioSys.sfx("catch");
  this.game.addFloater(this.x, this.y - this.height - 10, "CAUGHT!", "#f0b03a");
  this.game.ui.msg("MONKEY CAUGHT YOUR BANANA!", "bad");
};
Monkey.prototype.hurtBy = function (dmg, fromX, fromY) {
  if (!this.alive()) return;
  this.hp -= dmg;
  this.hitT = 0.26;
  this.alerted = true;
  if (this.state === "idle" || this.state === "wander" || this.state === "return") this.enterChase();
  var ang = angTo(fromX, fromY, this.x, this.y);
  this.x += Math.cos(ang) * 6; this.y += Math.sin(ang) * 6;
  var g = this.game;
  g.particles.burst(this.x, this.y - 8, 6, { cols: ["#f2d23c", "#8a5a32"], spMax: 70 });
  if (this.hp <= 0) this.die();
  else { AudioSys.sfx("hitMonkey"); g.onMonkeyHit(this); }
};
Monkey.prototype.die = function () {
  this.state = "dead";
  this.deadT = 0;
  AudioSys.sfx("kill");
  this.game.onMonkeyKilled(this);
};
Monkey.prototype.draw = function (g) {
  var S = SPR.monkey[this.type], spr;
  var t = this.animT;
  if (this.state === "dead") {
    var fade = clamp(1 - (this.deadT - 4) / 1.5, 0, 1);
    g.globalAlpha = fade;
    spr = S.dead;
    g.drawImage(spr, Math.round(this.x - spr.width / 2), Math.round(this.y - spr.height + 1));
    g.globalAlpha = 1;
    return;
  }
  if (this.hitT > 0) spr = (Math.floor(t * 24) % 2) ? S.hitFlash : S.hit;
  else if (this.state === "windup") spr = S.windup;
  else if (this.state === "throwing") spr = S.throwF;
  else if (this.state === "hold") spr = S.hold;
  else if (this.moving) spr = S.walk[Math.floor(t * 8) % 2];
  else spr = S.idle[Math.floor(t * 2.5) % 2];

  g.save();
  g.translate(Math.round(this.x), Math.round(this.y));
  if (this.facing < 0) g.scale(-1, 1);
  g.drawImage(spr, Math.round(-spr.width / 2), -spr.height + 1);
  g.restore();

  // caught banana held above the head
  if (this.state === "hold") {
    var bob = Math.sin(t * 10) * 1.5;
    g.drawImage(SPR.bananaR, Math.round(this.x - 4), Math.round(this.y - this.height - 9 + bob));
  }
  // attack telegraph
  if (this.state === "windup")
    drawTextShadow(g, "!", this.x - 1, this.y - this.height - 12, "#f05a3a", 1, 0);
};

/* ============================================================================
   BANANA projectile -- straight 2D flight, the arc is purely visual (z).
   ========================================================================== */
function Banana(game, o) {
  this.game = game;
  this.owner = o.owner;             // 'p' player | 'm' monkey
  this.returned = !!o.returned;     // thrown back after a catch
  this.countered = false;           // deflected by the player's counter
  this.x = o.x; this.y = o.y;
  this.vx = Math.cos(o.angle); this.vy = Math.sin(o.angle);
  this.speed = o.speed;
  this.dmg = o.dmg;
  this.maxD = o.range;
  this.arc = o.arc || 12;
  this.traveled = 0;
  this.rot = rand(0, 6.28);
  this.trailT = 0;
  this.dead = false;
  this.sortY = this.y;
}
Banana.prototype.zOf = function () {
  var p = clamp(this.traveled / this.maxD, 0, 1);
  return lerp(9, 1, p) + this.arc * 4 * p * (1 - p);
};
Banana.prototype.impact = function (big) {
  if (this.dead) return;
  this.dead = true;
  this.game.particles.burst(this.x, this.y - this.zOf(), big ? 8 : 5,
    { cols: ["#f2d23c", "#caa42c", "#fae88a"], spMax: big ? 90 : 55, size: 2 });
};
Banana.prototype.update = function (dt) {
  if (this.dead) return;
  var step = this.speed * dt;
  this.x += this.vx * step; this.y += this.vy * step;
  this.traveled += step;
  this.rot += dt * 13;
  this.sortY = this.y;
  // colored trail for returned / countered bananas
  this.trailT -= dt;
  if ((this.returned || this.countered) && this.trailT <= 0) {
    this.trailT = 0.03;
    this.game.particles.add({
      x: this.x, y: this.y - this.zOf(), life: 0.3, size: 2,
      col: this.countered ? "#ffe680" : "#f08a3a", kind: "spark", layer: 1
    });
  }
  // bananas only collide with walls/trees (wallSolids excludes chests,
  // which have their own hit handling in Game.updateBananas)
  if (pointBlocked(this.x, this.y, this.game.wallSolids)) { this.impact(); AudioSys.sfx("thunk"); return; }
  if (this.traveled >= this.maxD) this.impact();
};
Banana.prototype.draw = function (g) {
  if (this.dead) return;
  var spr = this.countered ? SPR.bananaG : (this.returned ? SPR.bananaR : SPR.banana);
  var z = this.zOf();
  g.save();
  g.translate(Math.round(this.x), Math.round(this.y - z));
  // chunky 8-step rotation keeps the pixel look
  g.rotate(Math.round(this.rot / 0.785) * 0.785);
  g.drawImage(spr, -5, -5);
  g.restore();
};

/* ============================================================================
   CHEST -- cracked open by banana hits; drops loot with a hop
   ========================================================================== */
function Chest(game, spot) {
  this.game = game;
  this.x = spot.x; this.y = spot.y;
  this.bonus = !!spot.bonus;
  this.lockHp = CONFIG.CHEST_HP;
  this.state = "closed";        // closed -> cracked -> open
  this.shakeT = 0;
  this.glintT = rand(0, 3);
  this.guards = [];             // monkeys protecting this chest
  this.sortY = this.y;
}
Chest.prototype.rect = function () {
  return { l: this.x - 8, r: this.x + 8, t: this.y - 7, b: this.y };
};
Chest.prototype.hit = function (banana) {
  if (this.state === "open") return false;
  this.lockHp -= banana.countered ? 2 : 1;
  this.shakeT = 0.25;
  this.guards.forEach(function (m) { if (m.alive()) { m.alerted = true; m.enterChase(); } });
  this.game.particles.burst(this.x, this.y - 8, 5, { cols: ["#d8b03a", "#9aa0aa"], spMax: 60 });
  if (this.lockHp <= 0) this.open();
  else { this.state = "cracked"; AudioSys.sfx("chestHit"); }
  return true;
};
Chest.prototype.open = function () {
  this.state = "open";
  AudioSys.sfx("chestOpen");
  var g = this.game;
  g.particles.burst(this.x, this.y - 8, 14, { cols: ["#f0d03a", "#fff8d0", "#d8b03a"], spMax: 90, life: 0.9 });
  g.camera.addShake(1.5);
  if (this.bonus) {
    g.pickups.push(new Pickup(g, this.x - 8, this.y + 6, "heart"));
    g.pickups.push(new Pickup(g, this.x + 8, this.y + 6, "gban"));
    g.pickups.push(new Pickup(g, this.x, this.y + 10, "star"));
    g.ui.msg("HIDDEN STASH!", "gold");
  } else {
    g.pickups.push(new Pickup(g, this.x, this.y + 8, "part"));
  }
  g.onChestOpened(this);
};
Chest.prototype.update = function (dt) {
  this.shakeT = Math.max(0, this.shakeT - dt);
  if (this.state !== "open") {
    this.glintT -= dt;
    if (this.glintT <= 0) {     // periodic sparkle so chests are spottable
      this.glintT = rand(1.6, 3.2);
      this.game.particles.add({
        x: this.x + rand(-7, 7), y: this.y - rand(4, 12), vz: 14, z: 2,
        life: 0.5, size: 1, col: "#fff8d0", kind: "spark", layer: 1
      });
    }
  }
};
Chest.prototype.draw = function (g) {
  var spr = SPR.chest[this.state];
  var ox = this.shakeT > 0 ? Math.round(Math.sin(this.shakeT * 70) * 1.5) : 0;
  g.drawImage(spr, Math.round(this.x - spr.width / 2) + ox, Math.round(this.y - spr.height + 1));
};

/* ============================================================================
   PICKUP -- part / heart / star / golden banana
   ========================================================================== */
function Pickup(game, x, y, type) {
  this.game = game;
  this.x = x; this.y = y;
  this.type = type;
  this.z = 8; this.vz = 75;
  this.vx = rand(-22, 22); this.vy = rand(-12, 12);
  this.t = rand(0, 5);
  this.dead = false;
  this.sortY = y;
}
Pickup.prototype.update = function (dt) {
  this.t += dt;
  // little physics hop when spawned
  if (this.vz !== 0 || this.z > 0) {
    this.vz -= 300 * dt;
    this.z += this.vz * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.z <= 0) { this.z = 0; this.vz = 0; this.vx = 0; this.vy = 0; }
  }
  var p = this.game.player;
  var d = dist(this.x, this.y, p.x, p.y);
  if (this.z <= 2 && d < 34) {            // magnet
    this.x += (p.x - this.x) * 6 * dt;
    this.y += (p.y - this.y) * 6 * dt;
  }
  if (d < 10) { this.dead = true; this.game.collectPickup(this); }
  this.sortY = this.y;
};
Pickup.prototype.draw = function (g) {
  var spr = this.type === "part" ? SPR.part : this.type === "heart" ? SPR.heart :
            this.type === "star" ? SPR.star : SPR.gban;
  var bob = this.z > 0 ? 0 : Math.sin(this.t * 4) * 1.5;
  var dy = Math.round(this.y - this.z - spr.height - 2 + bob);
  g.drawImage(spr, Math.round(this.x - spr.width / 2), dy);
  // blinking LED on electronic parts / glow on golden banana
  if (this.type === "part" && Math.floor(this.t * 3) % 2 === 0)
    px(g, this.x - 2, dy + 4, 1, 1, "#ff8a7a");
  if (this.type === "gban") {
    g.globalAlpha = 0.25 + Math.sin(this.t * 5) * 0.1;
    g.fillStyle = "#ffe680";
    g.fillRect(Math.round(this.x - 6), dy - 2, 12, 12);
    g.globalAlpha = 1;
  }
};

/* ============================================================================
   HELICOPTER -- final rescue actor (side view, descends over the helipad)
   ========================================================================== */
function Helicopter(game, x, y) {
  this.game = game;
  this.x = x; this.y = y;       // ground anchor (shadow position)
  this.z = 420;                 // altitude
  this.phase = "enter";         // enter -> hover -> lift
  this.rotorT = 0;
  this.thumpT = 0;
  this.sway = 0;
  this.sortY = y;
}
Helicopter.prototype.update = function (dt) {
  this.rotorT += dt;
  this.sway += dt;
  this.thumpT -= dt;
  if (this.thumpT <= 0) { this.thumpT = 0.11; AudioSys.sfx("heli"); }

  if (this.phase === "enter") {
    this.z = Math.max(46, this.z - 95 * dt);
    if (this.z <= 46) { this.phase = "hover"; this.game.onHeliReady(); }
  } else if (this.phase === "lift") {
    this.z += 80 * dt;
  }
  // rotor wash when low: dust ring + blasted leaves
  if (this.z < 110) {
    var g = this.game;
    if (Math.random() < 0.5)
      g.particles.add({ x: this.x + rand(-30, 30), y: this.y + rand(-14, 14),
        vx: rand(-60, 60), vy: rand(-25, 25), life: 0.5, size: 2,
        col: pick(["#9a8a6a", "#7a7a72", "#caC0a0"]), kind: "smoke", layer: 0 });
    if (Math.random() < 0.4)
      g.particles.add({ x: this.x + rand(-40, 40), y: this.y + rand(-20, 20),
        vx: rand(-80, 80), vy: rand(-30, 30), z: rand(2, 14), vz: rand(10, 50), grav: 60,
        life: 0.8, col: pick(["#3a7a36", "#4f9a44", "#caa84e"]), kind: "leaf", layer: 1 });
    if (Math.random() < 0.12)
      g.particles.add({ x: this.x, y: this.y, r0: 8, r1: 46, life: 0.7,
        col: "#b8b096", kind: "ring", lw: 1, layer: 0 });
  }
};
Helicopter.prototype.draw = function (g) {
  var bobX = Math.sin(this.sway * 1.7) * 3;
  var bobZ = Math.sin(this.sway * 2.3) * 2;
  var hx = Math.round(this.x + bobX), hy = Math.round(this.y - this.z + bobZ);
  // rope while hovering / lifting
  if (this.phase !== "enter") {
    g.strokeStyle = "#d8d0b8";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(hx - 3, hy + 6);
    g.lineTo(hx - 3, Math.round(this.y - this.game.player.riseZ - 14));
    g.stroke();
  }
  g.drawImage(SPR.heli, hx - 28, hy - 12);
  // main rotor (spinning bar)
  var rw = Math.abs(Math.sin(this.rotorT * 26)) * 30 + 6;
  px(g, hx - 8 - rw, hy - 14, rw * 2, 2, "#2a2a24");
  px(g, hx - 8 - rw * 0.7, hy - 15, rw * 1.4, 1, "#46464a");
  // tail rotor
  var tr = Math.abs(Math.sin(this.rotorT * 31)) * 5 + 1;
  px(g, hx + 17, hy - 5 - tr, 2, tr * 2, "#2a2a24");
};
Helicopter.prototype.drawShadow = function (g) {
  var k = clamp(1 - this.z / 450, 0.25, 1);
  g.globalAlpha = 0.28 * k;
  g.fillStyle = "#06140a";
  var w = 30 * (0.5 + k * 0.5);
  blob(g, this.x, this.y, w, w * 0.3, "#06140a");
  g.globalAlpha = 1;
};

/* ============================================================================
   UI -- DOM HUD: bars, counters, popup messages, full screens
   ========================================================================== */
function byId(id) { return document.getElementById(id); }

function UI() {
  this.hud = byId("hud");
  this.hpFill = byId("hp-fill");
  this.stFill = byId("st-fill");
  this.cdFill = byId("cd-fill");
  this.partsEl = byId("hud-parts");
  this.scoreEl = byId("hud-score");
  this.comboEl = byId("hud-combo");
  this.objectiveEl = byId("objective");
  this.msgsEl = byId("msgs");
  this.screens = {
    start: byId("screen-start"), pause: byId("screen-pause"),
    over: byId("screen-over"), win: byId("screen-win")
  };
  this.overStats = byId("over-stats");
  this.winStats = byId("win-stats");
  this._cache = {};
}
UI.prototype.showScreen = function (name) {
  for (var k in this.screens) {
    if (name === k) this.screens[k].classList.remove("hidden");
    else this.screens[k].classList.add("hidden");
  }
  if (name === "start") this.hud.classList.add("hidden");
  else this.hud.classList.remove("hidden");
};
UI.prototype.setBars = function (hpK, stK, cdK, gold) {
  this.hpFill.style.transform = "scaleX(" + clamp(hpK, 0, 1).toFixed(3) + ")";
  this.stFill.style.transform = "scaleX(" + clamp(stK, 0, 1).toFixed(3) + ")";
  this.cdFill.style.transform = "scaleX(" + clamp(cdK, 0, 1).toFixed(3) + ")";
  var col = gold ? "#ffd84a" : "#e8c83a";
  if (this._cache.cdCol !== col) { this._cache.cdCol = col; this.cdFill.style.background = col; }
};
UI.prototype.setParts = function (n, total) {
  var s = "PARTS " + n + "/" + total;
  if (this._cache.parts !== s) { this._cache.parts = s; this.partsEl.textContent = s; }
};
UI.prototype.setScore = function (v) {
  var s = "SCORE " + v;
  if (this._cache.score !== s) { this._cache.score = s; this.scoreEl.textContent = s; }
};
UI.prototype.setCombo = function (n) {
  if (n >= 2) {
    this.comboEl.classList.remove("hidden");
    var s = "COMBO x" + n;
    if (this._cache.combo !== s) { this._cache.combo = s; this.comboEl.textContent = s; }
  } else this.comboEl.classList.add("hidden");
};
UI.prototype.setObjective = function (text) {
  if (this._cache.obj !== text) { this._cache.obj = text; this.objectiveEl.textContent = text; }
};
UI.prototype.msg = function (text, cls) {
  var div = document.createElement("div");
  div.className = "msg" + (cls ? " " + cls : "");
  div.textContent = text;
  this.msgsEl.appendChild(div);
  while (this.msgsEl.children.length > 4) this.msgsEl.removeChild(this.msgsEl.children[0]);
  setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 2400);
};
UI.prototype.clearMsgs = function () { this.msgsEl.innerHTML = ""; };

/* ============================================================================
   GAME -- state machine + main loop.
   States: start, play, build, rescue, pause, over, win
   ========================================================================== */
function Game() {
  this.canvas = byId("game-canvas");
  this.ctx = this.canvas.getContext("2d");
  this.wrap = byId("game-wrap");
  buildSprites();
  this.world = buildWorld();
  this.ui = new UI();
  this.camera = new Camera();
  this.input = new Input(this, this.canvas);
  this.state = "start";
  this.best = 0;
  try { this.best = parseInt(localStorage.getItem("monkeyCityBest") || "0", 10) || 0; } catch (e) {}
  this.reset();
  this.camera.jumpTo(this.player.x, this.player.y);
  this.ui.showScreen("start");
  // responsive integer scaling
  var self = this;
  function fit() {
    var s = Math.min(window.innerWidth / CONFIG.VIEW_W, window.innerHeight / CONFIG.VIEW_H);
    if (s >= 1) s = Math.floor(s);
    s = Math.max(0.4, s);
    self.wrap.style.width = Math.round(CONFIG.VIEW_W * s) + "px";
    self.wrap.style.height = Math.round(CONFIG.VIEW_H * s) + "px";
    document.documentElement.style.setProperty("--ui", Math.max(1, Math.round(s)));
  }
  fit();
  window.addEventListener("resize", fit);
  // main loop
  this.last = 0;
  function frame(ts) {
    window.requestAnimationFrame(frame);
    var dt = clamp((ts - self.last) / 1000, 0, 0.05);
    self.last = ts;
    self.tick(dt);
  }
  window.requestAnimationFrame(frame);
}

/* ---------- run setup ---------- */
Game.prototype.reset = function () {
  var w = this.world;
  this.player = new Player(this, w.playerSpawn.x, w.playerSpawn.y);
  this.monkeys = [];
  this.bananas = [];
  this.pickups = [];
  this.floaters = [];
  this.particles = new Particles();
  this.heli = null;
  this.chests = [];
  // wall solids never include chests (bananas must reach them);
  // movement solids do.
  this.wallSolids = w.solids;
  this.solids = w.solids.slice();

  var self = this;
  var guardOff = [[34, 10], [-30, 16], [28, -20], [-34, -12], [30, 14], [-28, 18], [26, 16]];
  w.chestSpots.forEach(function (spot, i) {
    var c = new Chest(self, spot);
    self.chests.push(c);
    self.solids.push(c.rect());
    if (spot.guard) {
      var off = guardOff[i % guardOff.length];
      var m = new Monkey(self, spot.x + off[0], spot.y + off[1], "guard");
      m.guardChest = c;
      c.guards.push(m);
      self.monkeys.push(m);
    }
  });
  w.monkeySpots.forEach(function (s) {
    self.monkeys.push(new Monkey(self, s.x, s.y, s.type));
  });

  this.score = 0; this.kills = 0;
  this.combo = 0; this.comboT = 0; this.maxCombo = 0;
  this.partsCollected = 0;
  this.phase = "explore";        // explore -> goRadio -> goHeli
  this.radioActive = false;
  this.signalT = 0; this.beepT = 0;
  this.heliDelay = 0;
  this.buildT = 0; this.buildTickT = 0;
  this.rescueT = 0;
  this.time = 0;
  this.dayT = 0.07;              // start in the morning
  this.hurtFlash = 0; this.freeze = 0; this.fadeWhite = 0;
  this.leafT = 0; this.fireT = 0; this.fireflyT = 0;
  this.camera.focus = null;
  this.camera.shake = 0;

  this.ui.clearMsgs();
  this.ui.setParts(0, CONFIG.PART_TOTAL);
  this.ui.setScore(0);
  this.ui.setCombo(0);
  this.ui.setObjective("CRACK THE CHESTS WITH BANANAS - FIND " + CONFIG.PART_TOTAL + " PARTS");
};
Game.prototype.startRun = function () {
  if (this.state !== "start") return;
  this.state = "play";
  this.ui.showScreen(null);
  AudioSys.sfx("uiStart");
  this.ui.msg("FIND THE ELECTRONIC PARTS!", "good");
};
Game.prototype.restart = function () {
  this.reset();
  this.camera.jumpTo(this.player.x, this.player.y);
  this.state = "play";
  this.ui.showScreen(null);
  AudioSys.sfx("uiStart");
};

/* ---------- helpers ---------- */
Game.prototype.controlLocked = function () { return this.state !== "play"; };
Game.prototype.aimWorld = function () {
  return { x: this.input.mouse.x + this.camera.x, y: this.input.mouse.y + this.camera.y };
};
Game.prototype.addFloater = function (x, y, text, color, scale) {
  this.floaters.push({ x: x, y: y, t: 0, life: 0.8, text: text, color: color || "#fff", scale: scale || 1 });
};
Game.prototype.scoreMult = function () { return 1 + Math.max(0, this.combo - 1) * 0.15; };
Game.prototype.addScore = function (base) {
  var v = Math.round(base * this.scoreMult());
  this.score += v;
  return v;
};
Game.prototype.bumpCombo = function () {
  this.combo++; this.comboT = CONFIG.COMBO_TIME;
  this.maxCombo = Math.max(this.maxCombo, this.combo);
  if (this.combo >= 2) AudioSys.sfx("combo", Math.min(this.combo, 10));
  this.ui.setCombo(this.combo);
};
Game.prototype.resetCombo = function () { this.combo = 0; this.comboT = 0; this.ui.setCombo(0); };

/* ---------- input events ---------- */
Game.prototype.onKeyDown = function (code) {
  if (code === "Enter" || code === "NumpadEnter") {
    if (this.state === "start") this.startRun();
    return;
  }
  if (code === "KeyP") {
    if (this.state === "play") { this.state = "pause"; this.ui.showScreen("pause"); }
    else if (this.state === "pause") { this.state = "play"; this.ui.showScreen(null); }
    return;
  }
  if (code === "KeyR") {
    if (this.state === "over" || this.state === "win") this.restart();
    return;
  }
  if (code === "KeyM") {
    this.ui.msg(AudioSys.toggleMute() ? "SOUND OFF" : "SOUND ON");
    return;
  }
  if (this.state !== "play") return;
  if (code === "KeyE") this.interact();
  if (code === "Space") this.player.tryCounter();
  if (code === "ShiftLeft" || code === "ShiftRight") this.player.trySlide();
};
Game.prototype.onMouseDown = function (button) {
  if (this.state === "start") { this.startRun(); return; }
  if (this.state !== "play") return;
  if (button === 0) this.player.tryThrow();
  if (button === 2) this.player.tryCounter();
};

/* ---------- interactions ---------- */
Game.prototype.interact = function () {
  var p = this.player, st = this.world.station;
  // radio station door
  if (dist(p.x, p.y, st.doorX, st.doorY) < 36) {
    if (this.radioActive) { this.ui.msg("SIGNAL SENT - GET TO THE HELIPAD!"); return; }
    if (this.partsCollected >= CONFIG.PART_TOTAL) {
      this.state = "build"; this.buildT = 0;
      this.ui.setObjective("BUILDING SIGNAL DEVICE...");
    } else {
      AudioSys.sfx("denied");
      this.ui.msg("NEED " + (CONFIG.PART_TOTAL - this.partsCollected) + " MORE PARTS", "bad");
    }
    return;
  }
  // chests just taunt you -- bananas do the opening
  for (var i = 0; i < this.chests.length; i++) {
    var c = this.chests[i];
    if (c.state !== "open" && dist(p.x, p.y, c.x, c.y) < 28) {
      AudioSys.sfx("denied");
      this.ui.msg("LOCKED TIGHT! HIT IT WITH BANANAS", "bad");
      return;
    }
  }
};

/* ---------- progression callbacks ---------- */
Game.prototype.onMonkeyHit = function (m) {
  var v = this.addScore(CONFIG.SCORE.HIT);
  this.bumpCombo();
  this.addFloater(m.x, m.y - m.height - 6, "+" + v, "#fff8d0");
  this.camera.addShake(0.6);
  this.freeze = Math.max(this.freeze, 0.02);
};
Game.prototype.onMonkeyKilled = function (m) {
  this.kills++;
  var v = this.addScore(m.stats.score);
  this.bumpCombo();
  this.addFloater(m.x, m.y - m.height - 6, "+" + v, "#f0d03a");
  this.camera.addShake(1.6);
  this.freeze = Math.max(this.freeze, 0.05);
  this.particles.burst(m.x, m.y - 6, 10, { cols: ["#8a5a32", "#caa06a", "#fff"], spMax: 80 });
  if (m.type === "alpha") this.ui.msg("ALPHA MONKEY DEFEATED!", "gold");
  // drops
  var r = Math.random();
  if (r < CONFIG.DROPS.HEART) this.pickups.push(new Pickup(this, m.x, m.y, "heart"));
  else if (r < CONFIG.DROPS.HEART + CONFIG.DROPS.GOLD) this.pickups.push(new Pickup(this, m.x, m.y, "gban"));
  else if (r < 0.75) this.pickups.push(new Pickup(this, m.x, m.y, "star"));
};
Game.prototype.onChestOpened = function (chest) {
  this.addScore(CONFIG.SCORE.CHEST);
  if (!chest.bonus) this.ui.msg("CHEST CRACKED OPEN!", "good");
};
Game.prototype.collectPickup = function (p) {
  var pl = this.player;
  if (p.type === "part") {
    this.partsCollected++;
    this.addScore(CONFIG.SCORE.PART);
    this.ui.setParts(this.partsCollected, CONFIG.PART_TOTAL);
    AudioSys.sfx("part");
    this.particles.burst(p.x, p.y - 6, 10, { cols: ["#7ae08a", "#fff8d0"], spMax: 70 });
    if (this.partsCollected >= CONFIG.PART_TOTAL) {
      this.phase = "goRadio";
      this.ui.msg("ALL PARTS COLLECTED!", "gold");
      this.ui.setObjective("GO TO THE RADIO STATION (NORTH-EAST)");
    } else {
      this.ui.msg("ELECTRONIC PART COLLECTED (" + this.partsCollected + "/" + CONFIG.PART_TOTAL + ")", "good");
    }
  } else if (p.type === "heart") {
    pl.hp = Math.min(pl.maxHp, pl.hp + CONFIG.HEART_HEAL);
    AudioSys.sfx("heart");
    this.addFloater(pl.x, pl.y - 24, "+" + CONFIG.HEART_HEAL + " HP", "#8ae88a");
  } else if (p.type === "star") {
    var v = this.addScore(200);
    AudioSys.sfx("pickup");
    this.addFloater(pl.x, pl.y - 24, "+" + v, "#f0d03a");
  } else if (p.type === "gban") {
    pl.goldT = CONFIG.PLAYER.GOLD_TIME;
    AudioSys.sfx("power");
    this.ui.msg("GOLDEN BANANA! RAPID THROWS", "gold");
  }
};
Game.prototype.gameOver = function () {
  if (this.state !== "play") return;
  this.state = "over";
  AudioSys.sfx("lose");
  this.camera.addShake(4);
  this.saveBest();
  this.overStatsHtml(this.ui.overStats);
  this.ui.showScreen("over");
};
Game.prototype.win = function () {
  if (this.state === "win") return;
  this.state = "win";
  this.addScore(1000);
  AudioSys.sfx("win");
  this.saveBest();
  this.overStatsHtml(this.ui.winStats, true);
  this.ui.showScreen("win");
};
Game.prototype.saveBest = function () {
  if (this.score > this.best) {
    this.best = this.score;
    try { localStorage.setItem("monkeyCityBest", String(this.best)); } catch (e) {}
  }
};
Game.prototype.overStatsHtml = function (el, withCombo) {
  var mins = Math.floor(this.time / 60), secs = Math.floor(this.time % 60);
  var t = mins + ":" + (secs < 10 ? "0" : "") + secs;
  el.innerHTML =
    "SCORE <b>" + this.score + "</b> &nbsp; BEST <b>" + this.best + "</b><br>" +
    "PARTS <b>" + this.partsCollected + "/" + CONFIG.PART_TOTAL + "</b> &nbsp; " +
    "MONKEYS BONKED <b>" + this.kills + "</b><br>" +
    "TIME <b>" + t + "</b>" +
    (withCombo ? " &nbsp; MAX COMBO <b>x" + this.maxCombo + "</b>" : "");
};
Game.prototype.onHeliReady = function () {
  this.ui.msg("HELICOPTER INBOUND - GET ON THE PAD!", "gold");
};

/* ---------- per-frame update ---------- */
Game.prototype.tick = function (dt) {
  if (this.state === "pause") { this.render(); return; }
  if (this.freeze > 0 && this.state === "play") {   // hit-stop
    this.freeze -= dt;
    this.render();
    return;
  }
  this.updateCore(dt);
  if (this.state === "play") this.updatePlay(dt);
  else if (this.state === "build") this.updateBuild(dt);
  else if (this.state === "rescue") this.updateRescue(dt);
  this.render();
};

// shared world simulation (runs in every non-paused state)
Game.prototype.updateCore = function (dt) {
  var self = this;
  this.time += this.state === "play" ? dt : 0;
  this.dayT += dt / CONFIG.DAY_LENGTH;
  this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.4);

  this.player.update(dt);
  for (var i = this.monkeys.length - 1; i >= 0; i--) {
    var m = this.monkeys[i];
    m.update(dt);
    if (m.state === "dead" && m.deadT > 5.5) this.monkeys.splice(i, 1);
  }
  this.chests.forEach(function (c) { c.update(dt); });
  for (i = this.pickups.length - 1; i >= 0; i--) {
    this.pickups[i].update(dt);
    if (this.pickups[i].dead) this.pickups.splice(i, 1);
  }
  // bananas + combat resolution
  this.updateBananas(dt);
  if (this.heli) this.heli.update(dt);
  // floaters
  for (i = this.floaters.length - 1; i >= 0; i--) {
    this.floaters[i].t += dt;
    if (this.floaters[i].t > this.floaters[i].life) this.floaters.splice(i, 1);
  }
  this.particles.update(dt);
  this.updateAmbient(dt);
  this.camera.update(dt, this);
};

Game.prototype.updateBananas = function (dt) {
  var p = this.player;
  // counter window: deflect enemy bananas near the player
  if (p.counterT > 0) {
    var deflected = false;
    for (var i = 0; i < this.bananas.length; i++) {
      var b = this.bananas[i];
      if (b.dead || b.owner !== "m") continue;
      if (dist(b.x, b.y, p.x, p.y - 8) > CONFIG.PLAYER.COUNTER_RADIUS) continue;
      deflected = true;
      var wasReturned = b.returned;
      b.owner = "p"; b.countered = true; b.returned = false;
      b.speed *= CONFIG.BANANA.COUNTER_SPEED_MULT;
      b.dmg = CONFIG.BANANA.DMG * CONFIG.BANANA.COUNTER_DMG_MULT;
      // retarget: nearest living monkey, otherwise along the aim
      var best = null, bd = 300;
      for (var j = 0; j < this.monkeys.length; j++) {
        var m2 = this.monkeys[j];
        if (!m2.alive()) continue;
        var d2 = dist(b.x, b.y, m2.x, m2.y);
        if (d2 < bd) { bd = d2; best = m2; }
      }
      var tx, ty;
      if (best) { tx = best.x; ty = best.y - 6; }
      else { var aim = this.aimWorld(); tx = aim.x; ty = aim.y; }
      var ang = angTo(b.x, b.y, tx, ty);
      b.vx = Math.cos(ang); b.vy = Math.sin(ang);
      b.traveled = 0;
      b.maxD = clamp(dist(b.x, b.y, tx, ty) + 10, 60, 330);
      b.arc = 7;
      var v = this.addScore(CONFIG.SCORE.COUNTER);
      this.bumpCombo();
      this.addFloater(p.x, p.y - 26, "COUNTER! +" + v, "#ffe680");
      this.ui.msg(wasReturned ? "PERFECT COUNTER!" : "COUNTER!", "gold");
      AudioSys.sfx("counter");
      this.freeze = Math.max(this.freeze, 0.05);
      this.camera.addShake(2);
    }
    if (deflected) p.counterT = 0;
  }

  for (i = this.bananas.length - 1; i >= 0; i--) {
    var bn = this.bananas[i];
    bn.update(dt);
    if (!bn.dead && bn.owner === "p") {
      // vs monkeys (catch or hurt)
      for (j = 0; j < this.monkeys.length; j++) {
        var mk2 = this.monkeys[j];
        if (!mk2.alive()) continue;
        if (dist(bn.x, bn.y, mk2.x, mk2.y - mk2.height * 0.5) < (mk2.type === "alpha" ? 11 : 8)) {
          if (!bn.countered && mk2.canCatch() && Math.random() < mk2.stats.catch) {
            mk2.catchBanana();
            bn.dead = true;             // snatched clean out of the air
          } else {
            mk2.hurtBy(bn.dmg, bn.x, bn.y);
            bn.impact(bn.countered);
          }
          break;
        }
      }
      // vs chests
      if (!bn.dead) {
        for (j = 0; j < this.chests.length; j++) {
          var ch = this.chests[j];
          if (ch.state === "open") continue;
          if (dist(bn.x, bn.y, ch.x, ch.y - 5) < 11) { ch.hit(bn); bn.impact(); break; }
        }
      }
    } else if (!bn.dead && bn.owner === "m") {
      // vs player (slide + i-frames let it pass right through)
      if (dist(bn.x, bn.y, p.x, p.y - 8) < 8) {
        if (!p.invulnerable() && this.state === "play") {
          p.hurt(bn.dmg, bn.x, bn.y);
          bn.impact(true);
        }
      }
    }
    if (bn.dead) this.bananas.splice(i, 1);
  }
};

// atmosphere: falling leaves, fireflies at night, campfire flames
Game.prototype.updateAmbient = function (dt) {
  var cam = this.camera;
  this.leafT -= dt;
  if (this.leafT <= 0) {
    this.leafT = 0.3;
    this.particles.add({
      x: cam.x + rand(-20, CONFIG.VIEW_W + 20), y: cam.y + rand(-10, CONFIG.VIEW_H),
      vx: rand(-6, 14), vy: rand(6, 14), z: rand(24, 40), vz: -rand(9, 15),
      life: 2.6, col: pick(["#3a7a36", "#4f9a44", "#caa84e", "#2a5a2a"]), kind: "leaf", layer: 1
    });
  }
  var night = this.nightK();
  this.fireflyT -= dt;
  if (night > 0.45 && this.fireflyT <= 0) {
    this.fireflyT = 0.35;
    this.particles.add({
      x: cam.x + rand(0, CONFIG.VIEW_W), y: cam.y + rand(0, CONFIG.VIEW_H),
      vx: rand(-8, 8), vy: rand(-5, 5), z: rand(6, 16), vz: rand(-3, 3),
      life: 2.2, size: 1, col: "#d8e87a", kind: "spark", layer: 1
    });
  }
  this.fireT -= dt;
  if (this.fireT <= 0) {
    this.fireT = 0.12;
    var self = this;
    this.world.fires.forEach(function (f) {
      self.particles.add({
        x: f.x + rand(-3, 3), y: f.y + 2, z: 2, vz: rand(12, 26), vx: rand(-3, 3),
        life: rand(0.3, 0.6), size: 2, col: pick(["#f0a03a", "#e06a2a", "#f0d03a"]), layer: 1
      });
      if (Math.random() < 0.25)
        self.particles.add({ x: f.x, y: f.y, z: 10, vz: 14, life: 1.1, size: 2, col: "#6a6a62", kind: "smoke", layer: 1 });
    });
  }
};
// 0 = full day, 1 = deepest night
Game.prototype.nightK = function () {
  var phase = this.dayT % 1;
  return clamp((Math.sin(phase * 6.283 - 1.5708) + 1) / 2, 0, 1);
};

/* ---------- play-state logic ---------- */
Game.prototype.updatePlay = function (dt) {
  // combo decay
  if (this.comboT > 0) {
    this.comboT -= dt;
    if (this.comboT <= 0) this.resetCombo();
  }
  // radio activated: signal pulses + helicopter arrival
  if (this.radioActive) {
    this.signalT -= dt;
    if (this.signalT <= 0) {
      this.signalT = 0.55;
      var tw = this.world.towerTop;
      this.particles.add({ x: tw.x, y: tw.y, r0: 3, r1: 46, life: 1.1, col: "#7ae08a", kind: "ring", lw: 1, layer: 1 });
    }
    this.beepT -= dt;
    if (this.beepT <= 0) { this.beepT = 1.4; AudioSys.sfx("beep"); }
    if (this.heliDelay > 0) {
      this.heliDelay -= dt;
      if (this.heliDelay <= 0)
        this.heli = new Helicopter(this, this.world.helipad.x, this.world.helipad.y);
    }
    // board the helicopter
    if (this.heli && this.heli.phase === "hover" &&
        dist(this.player.x, this.player.y, this.world.helipad.x, this.world.helipad.y) < 26) {
      this.state = "rescue";
      this.rescueT = 0;
      this.camera.focus = { x: this.world.helipad.x, y: this.world.helipad.y - 30 };
    }
  }
};

/* ---------- build-state logic (signal device assembly) ---------- */
Game.prototype.updateBuild = function (dt) {
  this.buildT += dt;
  var st = this.world.station;
  this.buildTickT -= dt;
  if (this.buildTickT <= 0) {
    this.buildTickT = 0.18;
    AudioSys.sfx("tick");
    this.particles.add({
      x: st.doorX + rand(-8, 8), y: st.doorY - rand(6, 20), vx: rand(-25, 25), vy: rand(-10, 10),
      z: 2, vz: rand(20, 50), grav: 140, life: 0.4, size: 1,
      col: pick(["#ffe680", "#9adfe8", "#fff"]), kind: "spark", layer: 1
    });
    AudioSys.sfx("spark");
  }
  if (this.buildT >= CONFIG.BUILD_TIME) {
    this.state = "play";
    this.radioActive = true;
    this.signalT = 0; this.beepT = 0.3;
    this.heliDelay = 1.6;
    AudioSys.sfx("built");
    this.ui.msg("SIGNAL DEVICE BUILT", "gold");
    this.ui.msg("RADIO STATION ACTIVATED", "good");
    this.ui.setObjective("SIGNAL SENT! GET TO THE HELIPAD (EAST OF THE STATION)");
    this.camera.addShake(2);
  }
};

/* ---------- rescue cinematic ---------- */
Game.prototype.updateRescue = function (dt) {
  this.rescueT += dt;
  var p = this.player, hp2 = this.world.helipad, t = this.rescueT;
  if (t < 0.9) {                     // walk to the rope
    p.x = lerp(p.x, hp2.x, Math.min(1, dt * 5));
    p.y = lerp(p.y, hp2.y, Math.min(1, dt * 5));
  } else if (t < 2.2) {              // climb the rope
    p.riseZ = lerp(0, 34, (t - 0.9) / 1.3);
  } else {                           // lift away
    if (this.heli && this.heli.phase !== "lift") this.heli.phase = "lift";
    if (this.heli) {
      p.riseZ = this.heli.z - 14;
      p.x = lerp(p.x, this.heli.x - 3, Math.min(1, dt * 8));
    }
    this.fadeWhite = clamp((t - 2.6) / 1.6, 0, 1);
  }
  if (t >= 4.4) this.win();
};

/* ============================================================================
   RENDER
   ========================================================================== */
Game.prototype.render = function () {
  var g = this.ctx, cam = this.camera, p = this.player;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#0a120c";
  g.fillRect(0, 0, CONFIG.VIEW_W, CONFIG.VIEW_H);

  var camX = Math.round(cam.x + cam.sx), camY = Math.round(cam.y + cam.sy);
  g.save();
  g.translate(-camX, -camY);

  // ground
  g.drawImage(this.world.groundCanvas, 0, 0);

  // animated grass tufts (only those in view)
  var t = this.last / 1000;
  for (var i = 0; i < this.world.tufts.length; i++) {
    var tf = this.world.tufts[i];
    if (tf.x < camX - 8 || tf.x > camX + CONFIG.VIEW_W + 8 ||
        tf.y < camY - 8 || tf.y > camY + CONFIG.VIEW_H + 8) continue;
    var fr = Math.floor(t * 2 + tf.phase) % 2;
    g.drawImage(SPR.grass[fr], Math.round(tf.x), Math.round(tf.y - 5));
  }

  this.particles.draw(g, 0, t);

  // shadows
  this.drawShadow(g, p.x, p.y, 12, 0.3);
  for (i = 0; i < this.monkeys.length; i++) {
    var m = this.monkeys[i];
    if (m.alive()) this.drawShadow(g, m.x, m.y, m.type === "alpha" ? 16 : 10, 0.28);
  }
  for (i = 0; i < this.bananas.length; i++)
    this.drawShadow(g, this.bananas[i].x, this.bananas[i].y, 5, 0.22);
  for (i = 0; i < this.pickups.length; i++)
    this.drawShadow(g, this.pickups[i].x, this.pickups[i].y, 6, 0.2);
  if (this.heli) this.heli.drawShadow(g);

  // y-sorted world (objects, chests, pickups, monkeys, player, bananas)
  var draws = [];
  var view = { l: camX - 80, r: camX + CONFIG.VIEW_W + 80, t: camY - 120, b: camY + CONFIG.VIEW_H + 80 };
  function inView(e) { return e.x > view.l && e.x < view.r && e.y > view.t && e.y < view.b; }
  for (i = 0; i < this.world.objects.length; i++)
    if (inView(this.world.objects[i])) draws.push(this.world.objects[i]);
  for (i = 0; i < this.chests.length; i++) if (inView(this.chests[i])) draws.push(this.chests[i]);
  for (i = 0; i < this.pickups.length; i++) draws.push(this.pickups[i]);
  for (i = 0; i < this.monkeys.length; i++) if (inView(this.monkeys[i])) draws.push(this.monkeys[i]);
  draws.push(p);
  for (i = 0; i < this.bananas.length; i++) draws.push(this.bananas[i]);
  draws.sort(function (a, b) { return a.sortY - b.sortY; });
  for (i = 0; i < draws.length; i++) draws[i].draw(g);

  this.particles.draw(g, 1, t);

  // radio tower beacon
  var tw = this.world.towerTop;
  var blinkOn = this.radioActive ? (t * 4) % 1 < 0.5 : (t * 0.9) % 1 < 0.12;
  if (blinkOn) {
    px(g, tw.x - 2, tw.y - 2, 3, 3, "#ff4a3a");
    g.globalAlpha = 0.25;
    px(g, tw.x - 5, tw.y - 5, 9, 9, "#ff4a3a");
    g.globalAlpha = 1;
  }

  // helicopter on top of everything
  if (this.heli) this.heli.draw(g);

  // light glows (lamps at night, fires always)
  this.drawGlows(g, t);

  // world-space UI: prompts, aim dots, floaters, build bar
  this.drawWorldUI(g, t);

  g.restore();

  /* ----- screen space ----- */
  // day/night tint
  var night = this.nightK();
  if (night > 0.02) {
    g.fillStyle = "rgba(16, 22, 52," + (night * 0.30).toFixed(3) + ")";
    g.fillRect(0, 0, CONFIG.VIEW_W, CONFIG.VIEW_H);
  }
  // hurt flash + low hp pulse
  if (this.hurtFlash > 0) {
    g.fillStyle = "rgba(200,30,20," + (this.hurtFlash * 0.4).toFixed(3) + ")";
    g.fillRect(0, 0, CONFIG.VIEW_W, CONFIG.VIEW_H);
  }
  if (this.state === "play" && p.hp <= 30) {
    g.globalAlpha = 0.15 + Math.sin(t * 6) * 0.08;
    g.strokeStyle = "#d8483a"; g.lineWidth = 6;
    g.strokeRect(3, 3, CONFIG.VIEW_W - 6, CONFIG.VIEW_H - 6);
    g.globalAlpha = 1;
  }
  // objective arrow at the screen edge
  this.drawObjectiveArrow(g, t);
  // crosshair
  if (this.state === "play" || this.state === "pause") {
    var mx = Math.round(this.input.mouse.x), my = Math.round(this.input.mouse.y);
    g.drawImage(SPR.crosshair, mx - 4, my - 4);
  }
  // rescue white-out
  if (this.fadeWhite > 0) {
    g.fillStyle = "rgba(245,250,240," + this.fadeWhite.toFixed(3) + ")";
    g.fillRect(0, 0, CONFIG.VIEW_W, CONFIG.VIEW_H);
  }

  // DOM HUD
  var cdMax = p.goldT > 0 ? CONFIG.PLAYER.FAST_THROW_CD : CONFIG.PLAYER.THROW_CD;
  this.ui.setBars(p.hp / p.maxHp, p.stamina / CONFIG.PLAYER.STAMINA,
                  1 - p.cooldown / cdMax, p.goldT > 0);
  this.ui.setScore(this.score);
};

Game.prototype.drawShadow = function (g, x, y, w, alpha) {
  g.globalAlpha = alpha;
  blob(g, x, y + 1, w * 0.5, w * 0.17 + 1, "#06140a");
  g.globalAlpha = 1;
};

Game.prototype.drawGlows = function (g, t) {
  var night = this.nightK();
  g.save();
  g.globalCompositeOperation = "lighter";
  if (night > 0.1) {
    for (var i = 0; i < this.world.lamps.length; i++) {
      var L = this.world.lamps[i];
      g.globalAlpha = 0.07 * night * (0.85 + Math.sin(t * 7 + i * 2) * 0.15);
      g.fillStyle = "#f0d03a";
      g.beginPath(); g.arc(L.x, L.y, 17, 0, 6.283); g.fill();
      g.globalAlpha = 0.22 * night;
      g.fillRect(L.x - 2, L.y - 2, 4, 4);
    }
  }
  for (i = 0; i < this.world.fires.length; i++) {
    var f = this.world.fires[i];
    g.globalAlpha = 0.10 + Math.sin(t * 11 + i) * 0.03 + night * 0.08;
    g.fillStyle = "#f0a03a";
    g.beginPath(); g.arc(f.x, f.y - 3, 13, 0, 6.283); g.fill();
  }
  g.restore();
  g.globalAlpha = 1;
};

Game.prototype.drawWorldUI = function (g, t) {
  var p = this.player;
  // floaters
  for (var i = 0; i < this.floaters.length; i++) {
    var f = this.floaters[i];
    g.globalAlpha = clamp(1.4 - f.t / f.life * 1.4, 0, 1);
    drawTextShadow(g, f.text, f.x, f.y - f.t * 22, f.color, f.scale, 0.5);
  }
  g.globalAlpha = 1;

  if (this.state === "play") {
    // aim dots toward the cursor
    var aim = this.aimWorld();
    var d = Math.min(dist(p.x, p.y, aim.x, aim.y), CONFIG.BANANA.RANGE);
    var ang = angTo(p.x, p.y - 10, aim.x, aim.y);
    g.globalAlpha = 0.35;
    for (i = 1; i <= 3; i++) {
      var k = 0.25 + i * 0.2;
      px(g, p.x + Math.cos(ang) * d * k, p.y - 10 + Math.sin(ang) * d * k, 1, 1, "#fff");
    }
    g.globalAlpha = 1;

    // interact prompts
    var st = this.world.station;
    if (dist(p.x, p.y, st.doorX, st.doorY) < 36) {
      var label = this.radioActive ? "SIGNAL SENT" :
        (this.partsCollected >= CONFIG.PART_TOTAL ? "E: BUILD SIGNAL DEVICE" :
         "PARTS " + this.partsCollected + "/" + CONFIG.PART_TOTAL);
      drawTextShadow(g, label, st.doorX, st.doorY - 44, "#fff8d0", 1, 0.5);
    }
    for (i = 0; i < this.chests.length; i++) {
      var c = this.chests[i];
      if (c.state !== "open" && dist(p.x, p.y, c.x, c.y) < 30)
        drawTextShadow(g, "BONK IT!", c.x, c.y - 24, "#f0d03a", 1, 0.5);
    }
    if (this.radioActive && this.heli && this.heli.phase === "hover")
      drawTextShadow(g, "GET ON!", this.world.helipad.x, this.world.helipad.y - 30,
        (t * 2) % 1 < 0.5 ? "#ffe680" : "#fff", 1, 0.5);
  }

  // build progress bar
  if (this.state === "build") {
    var k2 = clamp(this.buildT / CONFIG.BUILD_TIME, 0, 1);
    var bx = Math.round(p.x - 16), by = Math.round(p.y - 34);
    px(g, bx - 1, by - 1, 34, 7, "#16100a");
    px(g, bx, by, 32, 5, "#3a3226");
    px(g, bx + 1, by + 1, Math.round(30 * k2), 3, "#7ae08a");
    drawTextShadow(g, "BUILDING", p.x, by - 8, "#fff8d0", 1, 0.5);
  }
};

Game.prototype.objectiveTarget = function () {
  if (this.state !== "play") return null;
  if (this.phase === "explore") {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.chests.length; i++) {
      var c = this.chests[i];
      if (c.state === "open" || c.bonus) continue;
      var d = dist(this.player.x, this.player.y, c.x, c.y);
      if (d < bd) { bd = d; best = { x: c.x, y: c.y, sub: true }; }
    }
    if (!best) {   // chests all open but parts still on the ground
      for (i = 0; i < this.pickups.length; i++)
        if (this.pickups[i].type === "part")
          return { x: this.pickups[i].x, y: this.pickups[i].y, sub: true };
    }
    return best;
  }
  if (this.phase === "goRadio" && !this.radioActive)
    return { x: this.world.station.doorX, y: this.world.station.doorY };
  if (this.radioActive) return { x: this.world.helipad.x, y: this.world.helipad.y };
  return null;
};
Game.prototype.drawObjectiveArrow = function (g, t) {
  var tg = this.objectiveTarget();
  if (!tg) return;
  var sx = tg.x - this.camera.x, sy = tg.y - this.camera.y;
  if (sx > 16 && sx < CONFIG.VIEW_W - 16 && sy > 16 && sy < CONFIG.VIEW_H - 16) return; // on screen
  var cx = CONFIG.VIEW_W / 2, cy = CONFIG.VIEW_H / 2;
  var dx = sx - cx, dy = sy - cy;
  var kx = dx !== 0 ? (cx - 18) / Math.abs(dx) : 1e9;
  var ky = dy !== 0 ? (cy - 18) / Math.abs(dy) : 1e9;
  var k = Math.min(kx, ky, 1);
  var ax = cx + dx * k, ay = cy + dy * k;
  g.save();
  g.globalAlpha = (tg.sub ? 0.45 : 0.8) + Math.sin(t * 5) * 0.15;
  g.translate(Math.round(ax), Math.round(ay));
  g.rotate(Math.atan2(dy, dx) + Math.PI / 2);
  g.drawImage(SPR.arrow, -5, -5);
  g.restore();
  g.globalAlpha = 1;
};

/* ============================================================================
   BOOT
   ========================================================================== */
function boot() {
  var game = new Game();
  window.__GAME__ = game;    // handy for debugging / tinkering in the console
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", boot);
else
  boot();

})();
