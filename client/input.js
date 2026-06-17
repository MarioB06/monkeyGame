/* ============================================================================
   INPUT -- keyboard + mouse capture. BROWSER ONLY. Exposes window.Input.
   Produces an InputState {move:{x,y}, aim, aimDist, flags} for the sim. Aim is
   resolved on THIS client from mouse + its own camera, so the sim never needs
   to know about cameras or cursors (kills the old aimWorld coupling).
   ========================================================================== */
(function (root) {
  "use strict";
  var CONFIG = root.CONFIG, M = root.MathUtils, FLAG = root.Protocol.FLAG, AudioSys = root.AudioSys;
  var clamp = M.clamp, dist = M.dist, angTo = M.angTo;

  function Input(canvas, hooks) {
    var self = this;
    hooks = hooks || {};
    this.keys = {};
    this.mouse = { x: CONFIG.VIEW_W / 2, y: CONFIG.VIEW_H / 2 };
    this.mb = { left: false, right: false };

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      self.mouse.x = (e.clientX - r.left) * (CONFIG.VIEW_W / r.width);
      self.mouse.y = (e.clientY - r.top) * (CONFIG.VIEW_H / r.height);
    }
    window.addEventListener("keydown", function (e) {
      var c = e.code || e.key;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(c) >= 0) e.preventDefault();
      AudioSys.init(); AudioSys.resume();
      if (!e.repeat) { self.keys[c] = true; if (hooks.onKey) hooks.onKey(c); }
    });
    window.addEventListener("keyup", function (e) { self.keys[e.code || e.key] = false; });
    window.addEventListener("blur", function () { self.keys = {}; self.mb.left = self.mb.right = false; });
    canvas.addEventListener("mousemove", pos);
    canvas.addEventListener("mousedown", function (e) {
      pos(e); AudioSys.init(); AudioSys.resume(); e.preventDefault();
      if (e.button === 0) self.mb.left = true;
      if (e.button === 2) self.mb.right = true;
      if (hooks.onClick) hooks.onClick(e.button);
    });
    window.addEventListener("mouseup", function (e) {
      if (e.button === 0) self.mb.left = false;
      if (e.button === 2) self.mb.right = false;
    });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
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

  // build the InputState. camera + local player position resolve the aim.
  Input.prototype.state = function (camera, px, py) {
    var a = this.axis();
    var wx = this.mouse.x + camera.x, wy = this.mouse.y + camera.y;
    var aim = angTo(px, py - 10, wx, wy);
    var aimDist = clamp(dist(px, py, wx, wy), 40, CONFIG.BANANA.RANGE);
    var k = this.keys;
    var flags = 0;
    if (this.mb.left) flags |= FLAG.THROW;
    if (k.Space || this.mb.right) flags |= FLAG.COUNTER;
    if (k.ShiftLeft || k.ShiftRight) flags |= FLAG.SLIDE;
    if (k.KeyE) flags |= FLAG.INTERACT;
    return { move: a, aim: aim, aimDist: aimDist, flags: flags };
  };

  root.Input = Input;
})(typeof window !== "undefined" ? window : this);
