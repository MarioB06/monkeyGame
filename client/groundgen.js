/* ============================================================================
   GROUNDGEN -- paints the static ground layer into one offscreen canvas.
   BROWSER ONLY. Exposes window.buildGround(layout) -> { groundCanvas }.

   Uses its OWN seeded RNG stream (seed ^ 0x9E3779B9) so the ground texture is
   deterministic but decoupled from worldgen's layout stream. Reads layout
   geometry (paths, roads, plaza, cityRect, darkZones, water, waterGates,
   island, workshop, helipad) so terrain matches collision/objects exactly.
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
    var AREA = (W * H) / (1600 * 1200);          // scale detail counts vs the original map

    function inRect(px2, py2, r, pad) { pad = pad || 0; return px2 > r.l - pad && px2 < r.r + pad && py2 > r.t - pad && py2 < r.b + pad; }
    function inDark(px2, py2) { for (var d = 0; d < layout.darkZones.length; d++) if (inRect(px2, py2, layout.darkZones[d])) return true; return false; }
    function inWater(px2, py2) { for (var d = 0; d < layout.water.length; d++) if (inRect(px2, py2, layout.water[d])) return true; return false; }

    /* ---- base jungle floor + noise ---- */
    px(g, 0, 0, W, H, "#2e5a28");
    for (i = 0; i < 2600 * AREA; i++) {
      var c = R();
      px(g, R() * W, R() * H, 2 + R() * 4, 2 + R() * 3, c < 0.4 ? "#356331" : (c < 0.8 ? "#27511f" : "#3a6e30"));
    }
    for (i = 0; i < 220 * AREA; i++) px(g, R() * W, R() * H, 2, 2, R() < 0.5 ? "#54452a" : "#6a5a30");

    /* ---- darker jungle border band ---- */
    for (i = 0; i < 700 * AREA; i++) {
      var bx = R() * W, by = R() * H;
      if (bx > 110 && bx < W - 110 && by > 110 && by < H - 110) continue;
      px(g, bx, by, 4 + R() * 6, 3 + R() * 4, R() < 0.5 ? "#1d3d1f" : "#234c22");
    }

    /* ---- dark zone: burnt ash ground ---- */
    layout.darkZones.forEach(function (d) {
      for (var k = 0; k < (d.r - d.l) * (d.b - d.t) / 50; k++) {
        var ax = wr(d.l, d.r), ay = wr(d.t, d.b), q = R();
        px(g, ax, ay, 3 + R() * 6, 2 + R() * 4, q < 0.45 ? "#241e1c" : (q < 0.8 ? "#1a1614" : "#33291f"));
      }
      for (k = 0; k < (d.r - d.l) / 12; k++) px(g, wr(d.l, d.r), wr(d.t, d.b), 1, 1, R() < 0.5 ? "#0e0a0a" : "#3a2a1a");
    });

    /* ---- dirt paths ---- */
    layout.paths.forEach(function (path) {
      for (var s = 0; s < path.length - 1; s++) {
        var ax = path[s][0], ay = path[s][1], bx2 = path[s + 1][0], by2 = path[s + 1][1];
        var steps = Math.ceil(dist(ax, ay, bx2, by2) / 5);
        for (var st = 0; st <= steps; st++) {
          var t = st / steps, cx2 = lerp(ax, bx2, t) + wr(-3, 3), cy2 = lerp(ay, by2, t) + wr(-3, 3);
          blob(g, cx2, cy2, 7 + R() * 3, 4 + R() * 2, R() < 0.7 ? "#6a5430" : "#5e4a2a");
        }
      }
    });

    /* ---- city concrete (alleys/lots between buildings) ---- */
    var cr = layout.cityRect;
    for (i = 0; i < (cr.r - cr.l) * (cr.b - cr.t) / 26; i++) {
      var px3 = wr(cr.l, cr.r), py3 = wr(cr.t, cr.b), q2 = R();
      px(g, px3, py3, 4 + R() * 6, 3 + R() * 5, q2 < 0.5 ? "#6a675e" : (q2 < 0.82 ? "#56544c" : "#7a786e"));
    }
    for (i = 0; i < (cr.r - cr.l) / 8; i++) px(g, wr(cr.l, cr.r), wr(cr.t, cr.b), 1 + R() * 3, 1, R() < 0.5 ? "#46443e" : "#356331"); // cracks/weeds

    /* ---- roads ---- */
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
    layout.roads.forEach(function (r) { if (r.dir === "h") roadH(r.x, r.y, r.w, r.h); else roadV(r.x, r.y, r.w, r.h); });
    // a few potholes + grass through the asphalt
    for (i = 0; i < 60 * AREA; i++) {
      var phx = wr(0, W), phy = wr(0, H);
      var onRoad = layout.roads.some(function (r) { return phx > r.x - 14 && phx < r.x + r.w + 14 && phy > r.y - 14 && phy < r.y + r.h + 14; });
      if (!onRoad) continue;
      if (R() < 0.5) { blob(g, phx, phy, 3 + R() * 3, 2, "#2a2a2e"); } else px(g, phx, phy, 2, 2, "#356331");
    }

    /* ---- plaza paving ---- */
    var pz = layout.plaza;
    for (y = pz.y - pz.r; y < pz.y + pz.r; y += 16) for (x = pz.x - pz.r; x < pz.x + pz.r; x += 16) {
      if (dist(x, y, pz.x, pz.y) > pz.r) continue;
      if (R() < 0.82) { px(g, x, y, 15, 15, R() < 0.7 ? "#8a8578" : "#7d786c"); if (R() < 0.16) px(g, x + R() * 10, y + R() * 10, 4, 1, "#5a5650"); }
    }

    /* ---- trampled clearings: start camp + workshop ground ---- */
    blob(g, 260, 990, 120, 80, "#3f7233"); blob(g, 240, 1005, 26, 16, "#6a5430");
    blob(g, layout.workshop.x, layout.workshop.y + 6, 60, 36, "#6a5e3a");

    /* ---- WATER + sunken ruins + walkway + island ---- */
    layout.water.forEach(function (r) {
      px(g, r.l, r.t, r.r - r.l, r.b - r.t, "#15333c");
      for (var k = 0; k < (r.r - r.l) * (r.b - r.t) / 120; k++) {
        var wx = wr(r.l, r.r), wy = wr(r.t, r.b), q = R();
        px(g, wx, wy, 3 + R() * 5, 1, q < 0.6 ? "#1d4651" : (q < 0.9 ? "#2a5a66" : "#3f7a86"));
      }
    });
    // the ford: shallow stepping water (reads as crossable)
    layout.waterGates.forEach(function (r) {
      px(g, r.l, r.t, r.r - r.l, r.b - r.t, "#27545c");
      for (var k = r.t; k < r.b; k += 8) { px(g, r.l + 1, k, r.r - r.l - 2, 3, "#5a7a72"); px(g, r.l + 3, k + 1, 2, 1, "#8a9a8a"); }  // stepping stones
    });
    // stone walkway/causeway down to the ford (the land strip between the two north water rects)
    px(g, 690, 1450, 60, 250, "#8a8a82");
    for (i = 0; i < 60; i++) px(g, 690 + R() * 60, 1450 + R() * 250, 2 + R() * 3, 1, R() < 0.5 ? "#6a6a62" : "#9a9a92");
    // island land
    var isl = layout.island;
    blob(g, isl.x, isl.y, 116, 104, "#3f7233");
    blob(g, isl.x, isl.y, 122, 110, "#caa86a"); blob(g, isl.x, isl.y, 116, 104, "#3f7233"); // sandy rim then grass
    for (i = 0; i < 120; i++) { var gx = isl.x + wr(-100, 100), gy = isl.y + wr(-90, 90); if (dist(gx, gy, isl.x, isl.y) < 104) px(g, gx, gy, 2, 2, R() < 0.5 ? "#356331" : "#4a8a3a"); }

    /* ---- helipad ---- */
    var hp = layout.helipad;
    blob(g, hp.x, hp.y, 62, 46, "#c8c8c0"); blob(g, hp.x, hp.y, 56, 41, "#7a7a72");
    px(g, hp.x - 22, hp.y - 20, 7, 40, "#c8c8c0"); px(g, hp.x + 15, hp.y - 20, 7, 40, "#c8c8c0"); px(g, hp.x - 15, hp.y - 4, 30, 7, "#c8c8c0");

    /* ---- puddles, flowers, pebbles (skip water/dark/city) ---- */
    for (i = 0; i < 14 * AREA; i++) { var pdx = wr(0, W), pdy = wr(0, H); if (inWater(pdx, pdy) || inDark(pdx, pdy)) continue; blob(g, pdx, pdy, 8 + R() * 8, 4 + R() * 3, "#3a5a66"); blob(g, pdx - 2, pdy - 1, 4, 2, "#5a7a86"); }
    for (i = 0; i < 90 * AREA; i++) { var fx = wr(40, W - 40), fy = wr(40, H - 40); if (inWater(fx, fy) || inDark(fx, fy) || inRect(fx, fy, cr)) continue; g.drawImage(SPR.flowers[wri(0, 2)], Math.round(fx), Math.round(fy)); }
    for (i = 0; i < 260 * AREA; i++) { var qx = R() * W, qy = R() * H; if (inWater(qx, qy)) continue; px(g, qx, qy, 1, 1, R() < 0.5 ? "#7a7e82" : "#1d3d1f"); }

    return { groundCanvas: gr.c };
  }

  root.buildGround = buildGround;
})(typeof window !== "undefined" ? window : this);
