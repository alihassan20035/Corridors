/* ==========================================================================
   server.js — Corridors online server
   --------------------------------------------------------------------------
   One Node process does two jobs:
     1. Serves the game files (index.html, style.css, scripts, assets).
     2. Runs online rooms over WebSocket at /ws.

   Rooms
     * A player creates a room and gets a random 5-digit ID (10000–99999).
     * The friend joins with that ID. Creator plays Red, joiner plays Blue.
     * The server keeps the real game state and checks every move with the
       same rules engine the browser uses (game.js), so nobody can cheat by
       editing their page.
     * If someone's connection drops, their seat is held for 10 minutes and
       they rejoin automatically when the page reconnects.

   Run:   npm install && npm start      (PORT env var, default 3000)
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { GameState } = require('./game.js');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const SEAT_HOLD_MS = 10 * 60 * 1000;   // keep a disconnected player's seat this long
const EMPTY_ROOM_MS = 30 * 60 * 1000;  // delete rooms nobody has joined after this long
const MAX_ROOMS = 5000;
const CHAT_MAX_LEN = 120;
const CHAT_BURST = 5;                  // at most 5 chat messages…
const CHAT_WINDOW_MS = 5000;           // …in any 5-second window
// Emoji reactions the client offers. Anything else is refused.
const EMOJIS = new Set(['👍', '😂', '😮', '😡', '🔥', '❤️', '👏', '😎']);

/* ------------------------------------------------------------ static files */
// Only these files are public. server.js, package.json, node_modules and
// tests are never served.
const PUBLIC_FILES = new Set(['index.html', 'style.css', 'script.js', 'game.js', 'ai.js', 'online.js']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.png': 'image/png', '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }

  const rel = path.posix.normalize(urlPath).replace(/^\/+/, '');
  const allowed = PUBLIC_FILES.has(rel) || (/^assets\/[\w\-./]+$/.test(rel) && !rel.includes('..'));
  if (!allowed) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }

  const file = path.join(ROOT, rel);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': rel.startsWith('assets/') ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);

/* ------------------------------------------------------------------- rooms */
/** @type {Map<string, Room>} */
const rooms = new Map();

class Room {
  constructor(id) {
    this.id = id;
    this.game = new GameState();
    this.seats = [null, null];      // { token, name, ws, connected, dropTimer }
    this.startedAt = 0;             // set when the second player joins
    this.rematch = [false, false];
    this.createdAt = Date.now();
    this.emptyTimer = setTimeout(() => this.closeIfUnused(), EMPTY_ROOM_MS);
  }

  names() { return this.seats.map((s, i) => (s ? s.name : (i === 0 ? 'Red' : 'Blue'))); }

  stateFor(seat) {
    return {
      t: 'state', room: this.id, you: seat,
      names: this.names(),
      connected: this.seats.map(s => !!(s && s.connected)),
      ready: !!(this.seats[0] && this.seats[1]),
      startedAt: this.startedAt,
      serverNow: Date.now(),
      snap: this.game.snapshot(),
      rematch: this.rematch.slice(),
    };
  }

  send(seat, msg) {
    const s = this.seats[seat];
    if (s && s.connected && s.ws.readyState === 1) s.ws.send(JSON.stringify(msg));
  }
  broadcast(msg) { this.send(0, msg); this.send(1, msg); }
  syncAll() { for (let i = 0; i < 2; i++) this.send(i, this.stateFor(i)); }

  closeIfUnused() {
    if (!this.seats[1]) this.destroy('Room expired before anyone joined');
  }

  destroy(reason) {
    clearTimeout(this.emptyTimer);
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      if (!s) continue;
      clearTimeout(s.dropTimer);
      this.send(i, { t: 'closed', reason });
      if (s.ws) s.ws.room = null;
    }
    rooms.delete(this.id);
  }
}

function newRoomId() {
  for (let tries = 0; tries < 200; tries++) {
    const id = String(crypto.randomInt(10000, 100000)); // 5 digits, never starts with 0
    if (!rooms.has(id)) return id;
  }
  return null;
}

