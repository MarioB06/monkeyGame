/* ============================================================================
   WORLDGEN -- buildLayout(seed) returns PURE DATA describing the world:
   spawns, collision solids, chest/monkey spots, static objects (as data, not
   sprites), plus visual-only lists (tufts/lamps/fires) the client uses.

   SHARED: the server uses solids/spawns/chestSpots/monkeySpots; the client
   additionally draws `objects` and paints the ground (see client/groundgen.js).

   IMPORTANT (determinism): layout uses its OWN mulberry32 stream so it stays
   identical regardless of the separate ground-painting stream on the client.
   Same seed -> same collision + same object positions on every machine.
   ========================================================================== */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports)
    module.exports = factory(require("./config.js"), require("./mathutils.js"));
  else
    root.WorldGen = factory(root.CONFIG, root.MathUtils);
})(typeof self !== "undefined" ? self : this, function (CONFIG, M) {
  "use strict";
  var clamp = M.clamp, lerp = M.lerp, dist = M.dist, segDist = M.segDist,
      mulberry32 = M.mulberry32;

  // collision rect for a feet-baseline object
  function rectOf(x, y, w, h) { return { l: x - w / 2, r: x + w / 2, t: y - h, b: y }; }

  function buildLayout(seed) {
    var W = CONFIG.WORLD_W, H = CONFIG.WORLD_H;
    var L = mulberry32((seed >>> 0) || 1);           // layout RNG stream
    function wr(a, b) { return a + L() * (b - a); }
    function wri(a, b) { return Math.floor(wr(a, b + 1)); }

    var layout = {
      seed: seed,
      // four spread spawn points (SP uses index 0)
      playerSpawns: [
        { x: 220,  y: 1000 },   // start camp (SW)
        { x: 1380, y: 600  },   // eastern ruins (E)
        { x: 780,  y: 1080 },   // open south (S)
        { x: 120,  y: 600  }    // west road (W)
      ],
      station:  { x: 1320, y: 240, doorX: 1320, doorY: 256 },
      towerTop: { x: 1430, y: 148 },
      helipad:  { x: 1370, y: 468 },
      chestSpots: [
        { x: 180, y: 210,  guard: true,  partId: 0 },   // chest grove NW
        { x: 350, y: 330,  guard: true,  partId: 1 },   // chest grove SE
        { x: 830, y: 470,  guard: true,  partId: 2 },   // ruined plaza
        { x: 1300, y: 1010, guard: true, partId: 3 },   // monkey camp
        { x: 430, y: 724,  guard: true,  partId: 4 },   // overgrown street (west)
        { x: 1480, y: 660, guard: true,  partId: 5 },   // eastern ruins
        { x: 1532, y: 1116, guard: false, bonus: true } // hidden bonus chest
      ],
      monkeySpots: [
        { x: 520, y: 540, type: "normal" }, { x: 650, y: 700, type: "normal" },
        { x: 900, y: 530, type: "normal" }, { x: 660, y: 380, type: "normal" },
        { x: 860, y: 300, type: "normal" }, { x: 1150, y: 850, type: "normal" },
        { x: 1350, y: 900, type: "normal" }, { x: 1200, y: 1020, type: "normal" },
        { x: 1420, y: 1060, type: "normal" }, { x: 140, y: 360, type: "normal" },
        { x: 1500, y: 770, type: "normal" },
        { x: 1320, y: 300, type: "alpha" }              // boss guards the station
      ],
      paths: [
        [[220, 950], [330, 820], [420, 700], [440, 616]],
        [[560, 380], [470, 350], [420, 330]],
        [[1280, 860], [1190, 740], [1120, 668]],
        [[1320, 256], [1350, 380], [1370, 420]],
        [[1255, 250], [1100, 330], [1010, 460], [940, 576]],
        [[1370, 540], [1340, 700], [1300, 800]],
        [[250, 400], [250, 520], [300, 564]]
      ],
      objects: [],     // {kind, x, y, variant, w, h, bseed, broken, solid}
      solids: [],      // collision rects (walls + solid objects; NO chests)
      lamps: [],       // glow positions (visual)
      fires: [],       // fire positions (visual + particle anchor)
      tufts: []        // animated grass {x,y,phase} (visual)
    };
    layout.playerSpawn = layout.playerSpawns[0];

    function addObj(o) {
      layout.objects.push(o);
      if (o.solid) layout.solids.push(rectOf(o.x, o.y, o.collW, o.collH));
      return o;
    }

    /* ---- world border solids (the jungle wall) ---- */
    layout.solids.push({ l: -40, t: -40, r: W + 40, b: 16 });
    layout.solids.push({ l: -40, t: H - 16, r: W + 40, b: H + 40 });
    layout.solids.push({ l: -40, t: 0, r: 16, b: H });
    layout.solids.push({ l: W - 16, t: 0, r: W + 40, b: H });

    /* ---- ruined buildings ---- */
    var builds = [
      [250, 790, 170, 110], [560, 180, 170, 120], [1010, 190, 140, 100],
      [480, 890, 160, 120], [980, 905, 140, 110], [130, 520, 120, 90]
    ];
    builds.forEach(function (b, bi) {
      addObj({ kind: "building", x: b[0], y: b[1], w: b[2], h: b[3],
               bseed: 100 + bi * 37, collW: b[2], collH: b[3] - 26, solid: true });
    });

    /* ---- radio station + tower ---- */
    addObj({ kind: "station", x: layout.station.x, y: layout.station.y, collW: 130, collH: 46, solid: true });
    addObj({ kind: "tower", x: 1430, y: 240, collW: 18, collH: 12, solid: true });

    /* ---- crashed cars ---- */
    addObj({ kind: "carH", variant: 0, x: 480, y: 640, collW: 38, collH: 12, solid: true });
    addObj({ kind: "carH", variant: 1, x: 940, y: 604, collW: 38, collH: 12, solid: true });
    addObj({ kind: "carH", variant: 2, x: 1240, y: 632, collW: 38, collH: 12, solid: true });
    addObj({ kind: "carV", variant: 0, x: 760, y: 380, collW: 18, collH: 22, solid: true });
    addObj({ kind: "carV", variant: 1, x: 310, y: 1052, collW: 18, collH: 22, solid: true });

    /* ---- street lamps ---- */
    var lampDefs = [
      [240, 572, 0], [600, 572, 1], [960, 572, 0], [1320, 572, 0],
      [420, 672, 0], [1140, 672, 1], [1480, 672, 0],
      [706, 300, 0], [814, 520, 0], [706, 900, 0], [814, 1060, 1]
    ];
    lampDefs.forEach(function (Ld) {
      addObj({ kind: "lamp", broken: !!Ld[2], x: Ld[0], y: Ld[1], collW: 6, collH: 5, solid: true });
      if (!Ld[2]) layout.lamps.push({ x: Ld[0] + 5, y: Ld[1] - 29 });
    });

    /* ---- monkey camp + player camp decorations ---- */
    addObj({ kind: "hut", x: 1180, y: 890, collW: 38, collH: 16, solid: true });
    addObj({ kind: "hut", x: 1340, y: 968, collW: 38, collH: 16, solid: true });
    addObj({ kind: "hut", x: 1230, y: 1070, collW: 38, collH: 16, solid: true });
    addObj({ kind: "totem", x: 1410, y: 870, collW: 10, collH: 8, solid: true });
    addObj({ kind: "fire", x: 1280, y: 965, solid: false });
    layout.fires.push({ x: 1280, y: 960 });
    addObj({ kind: "fire", x: 190, y: 1015, solid: false });
    layout.fires.push({ x: 190, y: 1010 });
    addObj({ kind: "sign", x: 310, y: 930, collW: 16, collH: 5, solid: true });
    addObj({ kind: "sign", x: 850, y: 692, collW: 16, collH: 5, solid: true });

    /* ---- plaza ruins ---- */
    addObj({ kind: "fountain", x: 740, y: 430, collW: 46, collH: 16, solid: true });
    [[570, 300], [910, 300], [570, 545], [910, 545]].forEach(function (cp) {
      addObj({ kind: "column", x: cp[0], y: cp[1], collW: 10, collH: 7, solid: true });
    });
    [[640, 485], [845, 330], [1090, 640], [380, 560], [1180, 380]].forEach(function (rp, ri) {
      addObj({ kind: "rubble", variant: ri % 3, x: rp[0], y: rp[1], collW: 16, collH: 8, solid: true });
    });
    [[520, 470], [880, 510], [1460, 540], [240, 660], [1090, 240]].forEach(function (rp) {
      addObj({ kind: "rock", x: rp[0], y: rp[1], collW: 11, collH: 6, solid: true });
    });

    /* ---- trees (deterministic scatter via layout RNG) ---- */
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
    // keep spawns clear of trees too
    clearRects.push({ l: 1340, t: 560, r: 1420, b: 640 });   // E spawn
    clearRects.push({ l: 740, t: 1040, r: 820, b: 1120 });   // S spawn
    clearRects.push({ l: 80, t: 560, r: 160, b: 640 });      // W spawn

    function nearPath(tx2, ty2) {
      for (var pi = 0; pi < layout.paths.length; pi++) {
        var p2 = layout.paths[pi];
        for (var s2 = 0; s2 < p2.length - 1; s2++)
          if (segDist(tx2, ty2, p2[s2][0], p2[s2][1], p2[s2 + 1][0], p2[s2 + 1][1]) < 28) return true;
      }
      return false;
    }
    function treeBlocked(tx2, ty2, treeList, minDist) {
      if (dist(tx2, ty2, 220, 990) < 160) return true;            // start camp
      if (dist(tx2, ty2, 1370, 468) < 105) return true;           // helipad
      var ci;
      for (ci = 0; ci < layout.chestSpots.length; ci++)
        if (dist(tx2, ty2, layout.chestSpots[ci].x, layout.chestSpots[ci].y) < 46) return true;
      for (ci = 0; ci < layout.monkeySpots.length; ci++)
        if (dist(tx2, ty2, layout.monkeySpots[ci].x, layout.monkeySpots[ci].y) < 40) return true;
      for (ci = 0; ci < clearRects.length; ci++) {
        var r2 = clearRects[ci];
        if (tx2 > r2.l && tx2 < r2.r && ty2 > r2.t && ty2 < r2.b) return true;
      }
      if (nearPath(tx2, ty2)) return true;
      for (ci = 0; ci < treeList.length; ci++)
        if (dist(tx2, ty2, treeList[ci][0], treeList[ci][1]) < minDist) return true;
      return false;
    }

    var treePts = [], x, y, i;
    // dense border ring (visual jungle wall behind the real border solid)
    for (x = 30; x < W - 20; x += 44) {
      treePts.push([x + wr(-10, 10), 36 + wr(-6, 14)]);
      treePts.push([x + wr(-10, 10), H - 14 + wr(-12, 2)]);
    }
    for (y = 70; y < H - 40; y += 46) {
      treePts.push([28 + wr(-6, 12), y + wr(-10, 10)]);
      treePts.push([W - 28 + wr(-12, 6), y + wr(-10, 10)]);
    }
    // hidden chest nook: ring of trees with a small western gap
    [[1480, 1080], [1530, 1070], [1568, 1100], [1568, 1150], [1500, 1160]].forEach(function (tp) {
      treePts.push(tp);
    });
    var scattered = [];
    for (i = 0; i < 240 && scattered.length < 46; i++) {
      var sx = 60 + L() * (W - 120), sy = 80 + L() * (H - 140);
      if (treeBlocked(sx, sy, scattered, 52)) continue;
      scattered.push([sx, sy]);
    }
    for (i = 0; i < 120 && scattered.length < 60; i++) {
      var gx = 90 + L() * 330, gy = 110 + L() * 290;
      if (treeBlocked(gx, gy, scattered, 44)) continue;
      scattered.push([gx, gy]);
    }
    treePts = treePts.concat(scattered);
    treePts.forEach(function (tp, ti) {
      if (ti % 7 === 3) addObj({ kind: "palm", variant: 0, x: tp[0], y: tp[1], collW: 8, collH: 6, solid: true });
      else addObj({ kind: "tree", variant: ti % 4, x: tp[0], y: tp[1], collW: 10, collH: 7, solid: true });
    });

    /* ---- bushes (walk-through) + grass tufts (visual) ---- */
    for (i = 0; i < 250 && layout.tufts.length < 46; i++) {
      var ux = 50 + L() * (W - 100), uy = 50 + L() * (H - 100);
      if (nearPath(ux, uy)) continue;
      layout.tufts.push({ x: ux, y: uy, phase: L() * 6.28 });
    }
    for (i = 0; i < 90; i++) {
      var bx2 = 50 + L() * (W - 100), by3 = 70 + L() * (H - 140);
      if (treeBlocked(bx2, by3, [], 0)) continue;
      addObj({ kind: "bush", variant: wri(0, 1), x: bx2, y: by3, solid: false });
      if (layout.objects.length > 460) break;
    }

    return layout;
  }

  return { buildLayout: buildLayout, rectOf: rectOf };
});
