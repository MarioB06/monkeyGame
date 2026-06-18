/* ============================================================================
   CONFIG -- all balancing constants. SHARED between the browser and Node
   (UMD pattern below). No window/document references here.
   Tweak the game from this one file.
   ========================================================================== */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.CONFIG = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CONFIG = {
    VIEW_W: 480, VIEW_H: 270,          // internal pixel resolution
    WORLD_W: 3200, WORLD_H: 2400,      // world size in pixels (large 4x map)
    WORLD_SEED: 20260612,              // default seed -> same map every run

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
      DMG: 25,               // damage to monkeys
      ARC: 13,               // visual arc height
      RETURN_SPEED: 165,     // returned (caught) banana speed
      RETURN_DMG: 14,
      MONKEY_DMG: 10,        // normal monkey throw damage
      COUNTER_SPEED_MULT: 1.75,
      COUNTER_DMG_MULT: 2.2
    },

    // Per-type monkey stats. catch = chance to catch an incoming banana.
    // windup = telegraph time before a throw (lower = attacks faster).
    MONKEY: {
      normal: { hp: 50,  speed: 56, aggro: 125, throwRange: 100, catch: 0.12,
                meleeDmg: 8,  throwDmg: 10, throwCd: [1.6, 2.6], windup: 0.45, score: 100, scale: 1   },
      guard:  { hp: 80,  speed: 64, aggro: 150, throwRange: 115, catch: 0.30,
                meleeDmg: 11, throwDmg: 12, throwCd: [1.3, 2.2], windup: 0.45, score: 200, scale: 1.18 },
      // dark: wilder jungle monkeys -- faster, longer reach, quicker attacks
      dark:   { hp: 70,  speed: 80, aggro: 220, throwRange: 120, catch: 0.25,
                meleeDmg: 13, throwDmg: 13, throwCd: [0.8, 1.5], windup: 0.30, score: 300, scale: 1.05 },
      alpha:  { hp: 230, speed: 72, aggro: 185, throwRange: 140, catch: 0.55,
                meleeDmg: 16, throwDmg: 16, throwCd: [1.0, 1.7], windup: 0.40, score: 1000, scale: 1.7 }
    },
    MONKEY_LEASH: 150,        // wander distance from home
    MONKEY_ALERT_LEASH: 330,  // leash while angry
    CATCH_HOLD: [0.5, 0.95],  // how long a monkey holds a caught banana

    CHEST_HP: 2,              // banana hits to crack a chest open
    PART_TOTAL: 10,           // electronic parts needed
    RAFT_WADE_MULT: 0.6,      // movement speed while paddling across the ford

    DROPS: { HEART: 0.20, GOLD: 0.15 },  // monkey death drop chances
    HEART_HEAL: 30,

    SCORE: { HIT: 10, CHEST: 150, PART: 250, COUNTER: 75, KILL_PLAYER: 500 },
    COMBO_TIME: 2.5,          // seconds to keep a combo alive

    BUILD_TIME: 2.6,          // seconds to build the signal device
    DAY_LENGTH: 95,           // seconds for a full day/night cycle

    CAMERA_LERP: 6.5,
    CAMERA_LOOKAHEAD: 22,

    /* ---- multiplayer tunables (competitive PvP) ---- */
    MP: {
      MAX_PLAYERS: 4,
      TICK_HZ: 30,            // authoritative sim steps per second
      SNAPSHOT_HZ: 20,        // state broadcasts per second
      INTERP_MS: 100,         // client render delay for interpolation
      RESPAWN: true,          // respawn after death (vs elimination)
      RESPAWN_SECS: 4,
      BUILD_INTERRUPTIBLE: true,  // taking damage / leaving resets the build
      PVP_BANANA_DMG: 22,     // player banana damage to another player
      PVP_RETURN_DMG: 16,     // returned/monkey banana damage carries over
      HITSTOP: false,         // global hit-stop off in MP (can't freeze a shared world)
      COUNTDOWN: 3,           // lobby -> match countdown seconds
      MIN_PLAYERS: 2          // minimum ready players to start
    },

    // bandana colours per player slot (also used for name tags / HUD accents)
    PLAYER_COLORS: [
      { band: "#cf4836", bandD: "#9a3226", name: "RED"   },
      { band: "#3a78c0", bandD: "#26528a", name: "BLUE"  },
      { band: "#46a83a", bandD: "#2e7026", name: "GREEN" },
      { band: "#d8a32a", bandD: "#9a721a", name: "GOLD"  }
    ]
  };

  return CONFIG;
});