const cleanName = (n, fallback) => {
  const s = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return s || fallback;
};

/* --------------------------------------------------------------- websocket */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.chatTimes = [];
  ws.room = null;   // Room
  ws.seat = -1;
  ws.on('pong', () => { ws.isAlive = true; });

  const reply = (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const fail = (code, message) => reply({ t: 'error', code, message });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return fail('bad', 'Unreadable message'); }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'create': {
        leaveCurrent(ws);
        if (rooms.size >= MAX_ROOMS) return fail('busy', 'The server is full right now. Try again in a few minutes.');
        const id = newRoomId();
        if (!id) return fail('busy', 'Couldn’t make a room code. Try again.');
        const room = new Room(id);
        rooms.set(id, room);
        const token = crypto.randomUUID();
        room.seats[0] = { token, name: cleanName(msg.name, 'Red'), ws, connected: true, dropTimer: null };
        ws.room = room; ws.seat = 0;
        reply({ t: 'created', room: id, token, you: 0 });
        room.send(0, room.stateFor(0));
        log(`room ${id} created`);
        break;
      }

      case 'join': {
        const id = String(msg.room || '').trim();
        if (!/^\d{5}$/.test(id)) return fail('code', 'Room codes are 5 digits.');
        const room = rooms.get(id);
        if (!room) return fail('missing', `No game with code ${id}. Check the number with your friend.`);
        if (room.seats[1]) return fail('full', `Room ${id} already has two players.`);
        if (room.seats[0] && room.seats[0].ws === ws) return fail('self', 'You created this room. Share the code with your friend.');
        leaveCurrent(ws);
        const token = crypto.randomUUID();
        room.seats[1] = { token, name: cleanName(msg.name, 'Blue'), ws, connected: true, dropTimer: null };
        ws.room = room; ws.seat = 1;
        clearTimeout(room.emptyTimer);
        room.startedAt = Date.now();
        reply({ t: 'joined', room: id, token, you: 1 });
        room.syncAll();
        room.send(0, { t: 'notice', kind: 'joined', name: room.seats[1].name });
        log(`room ${id} joined`);
        break;
      }

      case 'rejoin': {
        const room = rooms.get(String(msg.room || ''));
        if (!room) return fail('gone', 'That game has ended.');
        const seat = room.seats.findIndex(s => s && s.token === msg.token);
        if (seat === -1) return fail('gone', 'That game has ended.');
        const s = room.seats[seat];
        if (s.ws && s.ws !== ws && s.ws.readyState === 1) {
          // Same player opened a second tab: the newer tab takes the seat.
          s.ws.send(JSON.stringify({ t: 'closed', reason: 'This game was opened in another tab.' }));
          s.ws.room = null;
        }
        leaveCurrent(ws);
        clearTimeout(s.dropTimer);
        s.ws = ws; s.connected = true;
        ws.room = room; ws.seat = seat;
        reply({ t: 'rejoined', room: room.id, you: seat });
        room.syncAll();
        room.send(1 - seat, { t: 'notice', kind: 'back', name: s.name });
        break;
      }

      case 'action': {
        const room = ws.room;
        if (!room) return fail('noroom', 'You’re not in a game.');
        if (!room.seats[0] || !room.seats[1]) return fail('wait', 'Wait for your friend to join.');
        const g = room.game;
        if (g.winner !== -1) return fail('over', 'This game is over.');
        if (g.turn !== ws.seat) return fail('turn', 'It’s not your turn.');
        const a = msg.action || {};
        const action = a.type === 'move'
          ? { type: 'move', r: a.r | 0, c: a.c | 0 }
          : { type: 'wall', r: a.r | 0, c: a.c | 0, o: a.o === 'v' ? 'v' : 'h' };
        if (a.type !== 'move' && a.type !== 'wall') return fail('bad', 'Unknown action.');
        if (!g.apply(action)) {
          // Tell the sender the truth so a desynced page corrects itself.
          room.send(ws.seat, room.stateFor(ws.seat));
          return fail('illegal', 'That move isn’t allowed.');
        }
        room.broadcast({ t: 'action', action, by: ws.seat, moveCount: g.moveCount });
        if (g.winner !== -1) log(`room ${room.id} won by seat ${g.winner} in ${g.moveCount} moves`);
        break;
      }

      case 'rematch': {
        const room = ws.room;
        if (!room || room.game.winner === -1) return;
        room.rematch[ws.seat] = true;
        if (room.rematch[0] && room.rematch[1]) {
          room.game = new GameState();
          room.rematch = [false, false];
          room.startedAt = Date.now();
          room.syncAll();
          room.broadcast({ t: 'notice', kind: 'rematch' });
        } else {
          room.send(1 - ws.seat, { t: 'notice', kind: 'rematch-offer', name: room.seats[ws.seat].name });
          room.send(ws.seat, { t: 'notice', kind: 'rematch-wait' });
        }
        break;
      }

      case 'chat':
      case 'emoji': {
        const room = ws.room;
        if (!room) return fail('noroom', 'You’re not in a game.');
        if (!room.seats[0] || !room.seats[1]) return fail('wait', 'Your friend hasn’t joined yet.');
        const now = Date.now();
        ws.chatTimes = ws.chatTimes.filter(t => now - t < CHAT_WINDOW_MS);
        if (ws.chatTimes.length >= CHAT_BURST) return fail('slow', 'Slow down a little before sending more messages.');
        let out;
        if (msg.t === 'emoji') {
          if (!EMOJIS.has(msg.e)) return fail('bad', 'Unknown emoji.');
          out = { t: 'chat', kind: 'emoji', text: msg.e };
        } else {
          const text = String(msg.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
          if (!text) return;
          if ([...text].length > CHAT_MAX_LEN) return fail('long', `Messages can be up to ${CHAT_MAX_LEN} characters.`);
          out = { t: 'chat', kind: 'text', text };
        }
        ws.chatTimes.push(now);
        room.chatSeq = (room.chatSeq || 0) + 1;
        room.broadcast({ ...out, by: ws.seat, name: room.seats[ws.seat].name, id: room.chatSeq, ts: now });
        break;
      }

      case 'leave':
        leaveCurrent(ws, true);
        reply({ t: 'left' });
        break;

      case 'ping':
        reply({ t: 'pong' });
        break;
    }
  });

  ws.on('close', () => dropConnection(ws));
  ws.on('error', () => dropConnection(ws));
});

