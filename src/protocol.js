/* ============================================================================
   PROTOCOL -- WebSocket message type constants + input flag bits, SHARED by
   the client and server. JSON messages of the form {m: <type>, ...payload}.
   ========================================================================== */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.Protocol = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // input action bitmask (must match Sim FLAG)
  var FLAG = { THROW: 1, SLIDE: 2, COUNTER: 4, INTERACT: 8 };

  // client -> server
  var C2S = {
    JOIN: "join",       // {name, room}
    LEAVE: "leave",     // {}
    READY: "ready",     // {ready}
    START: "start",     // {}
    INPUT: "input",     // {seq, move:{x,y}, aim, aimDist, flags}
    PING: "ping",       // {t}
    REMATCH: "rematch"  // {}
  };

  // server -> client
  var S2C = {
    WELCOME: "welcome",     // {yourPid, room, seed}
    LOBBY: "lobby",         // {room, players:[{pid,name,ready,host,slot}], state}
    COUNTDOWN: "countdown", // {secs}
    SNAPSHOT: "snapshot",   // {state, events, ackSeq}
    GAMEOVER: "gameover",   // {winnerPid, winnerName, standings}
    ERROR: "error",         // {code, msg}
    PONG: "pong"            // {t, serverTime}
  };

  function encode(obj) { return JSON.stringify(obj); }
  function decode(str) { try { return JSON.parse(str); } catch (e) { return null; } }

  return { FLAG: FLAG, C2S: C2S, S2C: S2C, encode: encode, decode: decode };
});
