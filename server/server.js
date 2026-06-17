/* ============================================================================
   SERVER -- serves the online client over HTTP and runs authoritative matches
   over WebSocket. Zero npm dependencies (Node core + ws-lite + the shared sim).

   Run:  node server/server.js   (or: npm start)
   Then open http://localhost:8080 in 2-4 browser tabs/devices on the LAN.
   ========================================================================== */
"use strict";
var http = require("http");
var fs = require("fs");
var path = require("path");
var url = require("url");
var wsLite = require(path.join(__dirname, "ws-lite.js"));
var Room = require(path.join(__dirname, "room.js"));

var ROOT = path.join(__dirname, "..");
var PORT = parseInt(process.env.PORT || "8080", 10);
var HOST = process.env.HOST || "0.0.0.0";

var TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon", ".png": "image/png" };

// servable code dirs, and the explicit set of servable root-level files
var ALLOW_DIR = { src: 1, client: 1 };
var ROOT_FILES = { "online.html": 1, "index.html": 1, "style.css": 1, "favicon.ico": 1 };

function safePath(reqPath) {
  var clean = decodeURIComponent(reqPath.split("?")[0]);
  if (clean === "/") clean = "/online.html";
  var rel = path.normalize(clean).replace(/^[\/\\]+/, "");
  if (rel.indexOf("..") >= 0) return null;                   // traversal guard
  var abs = path.join(ROOT, rel);
  if (abs.indexOf(ROOT) !== 0) return null;
  var parts = rel.split(/[\/\\]/);
  if (parts.length === 1) { if (!ROOT_FILES[parts[0]]) return null; }
  else { if (!ALLOW_DIR[parts[0]]) return null; if (!/\.(js|css|html|json|png|ico)$/.test(rel)) return null; }
  return abs;
}

var server = http.createServer(function (req, res) {
  var p = url.parse(req.url).pathname;
  var abs = safePath(p);
  if (!abs) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(abs, function (err, data) {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    var ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
});

var hub = new Room.Hub();
wsLite.attach(server, function (conn) { hub.handleConn(conn); });

server.listen(PORT, HOST, function () {
  console.log("================================================");
  console.log(" MONKEY CITY: SIGNAL LOST -- online server up");
  console.log(" Open http://localhost:" + PORT + " in 2-4 tabs");
  console.log(" (LAN: http://<your-ip>:" + PORT + ")");
  console.log("================================================");
});
