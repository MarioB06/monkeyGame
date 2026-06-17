/* ============================================================================
   SPRITES -- procedural pixel-art factory + bitmap font + drawing primitives.
   BROWSER ONLY (uses canvas). Exposes on window:
     SPR, buildSprites, px, blob, mk, drawText, drawTextShadow, textW
   Depends on window.CONFIG and window.MathUtils.

   Ported from the original monolith. Added: per-player bandana colours so up
   to four players are visually distinct (SPR.players[slot]).
   ========================================================================== */
(function (root) {
  "use strict";
  var CONFIG = root.CONFIG, MathUtils = root.MathUtils;
  var mulberry32 = MathUtils.mulberry32;

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
  function blob(g, cx, cy, rx, ry, col) {
    g.fillStyle = col;
    for (var r = -ry; r <= ry; r++) {
      var t = r / (ry + 0.001);
      var w = Math.round(rx * Math.sqrt(Math.max(0, 1 - t * t)));
      if (w > 0) g.fillRect(Math.round(cx - w), Math.round(cy + r), w * 2, 1);
    }
  }
  function rowsSprite(rows, pal) {
    var h = rows.length, w = 0, i;
    for (i = 0; i < h; i++) w = Math.max(w, rows[i].length);
    var m = mk(w, h);
    for (var y = 0; y < h; y++) {
      var row = rows[y];
      for (var x = 0; x < row.length; x++) { var col = pal[row[x]]; if (col) px(m.g, x, y, 1, 1, col); }
    }
    return m.c;
  }
  function outlined(src, color) {
    try {
      var m = mk(src.width + 2, src.height + 2);
      m.g.drawImage(src, 1, 1);
      var img = m.g.getImageData(0, 0, m.c.width, m.c.height);
      var d = img.data, W = m.c.width, H = m.c.height;
      var solid = new Uint8Array(W * H), x, y;
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) solid[y * W + x] = d[(y * W + x) * 4 + 3] > 40 ? 1 : 0;
      var out = mk(W, H);
      out.g.fillStyle = color || "#16100a";
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        if (!solid[y * W + x]) {
          var n = (x > 0 && solid[y * W + x - 1]) || (x < W - 1 && solid[y * W + x + 1]) ||
                  (y > 0 && solid[(y - 1) * W + x]) || (y < H - 1 && solid[(y + 1) * W + x]);
          if (n) out.g.fillRect(x, y, 1, 1);
        }
      }
      out.g.drawImage(m.c, 0, 0);
      return out.c;
    } catch (e) { return src; }
  }
  function whiteCopy(src) {
    var m = mk(src.width, src.height);
    m.g.drawImage(src, 0, 0);
    m.g.globalCompositeOperation = "source-in";
    m.g.fillStyle = "#ffffff";
    m.g.fillRect(0, 0, src.width, src.height);
    return m.c;
  }

  /* ---------------- bitmap font ---------------- */
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
  var FONT_GLYPHS = {};
  for (var fk in FONT) FONT_GLYPHS[fk] = FONT[fk].split("|");

  function textW(str, scale) {
    scale = scale || 1; var w = 0;
    for (var i = 0; i < str.length; i++) {
      var g = FONT_GLYPHS[str[i]] || FONT_GLYPHS[(str[i] || "").toUpperCase()] || FONT_GLYPHS["?"];
      w += (g[0].length + 1) * scale;
    }
    return w - scale;
  }
  function drawText(g, str, x, y, color, scale, align) {
    scale = scale || 1;
    if (align) x -= textW(str, scale) * align;
    g.fillStyle = color;
    var cx = x;
    for (var i = 0; i < str.length; i++) {
      var gl = FONT_GLYPHS[str[i]] || FONT_GLYPHS[(str[i] || "").toUpperCase()] || FONT_GLYPHS["?"];
      for (var r = 0; r < gl.length; r++) {
        var row = gl[r];
        for (var c = 0; c < row.length; c++) if (row[c] === "#") g.fillRect(cx + c * scale, y + r * scale, scale, scale);
      }
      cx += (gl[0].length + 1) * scale;
    }
  }
  function drawTextShadow(g, str, x, y, color, scale, align) {
    scale = scale || 1;
    drawText(g, str, x + scale, y + scale, "rgba(0,0,0,0.7)", scale, align);
    drawText(g, str, x, y, color, scale, align);
  }

  var SPR = {};

  /* ---------------- player frames ---------------- */
  var PCOL_BASE = {
    skin: "#e8b078", skinD: "#c08850", hair: "#2e1c10",
    band: "#cf4836", bandD: "#9a3226",
    shirt: "#7a8a40", shirtD: "#5a6830",
    pack: "#8a5a2e", packD: "#6a4422",
    pants: "#3a4662", boot: "#241a10", belt: "#503a1e"
  };
  function playerFrame(opts, P) {
    P = P || PCOL_BASE;
    var m = mk(20, 22), g = m.g, o = opts || {};
    var bob = o.bob || 0;
    var lb = o.legB || 0, lf = o.legF || 0, ls = o.legShort ? 1 : 0;
    px(g, 7 + lb, 15, 2, 4 - ls, P.pants); px(g, 7 + lb, 19 - ls, 2, 2, P.boot);
    px(g, 11 + lf, 15, 2, 4 - ls, P.pants); px(g, 11 + lf, 19 - ls, 2, 2, P.boot);
    px(g, 6, 8 + bob, 8, 7, P.shirt);
    px(g, 12, 9 + bob, 2, 6, P.shirtD);
    px(g, 6, 14 + bob, 8, 1, P.belt);
    px(g, 9, 14 + bob, 1, 1, "#d8b03a");
    px(g, 3, 9 + bob, 3, 5, P.pack);
    px(g, 3, 9 + bob, 3, 1, P.packD);
    px(g, 6, 9 + bob, 8, 1, P.packD);
    if (o.armB === "swing") { px(g, 4, 10 + bob, 2, 3, P.shirtD); px(g, 4, 13 + bob, 2, 1, P.skinD); }
    if (o.armB === "trail") { px(g, 3, 11 + bob, 2, 3, P.shirtD); px(g, 3, 14 + bob, 2, 1, P.skinD); }
    if (o.armB === "up")    { px(g, 5, 2 + bob, 2, 5, P.shirtD);  px(g, 5, 1 + bob, 2, 1, P.skinD); }
    if (o.armB === "out")   { px(g, 2, 9 + bob, 4, 2, P.shirtD);  px(g, 1, 9 + bob, 1, 2, P.skinD); }
    px(g, 7, 0 + bob, 8, 2, P.hair);
    px(g, 7, 2 + bob, 1, 4, P.hair);
    px(g, 8, 2 + bob, 7, 5, P.skin);
    px(g, 8, 2 + bob, 7, 1, P.band);
    px(g, 7, 2 + bob, 1, 1, P.bandD);
    px(g, 5, 3 + bob, 2, 2, P.band);
    px(g, 12, 4 + bob, 1, 1, "#1a120a");
    px(g, 8, 6 + bob, 7, 1, P.skinD);
    px(g, 9, 7 + bob, 3, 1, P.skinD);
    if (o.mouth) px(g, 13, 5 + bob, 1, 1, "#5a1f14");
    var fa = o.armF || "down";
    if (fa === "down")  { px(g, 13, 9 + bob, 2, 4, P.shirt); px(g, 13, 13 + bob, 2, 1, P.skin); }
    if (fa === "swingF"){ px(g, 13, 9 + bob, 2, 2, P.shirt); px(g, 14, 11 + bob, 2, 2, P.shirt); px(g, 15, 13 + bob, 2, 1, P.skin); }
    if (fa === "swingB"){ px(g, 12, 9 + bob, 2, 2, P.shirt); px(g, 11, 11 + bob, 2, 2, P.shirt); px(g, 10, 13 + bob, 2, 1, P.skin); }
    if (fa === "throw") { px(g, 13, 8 + bob, 2, 2, P.shirt); px(g, 15, 8 + bob, 3, 2, P.shirt); px(g, 18, 8 + bob, 1, 2, P.skin); }
    if (fa === "up")    { px(g, 13, 7 + bob, 2, 2, P.shirt); px(g, 14, 4 + bob, 2, 3, P.shirt); px(g, 14, 3 + bob, 2, 1, P.skin); }
    if (fa === "out")   { px(g, 14, 9 + bob, 4, 2, P.shirt); px(g, 18, 9 + bob, 1, 2, P.skin); }
    return outlined(m.c);
  }
  function playerSlideFrame(P) {
    P = P || PCOL_BASE;
    var m = mk(24, 14), g = m.g;
    px(g, 2, 9, 4, 2, P.boot);
    px(g, 5, 8, 5, 3, P.pants);
    px(g, 9, 6, 8, 5, P.shirt);
    px(g, 9, 4, 4, 3, P.pack);
    px(g, 16, 8, 2, 4, P.shirtD);
    px(g, 16, 12, 2, 1, P.skin);
    px(g, 15, 1, 7, 2, P.hair);
    px(g, 16, 2, 6, 5, P.skin);
    px(g, 16, 2, 6, 1, P.band);
    px(g, 20, 4, 1, 1, "#1a120a");
    return outlined(m.c);
  }
  function buildPlayerSet(P) {
    return {
      idle: [playerFrame({}, P), playerFrame({ bob: 1 }, P)],
      run: [
        playerFrame({ legB: -2, legF: 2, armF: "swingB", armB: "swing" }, P),
        playerFrame({ legShort: 1, bob: 1 }, P),
        playerFrame({ legB: 2, legF: -2, armF: "swingF", armB: "trail" }, P),
        playerFrame({ legShort: 1, bob: 1 }, P)
      ],
      throwF: playerFrame({ armF: "throw", armB: "trail" }, P),
      counter: playerFrame({ armF: "up", armB: "out" }, P),
      hurt: playerFrame({ armF: "out", armB: "out", mouth: true }, P),
      rise: playerFrame({ armF: "up", armB: "up", legShort: 1 }, P),
      slide: playerSlideFrame(P)
    };
  }

  /* ---------------- monkey frames ---------------- */
  var MSPEC = {
    normal: { W: 16, H: 15, fur: "#8a5a32", furD: "#6a4324", belly: "#caa06a", face: "#d8b088" },
    guard:  { W: 18, H: 17, fur: "#6e4624", furD: "#523218", belly: "#b08a52", face: "#c8a070" },
    alpha:  { W: 26, H: 22, fur: "#54341c", furD: "#3c2412", belly: "#9a7444", face: "#b89060" }
  };
  function monkeyFrame(type, pose) {
    var s = MSPEC[type], big = type === "alpha", W = s.W, H = s.H;
    var m = mk(W + 4, H), g = m.g;
    var bob = (pose === "idle1" || pose === "walk1") ? 1 : 0;
    var bw = big ? 14 : 8, bx = big ? 6 : 4, bTop = (big ? 9 : 6) + bob;
    var legY = H - 2, legW = big ? 3 : 2;
    var tx = bx - 1, ty = bTop + 2;
    px(g, tx, ty, 1, 2, s.furD); px(g, tx - 1, ty - 2, 1, 2, s.furD);
    px(g, tx - 2, ty - 4, 1, 2, s.furD); px(g, tx - 1, ty - 5, 1, 1, s.furD);
    var l0 = 0, l1 = 0;
    if (pose === "walk0") { l0 = -1; l1 = 1; }
    if (pose === "walk1") { l0 = 1;  l1 = -1; }
    px(g, bx + 1 + l0, legY, legW, 2, s.furD);
    px(g, bx + bw - legW - 1 + l1, legY, legW, 2, s.furD);
    px(g, bx, bTop, bw, legY - bTop, s.fur);
    px(g, bx + Math.round(bw * 0.45), bTop + 2, Math.round(bw * 0.4), legY - bTop - 3, s.belly);
    var hw = big ? 13 : 8, hh = big ? 12 : 8, hx = big ? 12 : 8, hy = bob;
    if (big) px(g, hx - 2, hy, hw + 3, hh - 1, "#2c1a0c");
    px(g, hx, hy, hw, hh - 1, s.fur);
    px(g, hx + 2, hy + 2, hw - 3, hh - 4, s.face);
    px(g, hx - 1, hy + 2, 2, 2, s.fur); px(g, hx + hw - 1, hy + 2, 2, 2, s.fur);
    px(g, hx, hy + 3, 1, 1, "#c87a6a"); px(g, hx + hw - 1, hy + 3, 1, 1, "#c87a6a");
    var ey = hy + (big ? 4 : 3);
    if (pose === "hit") {
      px(g, hx + 3, ey, 1, 1, "#1a120a"); px(g, hx + 5, ey, 1, 1, "#1a120a");
      px(g, hx + 4, ey + 2, 2, 1, "#5a1f14");
    } else {
      px(g, hx + 3, ey, 1, 1, "#1a120a"); px(g, hx + (big ? 7 : 5), ey, 1, 1, "#1a120a");
      if (big) { px(g, hx + 2, ey - 1, 3, 1, s.furD); px(g, hx + 6, ey - 1, 3, 1, s.furD); }
    }
    px(g, hx + (big ? 5 : 4), ey + 2, 1, 1, s.furD);
    if (big) px(g, hx + hw - 3, ey + 3, 1, 2, "#d8c0a0");
    if (type === "guard") { px(g, hx, hy + 1, hw, 1, "#c03a2a"); px(g, hx - 1, hy + 2, 1, 2, "#c03a2a"); }
    if (type === "guard" && pose !== "dead") { px(g, bx - 2, bTop - 4, 1, 7, "#6a4a22"); px(g, bx - 1, bTop - 1, 1, 3, "#6a4a22"); }
    var armW2 = big ? 3 : 2, shY = bTop + 1, frontX = bx + bw - 1;
    function bananaInHand(hxx, hyy) { px(g, hxx, hyy, 3, 1, "#f2d23c"); px(g, hxx + 1, hyy - 1, 2, 1, "#f2d23c"); }
    switch (pose) {
      case "walk0": px(g, frontX, shY, armW2, 3, s.furD); px(g, bx - 1, shY + 1, armW2, 3, s.furD); break;
      case "walk1": px(g, frontX - 1, shY + 1, armW2, 3, s.furD); px(g, bx, shY, armW2, 3, s.furD); break;
      case "windup": px(g, frontX, shY - 4, armW2, 4, s.furD); bananaInHand(frontX, shY - 6); break;
      case "throw": px(g, frontX, shY, 4, armW2, s.furD); break;
      case "hold": px(g, bx, shY - 4, armW2, 5, s.furD); px(g, bx + bw - armW2, shY - 4, armW2, 5, s.furD); break;
      case "hit": px(g, bx - 2, shY, 3, armW2, s.furD); px(g, frontX, shY, 3, armW2, s.furD); break;
      default: px(g, frontX, shY, armW2, 4, s.furD); break;
    }
    return outlined(m.c);
  }
  function monkeyDeadFrame(type) {
    var s = MSPEC[type], big = type === "alpha";
    var W = big ? 30 : 20, H = big ? 14 : 10;
    var m = mk(W, H), g = m.g;
    blob(g, W * 0.42, H - 4, W * 0.36, 3, s.fur);
    px(g, W - (big ? 12 : 8), H - 8, big ? 10 : 7, big ? 7 : 6, s.fur);
    px(g, W - (big ? 10 : 7), H - 6, big ? 7 : 5, big ? 4 : 3, s.face);
    px(g, W - (big ? 8 : 6), H - 5, 1, 1, "#1a120a"); px(g, W - (big ? 6 : 4), H - 5, 1, 1, "#1a120a");
    px(g, 1, H - 5, 3, 1, s.furD);
    return outlined(m.c);
  }

  /* ---------------- items, chest, helicopter, environment ---------------- */
  function bananaSprite(body, shade, tip) {
    return outlined(rowsSprite([
      "...tt...", "..tyyt..", ".tyYyt..", ".tyYt...", "tyYy....", "tyyt....", ".tt....."
    ], { t: tip, y: body, Y: shade }));
  }
  function chestSprite(state) {
    var m = mk(18, 14), g = m.g;
    var wood = "#8a5430", woodL = "#a06a40", woodD = "#5e3a20", met = "#9aa0aa", metD = "#6a7078";
    if (state === "open") {
      px(g, 1, 0, 16, 4, woodD); px(g, 2, 1, 14, 2, wood);
      px(g, 2, 4, 14, 3, "#241608"); px(g, 4, 4, 10, 2, "#f0d03a");
      px(g, 1, 7, 16, 6, wood); px(g, 1, 7, 16, 1, woodL);
      px(g, 3, 7, 2, 6, metD); px(g, 13, 7, 2, 6, metD);
    } else {
      px(g, 2, 1, 14, 2, woodL); px(g, 1, 3, 16, 4, wood); px(g, 1, 7, 16, 6, wood);
      px(g, 1, 7, 16, 1, woodD); px(g, 2, 10, 14, 1, woodD);
      px(g, 3, 1, 2, 12, met);  px(g, 13, 1, 2, 12, met);
      px(g, 3, 3, 2, 1, metD);  px(g, 13, 3, 2, 1, metD);
      px(g, 8, 6, 3, 4, "#d8b03a"); px(g, 9, 8, 1, 1, "#5e3a20");
      if (state === "cracked") {
        px(g, 6, 2, 1, 2, "#241608"); px(g, 7, 4, 1, 2, "#241608");
        px(g, 6, 6, 1, 3, "#241608"); px(g, 11, 3, 1, 3, "#241608");
        px(g, 8, 6, 3, 4, woodD);
      }
    }
    return outlined(m.c);
  }
  function heliSprite() {
    var m = mk(48, 18), g = m.g;
    var body = "#5a663a", bodyD = "#46522c", glass = "#9adfe8";
    px(g, 26, 6, 18, 3, bodyD); px(g, 42, 2, 3, 6, body);
    blob(g, 16, 9, 13, 6, body);
    px(g, 4, 6, 8, 5, glass); px(g, 4, 6, 8, 1, "#cdeef4");
    px(g, 14, 7, 8, 5, bodyD); px(g, 16, 8, 4, 3, "#e8e8e0");
    px(g, 17, 8, 2, 3, "#d8483a"); px(g, 16, 9, 4, 1, "#d8483a");
    px(g, 6, 15, 16, 1, "#2a2a24"); px(g, 24, 15, 12, 1, "#2a2a24");
    px(g, 9, 13, 1, 2, "#2a2a24"); px(g, 28, 13, 1, 2, "#2a2a24");
    px(g, 20, 1, 2, 4, "#2a2a24");
    return outlined(m.c, "#10140c");
  }
  function treeSprite(variant) {
    var m = mk(44, 52), g = m.g;
    var t1 = "#1d3d1f", t2 = "#2a5a2a", t3 = "#3a7a36", hi = "#4f9a44";
    px(g, 19, 36, 6, 14, "#4a3018"); px(g, 18, 47, 8, 3, "#3a2412");
    px(g, 16, 49, 3, 2, "#3a2412"); px(g, 25, 49, 3, 2, "#3a2412");
    px(g, 21, 36, 2, 12, "#5e3e20");
    blob(g, 22, 22, 20, 14, t1); blob(g, 18, 18, 14, 10, t2);
    blob(g, 27, 16, 11, 9, t2); blob(g, 20, 13, 10, 7, t3);
    var rr = mulberry32(variant * 977 + 5), i;
    for (i = 0; i < 26; i++) px(g, 6 + rr() * 32, 6 + rr() * 22, 2, 1, rr() < 0.5 ? hi : t3);
    for (i = 0; i < 3; i++) { var vx = 8 + Math.floor(rr() * 28); px(g, vx, 30, 1, 5 + Math.floor(rr() * 7), t1); }
    if (variant === 2) { px(g, 28, 30, 3, 2, "#f2d23c"); px(g, 29, 32, 2, 2, "#f2d23c"); }
    return m.c;
  }
  // big climbable tree with a dark "hollow" you hide in (taller + wider than treeSprite)
  function bigTreeSprite() {
    var m = mk(64, 82), g = m.g;
    var t1 = "#1a3a1c", t2 = "#27531f", t3 = "#357a30", hi = "#4f9a44";
    var bark = "#4a3018", barkL = "#5e3e20", barkD = "#3a2412";
    // trunk + root flare
    px(g, 28, 50, 9, 30, bark);
    px(g, 31, 50, 3, 30, barkL);
    px(g, 26, 76, 13, 4, barkD);
    px(g, 22, 78, 5, 3, barkD); px(g, 39, 78, 5, 3, barkD);
    px(g, 30, 40, 3, 14, barkL);
    // big multi-blob canopy
    blob(g, 32, 30, 30, 20, t1);
    blob(g, 24, 24, 20, 14, t2); blob(g, 42, 24, 18, 13, t2);
    blob(g, 32, 16, 16, 11, t3);
    blob(g, 18, 32, 11, 8, t2); blob(g, 46, 33, 11, 8, t2);
    // hollow / perch where a player hides
    blob(g, 32, 40, 9, 6, "#102310");
    px(g, 28, 40, 8, 2, "#0a160a");
    var rr = mulberry32(7321), i;
    for (i = 0; i < 60; i++) px(g, 4 + rr() * 56, 6 + rr() * 40, 2, 1, rr() < 0.5 ? hi : t3);
    for (i = 0; i < 6; i++) { var vx = 8 + Math.floor(rr() * 48); px(g, vx, 44, 1, 8 + Math.floor(rr() * 14), t1); }
    px(g, 44, 42, 3, 2, "#f2d23c"); px(g, 45, 44, 2, 2, "#f2d23c");   // banana bunch
    return m.c;
  }
  function palmSprite() {
    var m = mk(36, 46), g = m.g;
    px(g, 16, 36, 4, 10, "#7a5a30"); px(g, 17, 28, 4, 9, "#8a6a3a");
    px(g, 19, 20, 4, 9, "#7a5a30"); px(g, 20, 14, 4, 7, "#8a6a3a");
    var f = "#3a8a3a", fd = "#2a6a2c";
    px(g, 10, 8, 12, 2, f);  px(g, 4, 10, 8, 2, fd);
    px(g, 22, 6, 10, 2, f);  px(g, 30, 9, 5, 2, fd);
    px(g, 14, 4, 3, 8, f);   px(g, 22, 10, 3, 7, fd); px(g, 18, 2, 4, 4, f);
    px(g, 20, 12, 3, 2, "#5e3e20"); px(g, 23, 13, 2, 2, "#5e3e20");
    return m.c;
  }
  function bushSprite(v) {
    var m = mk(16, 10), g = m.g;
    blob(g, 8, 6, 7, 3, "#234c22"); blob(g, 6, 4, 5, 3, "#326a30"); blob(g, 11, 5, 4, 2, "#3a7a36");
    if (v === 1) { px(g, 5, 4, 1, 1, "#d84848"); px(g, 10, 6, 1, 1, "#d84848"); }
    return m.c;
  }
  function rockSprite() {
    var m = mk(14, 10), g = m.g;
    blob(g, 7, 6, 6, 3, "#5e6266"); px(g, 3, 3, 7, 3, "#6a6e72");
    px(g, 4, 2, 4, 2, "#7a7e82"); px(g, 8, 7, 3, 1, "#3a8a3a");
    return outlined(m.c, "#23262a");
  }
  function rubbleSprite(v) {
    var m = mk(20, 12), g = m.g, rr = mulberry32(v * 31 + 7);
    for (var i = 0; i < 14; i++) {
      var cols = ["#6a6e72", "#7a7e82", "#5e5a52", "#8a857a"];
      px(g, 1 + rr() * 16, 3 + rr() * 7, 2 + rr() * 3, 2 + rr() * 2, cols[Math.floor(rr() * 4)]);
    }
    px(g, 3, 8, 3, 1, "#3a7a36"); px(g, 14, 5, 2, 1, "#3a7a36");
    return m.c;
  }
  function carSpriteH(colMain) {
    var m = mk(40, 18), g = m.g, dark = "#23262a";
    px(g, 2, 7, 36, 7, colMain); px(g, 2, 7, 36, 2, "#ffffff22");
    px(g, 8, 2, 18, 6, colMain); px(g, 10, 3, 6, 4, "#1c2a30"); px(g, 18, 3, 6, 4, "#1c2a30");
    px(g, 12, 4, 1, 2, "#cdeef4"); px(g, 2, 9, 4, 3, "#caa84e"); px(g, 35, 9, 3, 3, "#7a2a1a");
    px(g, 6, 11, 5, 2, "#7a4a22"); px(g, 26, 8, 6, 2, "#7a4a22");
    px(g, 14, 1, 8, 2, "#3a7a36"); px(g, 30, 6, 5, 1, "#3a7a36");
    px(g, 7, 13, 6, 4, dark); px(g, 28, 13, 6, 4, dark);
    px(g, 9, 14, 2, 2, "#46464a"); px(g, 30, 14, 2, 2, "#46464a");
    return outlined(m.c, "#15171a");
  }
  function carSpriteV(colMain) {
    var m = mk(20, 26), g = m.g;
    px(g, 3, 3, 14, 20, colMain); px(g, 4, 5, 12, 5, "#1c2a30");
    px(g, 4, 12, 12, 6, "#3a7a36"); px(g, 4, 20, 12, 3, "#1c2a30");
    px(g, 1, 6, 2, 5, "#23262a"); px(g, 17, 6, 2, 5, "#23262a");
    px(g, 1, 17, 2, 5, "#23262a"); px(g, 17, 17, 2, 5, "#23262a");
    px(g, 5, 1, 3, 2, "#7a2a1a"); px(g, 12, 1, 3, 2, "#7a2a1a"); px(g, 8, 14, 4, 2, "#7a4a22");
    return outlined(m.c, "#15171a");
  }
  function lampSprite(broken) {
    var m = mk(14, 36), g = m.g;
    px(g, 4, 33, 6, 3, "#3a3e44");
    if (broken) {
      px(g, 6, 14, 2, 19, "#4a4e54"); px(g, 7, 8, 2, 7, "#4a4e54"); px(g, 8, 6, 4, 2, "#4a4e54");
      px(g, 10, 8, 4, 4, "#2a2e34"); px(g, 6, 18, 1, 8, "#2a5a2a");
    } else {
      px(g, 6, 4, 2, 29, "#4a4e54"); px(g, 6, 4, 6, 2, "#4a4e54"); px(g, 10, 5, 4, 4, "#3a3e44");
      px(g, 11, 6, 2, 2, "#f0e0a0"); px(g, 6, 20, 1, 9, "#2a5a2a");
    }
    return m.c;
  }
  function hutSprite() {
    var m = mk(44, 34), g = m.g;
    blob(g, 22, 18, 20, 12, "#6a5026"); blob(g, 22, 13, 16, 8, "#8a6a32"); blob(g, 22, 9, 11, 5, "#4a6a2a");
    px(g, 17, 22, 10, 12, "#2a1c10"); px(g, 19, 22, 6, 1, "#6a4a22");
    px(g, 4, 26, 4, 2, "#caa84e"); px(g, 36, 28, 5, 2, "#caa84e");
    return m.c;
  }
  function totemSprite() {
    var m = mk(16, 34), g = m.g, cols = ["#b05a3a", "#3a8a8a", "#caa84e"];
    for (var i = 0; i < 3; i++) {
      var y = 2 + i * 10;
      px(g, 2, y, 12, 10, cols[i]); px(g, 1, y, 14, 2, "#6a4422");
      px(g, 4, y + 3, 2, 2, "#1a120a"); px(g, 10, y + 3, 2, 2, "#1a120a"); px(g, 5, y + 7, 6, 1, "#1a120a");
    }
    px(g, 0, 2, 3, 3, "#6a4422"); px(g, 13, 2, 3, 3, "#6a4422");
    return outlined(m.c, "#1a140c");
  }
  function fountainSprite() {
    var m = mk(56, 40), g = m.g;
    blob(g, 28, 30, 26, 9, "#8a8a82"); blob(g, 28, 28, 22, 7, "#9a9a92"); blob(g, 28, 28, 18, 5, "#2e5a4e");
    px(g, 14, 26, 5, 2, "#3a8a5a"); px(g, 34, 30, 6, 2, "#3a8a5a");
    px(g, 24, 8, 8, 18, "#9a9a92"); px(g, 24, 8, 8, 2, "#aaaaa2"); px(g, 26, 4, 4, 5, "#8a8a82");
    px(g, 27, 10, 1, 10, "#5a5a52"); px(g, 30, 12, 4, 6, "#2a5a2a");
    return m.c;
  }
  function columnSprite() {
    var m = mk(12, 30), g = m.g;
    px(g, 1, 26, 10, 4, "#8a8a82"); px(g, 3, 6, 6, 21, "#9a9a92");
    px(g, 4, 6, 1, 21, "#aaaaa2"); px(g, 7, 6, 1, 21, "#6a6a62");
    px(g, 3, 4, 6, 3, "#9a9a92"); px(g, 5, 2, 3, 3, "#9a9a92"); px(g, 3, 18, 2, 6, "#2a5a2a");
    return outlined(m.c, "#2a2a26");
  }
  function signSprite() {
    var m = mk(24, 26), g = m.g;
    px(g, 3, 8, 2, 18, "#5a5048"); px(g, 19, 8, 2, 18, "#5a5048");
    px(g, 1, 2, 22, 10, "#7a6a4a"); px(g, 2, 3, 20, 8, "#9a8a62");
    px(g, 3, 4, 8, 2, "#c8b89a"); px(g, 13, 4, 6, 2, "#c8b89a"); px(g, 3, 8, 12, 2, "#c8b89a");
    px(g, 17, 8, 2, 2, "#3a2e22"); px(g, 6, 12, 3, 2, "#2a5a2a");
    return outlined(m.c, "#1f1a12");
  }
  function fireSprite() {
    var m = mk(16, 10), g = m.g;
    px(g, 1, 6, 3, 3, "#6a6e72"); px(g, 6, 8, 3, 2, "#6a6e72");
    px(g, 12, 6, 3, 3, "#6a6e72"); px(g, 3, 8, 2, 2, "#5e6266");
    px(g, 4, 5, 8, 2, "#5e3e20"); px(g, 6, 3, 2, 4, "#4a3018");
    return m.c;
  }
  function stationSprite() {
    var m = mk(130, 76), g = m.g;
    px(g, 0, 14, 130, 62, "#8a8a82"); px(g, 0, 14, 130, 3, "#a0a098");
    px(g, 0, 8, 130, 6, "#6a6a62"); px(g, 6, 10, 30, 3, "#3a7a36"); px(g, 90, 9, 24, 3, "#3a7a36");
    for (var i = 1; i < 5; i++) px(g, i * 26, 17, 1, 59, "#7a7a72");
    px(g, 0, 44, 130, 1, "#7a7a72");
    px(g, 56, 50, 18, 26, "#4a4e54"); px(g, 57, 51, 16, 24, "#5a5e64");
    for (i = 0; i < 4; i++) px(g, 57, 52 + i * 6, 16, 3, i % 2 ? "#caa84e" : "#3a3e44");
    px(g, 70, 62, 2, 3, "#d8b03a");
    px(g, 18, 30, 16, 12, "#1c2024"); px(g, 17, 32, 18, 3, "#6a4e2e"); px(g, 17, 37, 18, 3, "#6a4e2e");
    px(g, 96, 28, 18, 14, "#16282e"); px(g, 98, 30, 5, 5, "#2a4a52");
    blob(g, 112, 6, 9, 5, "#b8b8b0"); px(g, 111, 6, 3, 6, "#8a8a82");
    drawText(g, "RADIO", 40, 22, "#d8d0b8", 2, 0);
    drawText(g, "STATION", 36, 34, "#b8b0a0", 1, 0);
    px(g, 0, 70, 24, 6, "#3a6a32"); px(g, 100, 68, 30, 8, "#3a6a32");
    px(g, 40, 60, 2, 16, "#2a5a2a"); px(g, 84, 20, 1, 20, "#5a5a52"); px(g, 85, 38, 1, 10, "#5a5a52");
    return m.c;
  }
  function towerSprite() {
    var m = mk(30, 96), g = m.g, steel = "#7a6a52", steelD = "#5a4e3c";
    for (var i = 0; i < 8; i++) {
      var y = 88 - i * 11, inset = i * 1.2;
      px(g, 4 + inset, y - 11, 2, 12, steel); px(g, 24 - inset, y - 11, 2, 12, steel);
      px(g, 5 + inset, y - 4, 19 - inset * 2, 2, steelD);
    }
    px(g, 12, 6, 6, 4, steel); px(g, 14, 0, 2, 7, "#4a4e54"); px(g, 13, 0, 4, 2, "#8a2a1a");
    px(g, 6, 60, 2, 10, "#2a5a2a"); px(g, 22, 40, 2, 14, "#2a5a2a");
    return m.c;
  }
  function buildingSprite(w, h, seed) {
    var rr = mulberry32(seed), m = mk(w, h), g = m.g;
    var walls = ["#8a857a", "#7d8a80", "#928a78", "#857a6e"], wall = walls[Math.floor(rr() * walls.length)], roofH = 14;
    px(g, 0, roofH, w, h - roofH, wall); px(g, 0, roofH, w, 2, "#ffffff22");
    px(g, 0, 0, w, roofH, "#5a564e"); px(g, 0, roofH - 2, w, 2, "#46423a");
    for (var i = 0; i < w / 14; i++) px(g, rr() * (w - 10), 2 + rr() * (roofH - 7), 6 + rr() * 8, 3, rr() < 0.5 ? "#3a6a32" : "#2a5a2a");
    var cols = Math.max(2, Math.floor((w - 16) / 22)), rows2 = Math.max(1, Math.floor((h - roofH - 18) / 24));
    for (var r = 0; r < rows2; r++) for (var c = 0; c < cols; c++) {
      var wx = 8 + c * ((w - 28) / Math.max(1, cols - 1));
      if (cols === 1) wx = (w - 12) / 2;
      var wy = roofH + 8 + r * 24, kind = rr();
      px(g, wx, wy, 12, 14, "#1c2024");
      if (kind < 0.35) { px(g, wx - 1, wy + 2, 14, 3, "#6a4e2e"); px(g, wx - 1, wy + 8, 14, 3, "#5e442a"); }
      else if (kind < 0.6) { px(g, wx + 2, wy + 2, 3, 4, "#2a4a52"); px(g, wx + 8, wy + 7, 2, 3, "#2a4a52"); }
      else { px(g, wx + 1, wy + 1, 10, 5, "#22343a"); px(g, wx + 2, wy + 2, 2, 2, "#3a5a64"); }
    }
    var cx = 6 + rr() * (w - 12), cy = roofH + 4;
    for (i = 0; i < (h - roofH) / 6; i++) { px(g, cx, cy, 1, 5, "#55504a"); cx += rr() < 0.5 ? -2 : 2; cy += 5; }
    for (i = 0; i < w / 16; i++) {
      var vx = 4 + rr() * (w - 8), vl = 8 + rr() * (h * 0.45);
      px(g, vx, roofH, 2, vl, "#2a5226"); px(g, vx - 1, roofH + vl - 3, 1, 2, "#3a7a36");
      px(g, vx + 2, roofH + 4 + rr() * vl * 0.5, 1, 2, "#3a7a36");
    }
    for (i = 0; i < w / 6; i++) px(g, rr() * (w - 4), h - 5 + rr() * 3, 3 + rr() * 4, 2, rr() < 0.5 ? "#3a6a32" : "#41773a");
    return m.c;
  }

  function buildSprites() {
    // per-player coloured sets (slot 0 == classic red)
    SPR.players = (CONFIG.PLAYER_COLORS || [{ band: PCOL_BASE.band, bandD: PCOL_BASE.bandD }]).map(function (c) {
      var P = {}; for (var k in PCOL_BASE) P[k] = PCOL_BASE[k];
      P.band = c.band; P.bandD = c.bandD;
      return buildPlayerSet(P);
    });
    SPR.player = SPR.players[0];

    SPR.monkey = {};
    ["normal", "guard", "alpha"].forEach(function (t) {
      var s = {
        idle: [monkeyFrame(t, "idle0"), monkeyFrame(t, "idle1")],
        walk: [monkeyFrame(t, "walk0"), monkeyFrame(t, "walk1")],
        windup: monkeyFrame(t, "windup"), throwF: monkeyFrame(t, "throw"),
        hold: monkeyFrame(t, "hold"), hit: monkeyFrame(t, "hit"), dead: monkeyDeadFrame(t)
      };
      s.hitFlash = whiteCopy(s.hit);
      SPR.monkey[t] = s;
    });

    SPR.banana  = bananaSprite("#f2d23c", "#fae88a", "#8a6a1a");
    SPR.bananaR = bananaSprite("#f08a3a", "#ffc05a", "#7a2a12");
    SPR.bananaG = bananaSprite("#ffe680", "#ffffff", "#b08a20");
    SPR.part = outlined(rowsSprite([
      ".g.g.g.g..", "##########", "#cccccccc#", "#cRcccLcc#", "#cccccccc#", "##########", ".g.g.g.g.."
    ], { "#": "#10241a", c: "#2a7a4a", R: "#ff4a3a", L: "#caa84e", g: "#d8b03a" }));
    SPR.heart = outlined(rowsSprite([
      ".rr.rr.", "rhrrrrr", "rrrrrrr", ".rrrrr.", "..rrr..", "...r..."
    ], { r: "#e04848", h: "#ff9a8a" }));
    SPR.star = outlined(rowsSprite([
      "...g...", "..ggg..", ".ggwgg.", "gggwggg", ".ggwgg.", "..ggg..", "...g..."
    ], { g: "#e8c83a", w: "#fff8d0" }));
    SPR.gban = bananaSprite("#ffd84a", "#fff0a0", "#a07a18");
    SPR.crosshair = outlined(rowsSprite([
      "...w...", "...w...", ".......", "ww.w.ww", ".......", "...w...", "...w..."
    ], { w: "#f0f0e0" }), "#10100c");
    SPR.arrow = outlined(rowsSprite([
      "....g....", "...ggg...", "..ggggg..", ".ggggggg.", "ggggggggg", "...ggg...", "...ggg...", "...ggg..."
    ], { g: "#f0d03a" }), "#3a2a08");
    SPR.chest = { closed: chestSprite("closed"), cracked: chestSprite("cracked"), open: chestSprite("open") };
    SPR.heli = heliSprite();
    SPR.trees = [treeSprite(0), treeSprite(1), treeSprite(2), treeSprite(3)];
    SPR.bigtree = bigTreeSprite();
    SPR.palms = [palmSprite()];
    SPR.bushes = [bushSprite(0), bushSprite(1)];
    SPR.rocks = [rockSprite()];
    SPR.rubbles = [rubbleSprite(0), rubbleSprite(1), rubbleSprite(2)];
    SPR.carH = [carSpriteH("#8a3a2a"), carSpriteH("#3a6a8a"), carSpriteH("#8a7a3a")];
    SPR.carV = [carSpriteV("#5a7a4a"), carSpriteV("#7a4a5a")];
    SPR.lamp = lampSprite(false); SPR.lampB = lampSprite(true);
    SPR.hut = hutSprite(); SPR.totem = totemSprite(); SPR.fountain = fountainSprite();
    SPR.column = columnSprite(); SPR.sign = signSprite(); SPR.fire = fireSprite();
    SPR.station = stationSprite(); SPR.tower = towerSprite();
    var g0 = mk(7, 6), g1 = mk(7, 6);
    [[g0.g, 0], [g1.g, 1]].forEach(function (pair) {
      var gg = pair[0], f = pair[1];
      px(gg, 1, 2, 1, 4, "#3a7a36"); px(gg, 3 + f, 0, 1, 6, "#4f9a44");
      px(gg, 5, 1 + f, 1, 5, "#3a7a36"); px(gg, 2 + f, 3, 1, 3, "#2a5a2a");
    });
    SPR.grass = [g0.c, g1.c];
    SPR.flowers = [
      rowsSprite(["..r..", ".rrr.", "..r..", "..s..", "..s.."], { r: "#d85a5a", s: "#3a7a36" }),
      rowsSprite(["..y..", ".yyy.", "..y..", "..s..", "..s.."], { y: "#e8c83a", s: "#3a7a36" }),
      rowsSprite(["..w..", ".www.", "..w..", "..s..", "..s.."], { w: "#e8e8e0", s: "#3a7a36" })
    ];
    // map of object kind -> sprite resolver, used by render + groundgen
    SPR.objSprite = function (o) {
      switch (o.kind) {
        case "building": return buildingSprite(o.w, o.h, o.bseed);
        case "station": return SPR.station;
        case "tower": return SPR.tower;
        case "carH": return SPR.carH[o.variant % SPR.carH.length];
        case "carV": return SPR.carV[o.variant % SPR.carV.length];
        case "lamp": return o.broken ? SPR.lampB : SPR.lamp;
        case "hut": return SPR.hut;
        case "totem": return SPR.totem;
        case "fire": return SPR.fire;
        case "sign": return SPR.sign;
        case "fountain": return SPR.fountain;
        case "column": return SPR.column;
        case "rubble": return SPR.rubbles[o.variant % SPR.rubbles.length];
        case "rock": return SPR.rocks[0];
        case "tree": return SPR.trees[o.variant % SPR.trees.length];
        case "bigtree": return SPR.bigtree;
        case "palm": return SPR.palms[0];
        case "bush": return SPR.bushes[o.variant % SPR.bushes.length];
      }
      return null;
    };
  }

  // expose
  root.SPR = SPR;
  root.buildSprites = buildSprites;
  root.mk = mk; root.px = px; root.blob = blob;
  root.drawText = drawText; root.drawTextShadow = drawTextShadow; root.textW = textW;
  root.flowerSprite = function (i) { return SPR.flowers[i % SPR.flowers.length]; };
})(typeof window !== "undefined" ? window : this);
