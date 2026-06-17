/* ============================================================================
   WS-LITE -- a tiny dependency-free WebSocket (RFC 6455) implementation using
   only Node core modules (http/crypto/net). No npm.

   - attach(httpServer, onConn): upgrades HTTP requests to WebSocket; calls
     onConn(conn, req) per client. Server frames are sent unmasked.
   - connect(url, onOpen): minimal client (used by tests); client frames masked.

   A Conn emits via callbacks: onmessage(str), onclose(). Methods: send(str),
   ping(), close(). Handles text frames, fragmentation, ping/pong, and close.
   Adequate for small JSON game messages; not a general-purpose WS library.
   ========================================================================== */
"use strict";
var crypto = require("crypto");
var http = require("http");
var net = require("net");

var GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
function acceptKey(key) { return crypto.createHash("sha1").update(key + GUID).digest("base64"); }

function Conn(socket, isClient) {
  var self = this;
  this.socket = socket;
  this.isClient = !!isClient;
  this.buf = Buffer.alloc(0);
  this.fragOp = 0;
  this.fragParts = [];
  this.closed = false;
  this.onmessage = null;
  this.onclose = null;
  socket.on("data", function (d) { self._onData(d); });
  socket.on("close", function () { self._fireClose(); });
  socket.on("error", function () { self._fireClose(); });
}
Conn.prototype._fireClose = function () {
  if (this.closed) return;
  this.closed = true;
  if (this.onclose) try { this.onclose(); } catch (e) {}
};
Conn.prototype._onData = function (d) {
  this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
  this._parse();
};
Conn.prototype._parse = function () {
  while (true) {
    var buf = this.buf;
    if (buf.length < 2) return;
    var b0 = buf[0], b1 = buf[1];
    var fin = (b0 & 0x80) !== 0, op = b0 & 0x0f;
    var masked = (b1 & 0x80) !== 0, len = b1 & 0x7f;
    var off = 2;
    if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(2) * 4294967296 + buf.readUInt32BE(6); off = 10; }
    var maskKey = null;
    if (masked) { if (buf.length < off + 4) return; maskKey = buf.slice(off, off + 4); off += 4; }
    if (buf.length < off + len) return;             // wait for the rest
    var payload = Buffer.from(buf.slice(off, off + len));
    if (masked) for (var i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
    this.buf = buf.slice(off + len);

    if (op === 0x8) { this.close(); this._fireClose(); return; }       // close
    if (op === 0x9) { this._frame(0xA, payload); continue; }           // ping -> pong
    if (op === 0xA) continue;                                          // pong
    if (op === 0x1 || op === 0x2 || op === 0x0) {
      if (op !== 0x0) { this.fragOp = op; this.fragParts = []; }
      this.fragParts.push(payload);
      if (fin) {
        var full = Buffer.concat(this.fragParts);
        this.fragParts = [];
        if (this.onmessage) try { this.onmessage(full.toString("utf8")); } catch (e) {}
      }
    }
  }
};
Conn.prototype._frame = function (opcode, payload) {
  if (this.closed) return;
  payload = payload || Buffer.alloc(0);
  var len = payload.length, header, maskBit = this.isClient ? 0x80 : 0;
  var headLen, lenField;
  if (len < 126) { headLen = 2; lenField = len; }
  else if (len < 65536) { headLen = 4; lenField = 126; }
  else { headLen = 10; lenField = 127; }
  header = Buffer.alloc(headLen + (this.isClient ? 4 : 0));
  header[0] = 0x80 | opcode;
  header[1] = maskBit | lenField;
  if (lenField === 126) header.writeUInt16BE(len, 2);
  else if (lenField === 127) { header.writeUInt32BE(Math.floor(len / 4294967296), 2); header.writeUInt32BE(len >>> 0, 6); }
  var body = payload;
  if (this.isClient) {
    var mask = crypto.randomBytes(4);
    mask.copy(header, headLen);
    body = Buffer.from(payload);
    for (var i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  }
  try { this.socket.write(Buffer.concat([header, body])); } catch (e) { this._fireClose(); }
};
Conn.prototype.send = function (str) { this._frame(0x1, Buffer.from(String(str), "utf8")); };
Conn.prototype.ping = function () { this._frame(0x9, Buffer.alloc(0)); };
Conn.prototype.close = function () {
  if (this.closed) return;
  try { this._frame(0x8, Buffer.alloc(0)); } catch (e) {}
  try { this.socket.end(); } catch (e) {}
};

/* ---- server: attach to an http.Server ---- */
function attach(server, onConn) {
  server.on("upgrade", function (req, socket) {
    if ((req.headers.upgrade || "").toLowerCase() !== "websocket") { socket.destroy(); return; }
    var key = req.headers["sec-websocket-key"];
    if (!key) { socket.destroy(); return; }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n");
    socket.setNoDelay(true);
    onConn(new Conn(socket, false), req);
  });
}

/* ---- client: connect to ws://host:port/path (used by tests) ---- */
function connect(url, onOpen) {
  var m = /^ws:\/\/([^:\/]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) throw new Error("bad ws url: " + url);
  var host = m[1], port = parseInt(m[2] || "80", 10), pathName = m[3] || "/";
  var key = crypto.randomBytes(16).toString("base64");
  var socket = net.connect(port, host, function () {
    socket.write(
      "GET " + pathName + " HTTP/1.1\r\n" +
      "Host: " + host + ":" + port + "\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n");
  });
  var conn = null, headerDone = false, acc = Buffer.alloc(0);
  socket.on("data", function (d) {
    if (headerDone) return;                          // Conn takes over after handshake
    acc = Buffer.concat([acc, d]);
    var idx = acc.indexOf("\r\n\r\n");
    if (idx < 0) return;
    headerDone = true;
    var rest = acc.slice(idx + 4);
    conn = new Conn(socket, true);
    socket.removeAllListeners("data");
    socket.on("data", function (x) { conn._onData(x); });
    if (rest.length) conn._onData(rest);
    if (onOpen) onOpen(conn);
  });
  socket.on("error", function () {});
  return { socket: socket, get conn() { return conn; } };
}

module.exports = { attach: attach, connect: connect, Conn: Conn, acceptKey: acceptKey };