/** Player chose to leave: free the seat and tell the other player. */
function leaveCurrent(ws, explicit) {
  const room = ws.room;
  if (!room) return;
  const seat = ws.seat;
  ws.room = null; ws.seat = -1;
  const other = 1 - seat;
  if (room.seats[other] && explicit) {
    room.send(other, { t: 'notice', kind: 'left', name: room.seats[seat].name });
  }
  room.destroy('Your friend left the game.');
}

/** Connection dropped without "leave": hold the seat for a while. */
function dropConnection(ws) {
  const room = ws.room;
  if (!room) return;
  const s = room.seats[ws.seat];
  if (!s || s.ws !== ws) return;
  s.connected = false;
  room.send(1 - ws.seat, { t: 'notice', kind: 'away', name: s.name });
  room.syncAll();
  clearTimeout(s.dropTimer);
  s.dropTimer = setTimeout(() => {
    if (!s.connected && rooms.get(room.id) === room) {
      room.destroy(`${s.name} didn’t come back, so the game was closed.`);
      log(`room ${room.id} closed after disconnect`);
    }
  }, SEAT_HOLD_MS);
}

// Detect dead connections (phone locked, Wi-Fi gone) every 30 seconds.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

function log(m) { console.log(new Date().toISOString(), m, `(${rooms.size} rooms)`); }

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Corridors is running at http://localhost:${PORT}  (online rooms on /ws)`);
  });
}

module.exports = { server, rooms };
