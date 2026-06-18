# MONKEY CITY: SIGNAL LOST

A pixel-art jungle-ruin adventure in plain HTML/CSS/JS. All art and sound are
generated in code (Canvas 2D + Web Audio). **No frameworks, no build tools, no
external assets, and no npm dependencies** — not even on the server.

There are two ways to play:

## 1. Single-player (offline)

Just **double-click `index.html`** — it runs straight from `file://` in any
modern browser. No server needed.

Wake up in a huge city swallowed by jungle. Explore the expanded city (with
alleys and destroyed blocks), the jungle, a dark burnt zone full of fast
**dark monkeys**, and a flooded ruin with a central island. Crack the
region-themed monkey-guarded chests for all **10 electronic parts**, build the
signal device at the radio station, and escape by helicopter.

The water is impassable — to reach the island part, first find the **workshop**
and press **E** to build a raft, then paddle across the marked ford.

## 2. Competitive multiplayer (online, 2–4 players)

Online play needs the tiny Node server (Node 18+). From this folder:

```
npm start          # or:  node server/server.js
```

Then open **http://localhost:8080** in 2–4 browser tabs (or on other devices on
the same network via `http://<your-ip>:8080`). One player creates a room and
shares the 4-letter code; the others join with it; the host starts the match.

**Mode:** same huge map, free-for-all. Everyone needs all 10 parts. Parts are a
finite, contested resource — if a rival is carrying parts you need, **bonk them
with bananas**: a defeated player drops everything they were holding. First to
gather all 10 and build the signal at the station **wins**; building takes a few
seconds and can be interrupted, so the station is the real battleground. Each
player builds their own raft at the workshop, so the island is contested too.

**Hiding:** scattered around the jungle are a few **big climbable trees**. Stand
next to one and press **E** to climb up and hide — monkeys lose your trail and
rivals can't see or hit you (they only spot a faint leaf-rustle). You can't act
or grab parts while hidden, so it's a retreat, not a power move. Press **E**
again to climb down.

No build step: the server serves the same vanilla JS the browser runs.

## Controls

| Input | Action |
|---|---|
| WASD / Arrows | Move |
| Mouse | Aim |
| Left click (hold) | Throw bananas |
| Shift | Slide / dash (i-frames) |
| Space / Right click | Counter — deflect an incoming banana |
| E | Interact · **hold at the station** to build · **climb a big tree to hide** |
| M | Mute · **P** pause (offline) · **R** restart (offline) |

## Architecture

The code is split into a shared simulation, a browser client, and a server.

```
src/        SHARED simulation (runs in the browser for offline play AND in
            Node for online play; UMD-wrapped, no DOM)
  config.js      balancing constants + multiplayer tunables
  mathutils.js   math, RNG, collision
  worldgen.js    buildLayout(seed) -> deterministic spawns/solids/objects
  sim.js         authoritative Sim: players, monkeys, bananas, chests, pickups,
                 helicopter. Emits an event stream; never touches audio/canvas.
  protocol.js    WebSocket message types + input flags

client/     BROWSER ONLY (rendering / input / audio / netcode)
  sprites.js     procedural pixel-art factory + bitmap font
  audio.js       Web Audio synthesizer
  fx.js          particles, camera, and applyEvents (events -> sound/particles)
  groundgen.js   paints the ground layer (separate seeded RNG stream)
  render.js      draws a snapshot (multiplayer-aware, y-sorted 2.5D)
  input.js       keyboard/mouse -> InputState {move, aim, flags}
  ui.js          DOM HUD + screens + lobby
  net.js         WebSocket client + snapshot buffer + interpolation
  app-offline.js single-player boot (runs the Sim locally)
  app-online.js  multiplayer boot (lobby + interpolated rendering)

server/     NODE ONLY (zero npm dependencies)
  ws-lite.js     minimal RFC 6455 WebSocket (Node core only)
  room.js        Hub + Room: lobby, countdown, 30 Hz authoritative tick
  server.js      static file server + WebSocket wiring

test/       headless tests (node, no browser)
  smoke-sim.js     drives the pure Sim
  smoke-offline.js drives the whole offline client under a stubbed DOM
  smoke-server.js  Hub logic + a real WebSocket handshake over a socket
```

Run all tests with `npm test`.

The world is generated deterministically from a seed, so the server and every
client build the identical map from the seed alone — only the dynamic entities
travel over the network. The server is authoritative; clients send input and
render interpolated snapshots.
