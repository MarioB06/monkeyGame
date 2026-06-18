/* ============================================================================
   WORLDGEN -- buildLayout(seed) returns PURE DATA describing the world:
   spawns, collision solids, water + crossing gates, chest/monkey spots, static
   objects (as data, not sprites), plus visual-only lists the client uses.

   SHARED: the server uses solids/water/waterGates/spawns/chestSpots/monkeySpots;
   the client additionally draws `objects` and paints the ground (groundgen.js).

   Large 3200x2400 map, four regions wired together by roads/paths:
     NW  jungle + chest grove (main spawn)
     NE  expanded city (building grid + alleys, plaza, destroyed blocks) + the
         radio station / tower / helipad (the win goal)
     SW  sunken/flooded area: water (impassable), ruins, walkways, central island
         (reachable only via a ford after building a raft at the workshop)
     SE  dark zone: burnt/dead jungle with the aggressive "dark" monkeys

   Gameplay-critical geometry (water, ford, island, workshop, station, roads,
   spawns) uses FIXED coordinates; only scattered decoration draws from the
   seeded RNG, so the map is identical on the server and every client.
   ========================================================================== */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports)
    module.exports = factory(require("./config.js"), require("./mathutils.js"));
  else
    root.WorldGen = factory(root.CONFIG, root.MathUtils);
})(typeof self !== "undefined" ? self : this, function (CONFIG, M) {
  "use strict";
  var clamp = M.clamp, lerp = M.lerp, dist = M.dist, segDist = M.segDist, mulberry32 = M.mulberry32;

  function rectOf(x, y, w, h) { return { l: x - w / 2, r: x + w / 2, t: y - h, b: y }; }
  function inRect(x, y, r, pad) { pad = pad || 0; return x > r.l - pad && x < r.r + pad && y > r.t - pad && y < r.b + pad; }

  function buildLayout(seed) {
    var W = CONFIG.WORLD_W, H = CONFIG.WORLD_H;
    var L = mulberry32((seed >>> 0) || 1);
    function wr(a, b) { return a + L() * (b - a); }
    function wri(a, b) { return Math.floor(wr(a, b + 1)); }

    var layout = {
      seed: seed,
      playerSpawns: [
        { x: 260, y: 980 },    // NW jungle (main)
        { x: 1640, y: 360 },   // city west edge
        { x: 320, y: 1340 },   // sunken north shore
        { x: 1500, y: 1150 }   // central seam
      ],
      station:  { x: 2820, y: 300, doorX: 2820, doorY: 316 },
      towerTop: { x: 2940, y: 208 },
      helipad:  { x: 2980, y: 560 },
      workshop: { x: 1080, y: 1360 },
      island:   { x: 720, y: 1890 },

      // 10 part chests across all regions (+1 hidden bonus). style themes the sprite.
      chestSpots: [
        { x: 240,  y: 260,  guard: true, style: "wood",   partId: 0 },  // jungle grove NW
        { x: 440,  y: 470,  guard: true, style: "wood",   partId: 1 },  // jungle grove SE
        { x: 860,  y: 1000, guard: true, style: "wood",   partId: 2 },  // west jungle
        { x: 2240, y: 760,  guard: true, style: "metal",  partId: 3 },  // city plaza
        { x: 2560, y: 360,  guard: true, style: "metal",  partId: 4 },  // city destroyed block
        { x: 1860, y: 980,  guard: true, style: "metal",  partId: 5 },  // city alley
        { x: 2100, y: 1800, guard: true, guardType: "dark", style: "dark",   partId: 6 }, // dark zone
        { x: 2750, y: 2050, guard: true, guardType: "dark", style: "dark",   partId: 7 }, // dark zone
        { x: 300,  y: 1360, guard: true, style: "sunken", partId: 8 },  // sunken shore
        { x: 720,  y: 1890, guard: true, guardType: "dark", style: "sunken", partId: 9 }, // ISLAND
        { x: 1380, y: 260,  guard: false, bonus: true, style: "wood" }  // hidden bonus
      ],

      monkeySpots: [
        // city + jungle wanderers
        { x: 1700, y: 420, type: "normal" }, { x: 1980, y: 720, type: "guard" },
        { x: 2320, y: 520, type: "normal" }, { x: 2620, y: 920, type: "guard" },
        { x: 940,  y: 420, type: "normal" }, { x: 620,  y: 720, type: "normal" },
        { x: 1120, y: 320, type: "guard"  }, { x: 1320, y: 940, type: "normal" },
        // dark zone pack
        { x: 1900, y: 1600, type: "dark" }, { x: 2300, y: 1700, type: "dark" },
        { x: 2050, y: 2050, type: "dark" }, { x: 2620, y: 1520, type: "dark" },
        { x: 2860, y: 1820, type: "dark" }, { x: 3000, y: 2100, type: "dark" },
        { x: 1760, y: 2150, type: "dark" }, { x: 2440, y: 1950, type: "dark" },
        // island guardians
        { x: 660, y: 1950, type: "dark" }, { x: 800, y: 1850, type: "dark" },
        // station boss
        { x: 2820, y: 380, type: "alpha" }
      ],

      // roads (painted by groundgen; also used to keep trees off corridors)
      roads: [
        { dir: "h", x: 120,  y: 1180, w: 3000, h: 80 },  // main cross-map artery
        { dir: "h", x: 1500, y: 600,  w: 1660, h: 70 },  // city main street
        { dir: "v", x: 2060, y: 150,  w: 70,   h: 1050 },// city avenue
        { dir: "v", x: 2740, y: 150,  w: 70,   h: 1050 },// city avenue
        { dir: "v", x: 2380, y: 1180, w: 70,   h: 1140 },// city -> dark zone
        { dir: "v", x: 760,  y: 1180, w: 70,   h: 300 }  // artery -> sunken shore
      ],
      plaza: { x: 2240, y: 860, r: 150 },
      cityRect: { l: 1500, t: 120, r: 3160, b: 1160 },
      darkZones: [{ l: 1620, t: 1320, r: 3160, b: 2340 }],

      paths: [
        [[260, 980], [520, 1060], [760, 1180]],
        [[760, 1460], [900, 1400], [1080, 1380]],
        [[1080, 1380], [1260, 1240], [1380, 1180]],
        [[240, 320], [380, 420], [560, 520], [860, 1000]],
        [[1380, 260], [1500, 360]]
      ],

      // sunken area: impassable water + the single raft-gated crossing
      water: [
        { l: 220, r: 690,  t: 1450, b: 1770 },   // north-west of island (flanks walkway)
        { l: 750, r: 1300, t: 1450, b: 1770 },   // north-east of island
        { l: 220, r: 600,  t: 1770, b: 2010 },   // west of island
        { l: 840, r: 1300, t: 1770, b: 2010 },   // east of island
        { l: 220, r: 1300, t: 2010, b: 2300 }    // south of island
      ],
      waterGates: [{ l: 690, r: 750, t: 1700, b: 1805 }],  // the ford (needs raft)

      objects: [], solids: [],
      lamps: [], fires: [], tufts: [],
      hideTrees: [[470, 250], [900, 700], [300, 760], [1180, 560], [1300, 1020], [820, 1250], [1450, 820]]
        .map(function (p) { return { x: p[0], y: p[1] }; })
    };
    layout.playerSpawn = layout.playerSpawns[0];

    function addObj(o) { layout.objects.push(o); if (o.solid) layout.solids.push(rectOf(o.x, o.y, o.collW, o.collH)); return o; }

    /* ---- world border solids ---- */
    layout.solids.push({ l: -40, t: -40, r: W + 40, b: 16 });
    layout.solids.push({ l: -40, t: H - 16, r: W + 40, b: H + 40 });
    layout.solids.push({ l: -40, t: 0, r: 16, b: H });
    layout.solids.push({ l: W - 16, t: 0, r: W + 40, b: H });

    /* ---- keep-clear regions (no scattered trees) ---- */
    var clearRects = [
      layout.cityRect,
      { l: 200, t: 1430, r: 1320, b: 2320 },           // lake bbox
      { l: 600, t: 1760, r: 840, b: 2020 },            // island
      { l: 2740, t: 120, r: 3160, b: 430 },            // station
      { l: 2900, t: 470, r: 3070, b: 650 },            // helipad
      { l: 2070, t: 690, r: 2410, b: 1030 },           // plaza
      { l: 1000, t: 1290, r: 1160, b: 1430 }           // workshop
    ];
    layout.darkZones.forEach(function (d) { clearRects.push(d); });
    layout.playerSpawns.forEach(function (s) { clearRects.push({ l: s.x - 70, t: s.y - 70, r: s.x + 70, b: s.y + 70 }); });
    layout.roads.forEach(function (r) {
      if (r.dir === "h") clearRects.push({ l: r.x - 16, t: r.y - 30, r: r.x + r.w + 16, b: r.y + r.h + 30 });
      else clearRects.push({ l: r.x - 30, t: r.y - 16, r: r.x + r.w + 30, b: r.y + r.h + 16 });
    });

    function nearPath(x, y) {
      for (var pi = 0; pi < layout.paths.length; pi++) {
        var p = layout.paths[pi];
        for (var s = 0; s < p.length - 1; s++)
          if (segDist(x, y, p[s][0], p[s][1], p[s + 1][0], p[s + 1][1]) < 26) return true;
      }
      return false;
    }
    function inWater(x, y, pad) {
      for (var i = 0; i < layout.water.length; i++) if (inRect(x, y, layout.water[i], pad || 0)) return true;
      return false;
    }
    function blockedForTree(x, y, list, minDist) {
      if (dist(x, y, 260, 980) < 150) return true;          // start camp
      if (dist(x, y, layout.helipad.x, layout.helipad.y) < 110) return true;
      if (inWater(x, y, 30)) return true;
      var ci;
      for (ci = 0; ci < layout.chestSpots.length; ci++) if (dist(x, y, layout.chestSpots[ci].x, layout.chestSpots[ci].y) < 48) return true;
      for (ci = 0; ci < layout.monkeySpots.length; ci++) if (dist(x, y, layout.monkeySpots[ci].x, layout.monkeySpots[ci].y) < 40) return true;
      for (ci = 0; ci < clearRects.length; ci++) if (inRect(x, y, clearRects[ci])) return true;
      if (nearPath(x, y)) return true;
      for (ci = 0; ci < list.length; ci++) if (dist(x, y, list[ci][0], list[ci][1]) < minDist) return true;
      return false;
    }

    /* ---- CITY: building grid with alleys + destroyed blocks ---- */
    var cr = layout.cityRect, walls = [];
    function nearRoad(x, y, pad) {
      for (var i = 0; i < layout.roads.length; i++) {
        var r = layout.roads[i];
        if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return true;
      }
      return false;
    }
    for (var gy = cr.t + 80; gy < cr.b - 40; gy += 230) {
      for (var gx = cr.l + 90; gx < cr.r - 80; gx += 210) {
        var bx = gx + wr(-12, 12), by = gy + wr(-10, 10);
        if (nearRoad(bx, by, 46)) continue;                       // leave road corridors open
        if (dist(bx, by, layout.plaza.x, layout.plaza.y) < 180) continue;
        if (dist(bx, by, layout.station.x, layout.station.y) < 150) continue;
        if (dist(bx, by, layout.helipad.x, layout.helipad.y) < 130) continue;
        var roll = L();
        if (roll < 0.16) continue;                                // alley / empty lot
        if (roll < 0.30) {                                        // destroyed block -> rubble cluster
          for (var rr2 = 0; rr2 < 4; rr2++) addObj({ kind: "rubble", variant: wri(0, 2), x: bx + wr(-40, 40), y: by + wr(-30, 30), collW: 16, collH: 8, solid: true });
          continue;
        }
        var bw = wri(130, 180), bh = wri(96, 150);
        if (bx - bw / 2 < cr.l + 10 || bx + bw / 2 > cr.r - 10) continue;
        addObj({ kind: "building", x: bx, y: by + bh * 0.5, w: bw, h: bh, bseed: 100 + walls.length * 37, collW: bw, collH: bh - 26, solid: true });
        walls.push(1);
      }
    }
    // station + tower + helipad furniture
    addObj({ kind: "station", x: layout.station.x, y: layout.station.y, collW: 130, collH: 46, solid: true });
    addObj({ kind: "tower", x: 2930, y: 300, collW: 18, collH: 12, solid: true });
    // plaza ruins
    addObj({ kind: "fountain", x: layout.plaza.x, y: layout.plaza.y, collW: 46, collH: 16, solid: true });
    [[-70, -60], [70, -60], [-70, 70], [70, 70]].forEach(function (o) { addObj({ kind: "column", x: layout.plaza.x + o[0], y: layout.plaza.y + o[1], collW: 10, collH: 7, solid: true }); });
    // cars + lamps + signs along roads
    [[1680, 560], [2300, 612], [2900, 560], [1560, 1212], [2700, 1212], [820, 1212], [2380, 1500]].forEach(function (c, i) { addObj({ kind: i % 2 ? "carV" : "carH", variant: i % 3, x: c[0], y: c[1], collW: i % 2 ? 18 : 38, collH: i % 2 ? 22 : 12, solid: true }); });
    var lampPts = [[1560, 596], [1900, 596], [2300, 596], [2640, 596], [3000, 596], [400, 1176], [900, 1176], [1500, 1176], [2100, 1176], [2700, 1176], [2376, 1500], [2376, 1900]];
    lampPts.forEach(function (p, i) { var broken = i % 4 === 0; addObj({ kind: "lamp", broken: broken, x: p[0], y: p[1], collW: 6, collH: 5, solid: true }); if (!broken) layout.lamps.push({ x: p[0] + 5, y: p[1] - 29 }); });
    [[2240, 700], [1620, 760], [2560, 980]].forEach(function (p) { addObj({ kind: "sign", x: p[0], y: p[1], collW: 16, collH: 5, solid: true }); });

    /* ---- JUNGLE camp decorations (NW) ---- */
    addObj({ kind: "fire", x: 240, y: 1005, solid: false }); layout.fires.push({ x: 240, y: 1000 });
    addObj({ kind: "hut", x: 360, y: 880, collW: 38, collH: 16, solid: true });
    addObj({ kind: "totem", x: 180, y: 900, collW: 10, collH: 8, solid: true });
    addObj({ kind: "sign", x: 520, y: 1040, collW: 16, collH: 5, solid: true });
    [[640, 320], [380, 600], [1000, 760]].forEach(function (p) { addObj({ kind: "rock", x: p[0], y: p[1], collW: 11, collH: 6, solid: true }); });

    /* ---- SUNKEN area: workshop, docks, ruins, camp fire ---- */
    addObj({ kind: "workshop", x: layout.workshop.x, y: layout.workshop.y, collW: 34, collH: 22, solid: true });
    addObj({ kind: "fire", x: layout.workshop.x - 30, y: layout.workshop.y + 14, solid: false }); layout.fires.push({ x: layout.workshop.x - 30, y: layout.workshop.y + 10 });
    [[690, 1470], [750, 1470], [690, 1690], [750, 1690]].forEach(function (p) { addObj({ kind: "dock", x: p[0], y: p[1], collW: 4, collH: 6, solid: false }); });
    [[470, 1600], [1060, 1640], [950, 2120], [400, 2160], [1180, 1900], [640, 1620]].forEach(function (p, i) { addObj({ kind: "sunkenruin", variant: i % 2, x: p[0], y: p[1], collW: 18, collH: 10, solid: true }); });
    // a couple of palms on the island for flavour
    addObj({ kind: "palm", variant: 0, x: 680, y: 1840, collW: 8, collH: 6, solid: true });

    /* ---- DARK ZONE: dead trees ---- */
    var dz = layout.darkZones[0];
    for (var dt = 0; dt < 26; dt++) {
      var dx = wr(dz.l + 30, dz.r - 30), dy = wr(dz.t + 40, dz.b - 30);
      if (nearRoad(dx, dy, 30)) continue;
      var okd = true, ck;
      for (ck = 0; ck < layout.chestSpots.length; ck++) if (dist(dx, dy, layout.chestSpots[ck].x, layout.chestSpots[ck].y) < 44) okd = false;
      if (okd) addObj({ kind: "deadtree", variant: wri(0, 1), x: dx, y: dy, collW: 9, collH: 7, solid: true });
    }

    /* ---- big climbable hide trees (fixed coords) ---- */
    layout.hideTrees.forEach(function (h) { addObj({ kind: "bigtree", variant: 0, x: h.x, y: h.y, collW: 12, collH: 9, solid: true }); });

    /* ---- scattered jungle: border ring + groves (seeded) ---- */
    var treePts = [], i, x, y;
    for (x = 30; x < W - 20; x += 46) { treePts.push([x + wr(-10, 10), 34 + wr(-6, 14)]); treePts.push([x + wr(-10, 10), H - 14 + wr(-12, 2)]); }
    for (y = 70; y < H - 40; y += 48) { treePts.push([26 + wr(-6, 12), y + wr(-10, 10)]); treePts.push([W - 26 + wr(-12, 6), y + wr(-10, 10)]); }
    // tree ring sheltering the hidden bonus chest
    [[1320, 200], [1440, 200], [1300, 320], [1460, 320], [1380, 340]].forEach(function (p) { treePts.push(p); });
    var scattered = [];
    for (i = 0; i < 1100 && scattered.length < 200; i++) {
      var sx = 40 + L() * (W - 80), sy = 60 + L() * (H - 120);
      if (blockedForTree(sx, sy, scattered, 50)) continue;
      scattered.push([sx, sy]);
    }
    treePts = treePts.concat(scattered);
    treePts.forEach(function (tp, ti) {
      if (ti % 7 === 3) addObj({ kind: "palm", variant: 0, x: tp[0], y: tp[1], collW: 8, collH: 6, solid: true });
      else addObj({ kind: "tree", variant: ti % 4, x: tp[0], y: tp[1], collW: 10, collH: 7, solid: true });
    });

    /* ---- bushes (walk-through) + grass tufts (visual) ---- */
    for (i = 0; i < 600 && layout.tufts.length < 150; i++) {
      var ux = 40 + L() * (W - 80), uy = 40 + L() * (H - 80);
      if (nearPath(ux, uy) || inWater(ux, uy, 0)) continue;
      layout.tufts.push({ x: ux, y: uy, phase: L() * 6.28 });
    }
    for (i = 0; i < 360; i++) {
      var bx2 = 50 + L() * (W - 100), by3 = 70 + L() * (H - 140);
      if (blockedForTree(bx2, by3, [], 0)) continue;
      addObj({ kind: "bush", variant: wri(0, 1), x: bx2, y: by3, solid: false });
      if (layout.objects.length > 1100) break;
    }

    return layout;
  }

  return { buildLayout: buildLayout, rectOf: rectOf };
});
