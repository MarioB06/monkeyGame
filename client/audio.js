/* ============================================================================
   AUDIO -- tiny Web Audio synthesizer. BROWSER ONLY. Exposes window.AudioSys.
   Created lazily on first user input (autoplay policy). Every call is wrapped
   so audio can never break the game.
   ========================================================================== */
(function (root) {
  "use strict";
  var AudioSys = {
    ctx: null, master: null, muted: false, failed: false,

    init: function () {
      if (this.ctx || this.failed) return;
      try {
        var AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) { this.failed = true; return; }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.4;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.failed = true; }
    },
    resume: function () { try { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); } catch (e) {} },
    toggleMute: function () {
      this.muted = !this.muted;
      try { if (this.master) this.master.gain.value = this.muted ? 0 : 0.4; } catch (e) {}
      return this.muted;
    },
    tone: function (f0, f1, dur, type, vol, delay) {
      if (!this.ctx || this.muted) return;
      try {
        var t = this.ctx.currentTime + (delay || 0);
        var o = this.ctx.createOscillator(), gn = this.ctx.createGain();
        o.type = type || "square";
        o.frequency.setValueAtTime(Math.max(20, f0), t);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        gn.gain.setValueAtTime(vol || 0.15, t);
        gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(gn); gn.connect(this.master);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (e) {}
    },
    noise: function (dur, vol, freq, delay) {
      if (!this.ctx || this.muted) return;
      try {
        var t = this.ctx.currentTime + (delay || 0);
        var len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
        var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        var src = this.ctx.createBufferSource(); src.buffer = buf;
        var fl = this.ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = freq || 800;
        var gn = this.ctx.createGain();
        gn.gain.setValueAtTime(vol || 0.2, t);
        gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(fl); fl.connect(gn); gn.connect(this.master);
        src.start(t);
      } catch (e) {}
    },
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
  root.AudioSys = AudioSys;
})(typeof window !== "undefined" ? window : this);
