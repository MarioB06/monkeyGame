/* ============================================================================
   MATHUTILS -- math helpers, RNG, and collision primitives. SHARED.
   - clamp/lerp/dist/angTo/segDist: pure geometry
   - rand/randi/pick/chance: NON-seeded gameplay RNG (server-authoritative;
     never re-run on online clients)
   - mulberry32: seeded PRNG for deterministic world generation
   - resolveCircle/pointBlocked: collision used by the sim AND by client-side
     movement prediction (same solids on both sides)
   ========================================================================== */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.MathUtils = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t)  { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
  function angTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
  function rand(a, b)  { return a + Math.random() * (b - a); }
  function randi(a, b) { return Math.floor(rand(a, b + 1)); }
  function pick(arr)   { return arr[Math.floor(Math.random() * arr.length)]; }
  function chance(p)   { return Math.random() < p; }

  // Deterministic RNG (mulberry32). Used for world generation so a given seed
  // always produces the same map on every machine (server + all clients).
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // distance from a point to a line segment
  function segDist(px_, py_, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var l2 = dx * dx + dy * dy;
    if (l2 === 0) return dist(px_, py_, x1, y1);
    var t = clamp(((px_ - x1) * dx + (py_ - y1) * dy) / l2, 0, 1);
    return dist(px_, py_, x1 + t * dx, y1 + t * dy);
  }

  // push a circle (feet) out of all solid rects
  function resolveCircle(x, y, r, solids) {
    for (var i = 0; i < solids.length; i++) {
      var s = solids[i];
      var cx = clamp(x, s.l, s.r), cy = clamp(y, s.t, s.b);
      var dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        if (d2 === 0) {     // centre inside the box: exit through nearest face
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

  return {
    clamp: clamp, lerp: lerp, dist: dist, angTo: angTo,
    rand: rand, randi: randi, pick: pick, chance: chance,
    mulberry32: mulberry32, segDist: segDist,
    resolveCircle: resolveCircle, pointBlocked: pointBlocked
  };
});
