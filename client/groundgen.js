/* ============================================================================
   GROUNDGEN -- paints the static ground layer into one offscreen canvas.
   BROWSER ONLY. Exposes window.buildGround(layout) -> { groundCanvas }.

   Uses its OWN seeded RNG stream (seed ^ 0x9E3779B9) so the ground texture is
   deterministic but decoupled from worldgen's layout stream -- reordering the
   two halves can't shift collision/object positions (see plan).
   ========================================================================== */
(function (root) {
  "use strict";
  var CONFIG = root.CONFIG, M = root.MathUtils, SPR = root.SPR;
  var px = root.px, blob = root.blob, mk = root.mk;
  var mulberry32 = M.mulberry32, lerp = M.lerp, dist = M.dist;

  function buildGround(layout) {
    var W = CONFIG.WORLD_W, H = CONFIG.WORLD_H;
    var R = mulberry32(((layout.seed >>> 0) ^ 0x9E3779B9) >>> 0);
    function wr(a, b) { return a + R() * (b - a); }
    function wri(a, b) { return Math.floor(wr(a, b + 1)); }

    var gr = mk(W, H), g = gr.g, i, x, y;

    // base jungle floor with noise
    px(g, 0, 0, W, H, "#2e5a28");
    for (i = 0; i < 2600; i++) {
      var c = R();
      px(g, R() * W, R() * H, 2 + R() * 4, 2 + R() * 3, c < 0.4 ? "#356331" : (c < 0.8 ? "#27511f" : "#3a6e30"));
    }
    for (i = 0; i < 220; i++) px(g, R() * W, R() * H, 2, 2, R() < 0.5 ? "#54452a" : "#6a5a30");

    // darker jungle border band
    for (i = 0; i < 700; i++) {
      var bx = R() * W, by = R() * H;
      if (bx > 90 && bx < W - 90 && by > 90 && by < H - 90) continue;
      px(g, bx, by, 4 + R() * 6, 3 + R() * 4, R() < 0.5 ? "#1d3d1f" : "#234c22");
    }

    // dirt paths (from layout.paths)
    layout.paths.forEach(function (path) {
      for (var s = 0; s < path.length - 1; s++) {
        var ax = path[s][0], ay = path[s][1], bx2 = path[s + 1][0], by2 = path[s + 1][1];
        var steps = Math.ceil(dist(ax, ay, bx2, by2) / 5);
        for (var st = 0; st <= steps; st++) {
          var t = st / steps;
          var cx2 = lerp(ax, bx2, t) + wr(-3, 3), cy2 = lerp(ay, by2, t) + wr(-3, 3);
          blob(g, cx2, cy2, 7 + R() * 3, 4 + R() * 2, R() < 0.7 ? "#6a5430" : "#5e4a2a");
        }
      }
    });

    // trampled clearings
    blob(g, 220, 990, 130, 90, "#3f7233"); blob(g, 200, 1010, 30, 18, "#6a5430");
    blob(g, 1290, 950, 200, 150, "#7a5e34");
    for (i = 0; i < 90; i++) px(g, 1090 + R() * 400, 800 + R() * 300, 2, 2, R() < 0.5 ? "#6a5028" : "#8a6e3e");
    blob(g, 250, 250, 180, 150, "#27511f");
    for (i = 0; i < 80; i++) px(g, 90 + R() * 320, 110 + R() * 280, 2, 2, R() < 0.5 ? "#54452a" : "#1d3d1f");

    // roads
    function roadH(rx, ry, rw, rh) {
      px(g, rx, ry - 14, rw, 14, "#6a675e"); px(g, rx, ry + rh, rw, 14, "#6a675e");
      for (var sx2 = rx; sx2 < rx + rw; sx2 += 16) { px(g, sx2, ry - 14, 1, 14, "#56544c"); px(g, sx2, ry + rh, 1, 14, "#56544c"); }
      px(g, rx, ry, rw, rh, "#3c3c40");
      for (var n = 0; n < rw / 4; n++) px(g, rx + R() * rw, ry + R() * rh, 2 + R() * 3, 1 + R() * 2, R() < 0.5 ? "#44444a" : "#36363a");
      for (var d = rx + 10; d < rx + rw; d += 26) if (R() > 0.3) px(g, d, ry + rh / 2 - 1, 10, 2, "#a8a08a");
    }
    function roadV(rx, ry, rw, rh) {
      px(g, rx - 14, ry, 14, rh, "#6a675e"); px(g, rx + rw, ry, 14, rh, "#6a675e");
      for (var sy2 = ry; sy2 < ry + rh; sy2 += 16) { px(g, rx - 14, sy2, 14, 1, "#56544c"); px(g, rx + rw, sy2, 14, 1, "#56544c"); }
      px(g, rx, ry, rw, rh, "#3c3c40");
      for (var n = 0; n < rh / 4; n++) px(g, rx + R() * rw, ry + R() * rh, 1 + R() * 2, 2 + R() * 3, R() < 0.5 ? "#44444a" : "#36363a");
      for (var d = ry + 10; d < ry + rh; d += 26) if (R() > 0.3) px(g, rx + rw / 2 - 1, d, 2, 10, "#a8a08a");
    }
    roadH(16, 576, W - 32, 80);
    roadV(720, 16, 80, H - 32);
    for (i = 0; i < 26; i++) {
      var crx = 30 + R() * (W - 60), cry = 580 + R() * 70;
      if (R() < 0.4) { crx = 724 + R() * 70; cry = 30 + R() * (H - 60); }
      for (var cs = 0; cs < 8; cs++) { px(g, crx, cry, 1, 2, "#2a2a2e"); crx += wr(-2, 3); cry += wr(-1, 3); }
    }
    for (i = 0; i < 9; i++) {
      var phx = 40 + R() * (W - 80), phy = 584 + R() * 62;
      if (R() < 0.4) { phx = 726 + R() * 66; phy = 40 + R() * (H - 80); }
      blob(g, phx, phy, 4 + R() * 4, 2 + R() * 2, "#2a2a2e"); blob(g, phx, phy, 2 + R() * 2, 1 + R() * 1, "#54452a");
    }
    for (i = 0; i < 50; i++) {
      var ghx = 30 + R() * (W - 60), ghy = 578 + R() * 74;
      if (R() < 0.4) { ghx = 722 + R() * 74; ghy = 30 + R() * (H - 60); }
      px(g, ghx, ghy, 2, 2, R() < 0.5 ? "#356331" : "#3a6e30");
    }

    // ruined plaza paving
    for (y = 250; y < 540; y += 16) for (x = 520; x < 940; x += 16) {
      if (R() < 0.80) {
        px(g, x, y, 15, 15, R() < 0.7 ? "#8a8578" : "#7d786c");
        if (R() < 0.18) px(g, x + R() * 10, y + R() * 10, 4, 1, "#5a5650");
        if (R() < 0.10) px(g, x + R() * 10, y + R() * 10, 3, 3, "#356331");
      }
    }

    // helipad
    blob(g, 1370, 468, 62, 46, "#c8c8c0"); blob(g, 1370, 468, 56, 41, "#7a7a72");
    px(g, 1348, 448, 7, 40, "#c8c8c0"); px(g, 1385, 448, 7, 40, "#c8c8c0"); px(g, 1355, 464, 30, 7, "#c8c8c0");
    for (i = 0; i < 14; i++) px(g, 1320 + R() * 100, 430 + R() * 75, 3, 1, R() < 0.5 ? "#5a5a52" : "#3a6e30");

    // puddles, flowers, pebbles
    [[480, 760], [1060, 480], [620, 1050], [980, 720], [340, 480]].forEach(function (pd) {
      blob(g, pd[0], pd[1], 10 + R() * 8, 4 + R() * 3, "#3a5a66"); blob(g, pd[0] - 2, pd[1] - 1, 4, 2, "#5a7a86");
    });
    for (i = 0; i < 90; i++) g.drawImage(SPR.flowers[wri(0, 2)], Math.round(40 + R() * (W - 80)), Math.round(40 + R() * (H - 80)));
    for (i = 0; i < 260; i++) px(g, R() * W, R() * H, 1, 1, R() < 0.5 ? "#7a7e82" : "#1d3d1f");

    return { groundCanvas: gr.c };
  }

  root.buildGround = buildGround;
})(typeof window !== "undefined" ? window : this);
