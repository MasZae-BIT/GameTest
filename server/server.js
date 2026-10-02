const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const QUESTIONS = require('./questions');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4, SECONDS = 10, POINTS = 100;
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLORS = ['red', 'blue', 'yellow', 'green'];
const WEB = path.join(__dirname, '..', 'web'); // opsional: kalau ada, ikut disajikan
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const rooms = new Map();
let nextId = 1;

const server = http.createServer((req, res) => {
  let p; try { p = decodeURIComponent(req.url.split('?')[0]); } catch { p = '/'; }
  if (p === '/health') { res.end('ok'); return; }
  const f = path.join(WEB, p === '/' ? 'index.html' : p);
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const plist = r => [...r.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: !!p.ws }));
const sendPlayers = (r, o) => r.players.forEach(p => send(p.ws, o));
const allAnswered = r => { const c = [...r.players.values()].filter(p => p.ws); return c.length > 0 && c.every(p => p.answer != null); };
function newCode() { let c; do { c = Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join(''); } while (rooms.has(c)); return c; }

function ask(r, i) {
  clearTimeout(r.timer);
  r.q = i; r.state = 'question'; r.endsAt = Date.now() + SECONDS * 1000;
  r.players.forEach(p => { p.answer = null; });
  const q = QUESTIONS[i];
  send(r.host, { type: 'question', index: i, total: QUESTIONS.length, text: q.text, options: q.options, seconds: SECONDS });
  sendPlayers(r, { type: 'question', index: i, total: QUESTIONS.length, seconds: SECONDS });
  r.timer = setTimeout(() => reveal(r), SECONDS * 1000);
}

function reveal(r) {
  if (r.state !== 'question') return;
  clearTimeout(r.timer); r.state = 'reveal';
  const q = QUESTIONS[r.q];
  r.players.forEach(p => { if (p.answer === q.correct) p.score += POINTS; });
  send(r.host, { type: 'reveal', correct: q.correct, correctText: q.options[q.correct], scores: plist(r), last: r.q === QUESTIONS.length - 1 });
  r.players.forEach(p => send(p.ws, { type: 'reveal', correct: q.correct, answer: p.answer, isCorrect: p.answer === q.correct, score: p.score }));
}

function final(r) {
  r.state = 'final';
  const ranking = plist(r).sort((a, b) => b.score - a.score).map(p => ({ name: p.name, score: p.score }));
  send(r.host, { type: 'final', ranking });
  sendPlayers(r, { type: 'final', ranking });
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    const r = ws.room ? rooms.get(ws.room) : null;

    if (m.type === 'host_create' && !ws.room) {
      const code = newCode();
      rooms.set(code, { code, host: ws, players: new Map(), state: 'lobby', q: -1, timer: null });
      ws.room = code; ws.role = 'host';
      send(ws, { type: 'room_created', room: code, maxPlayers: MAX_PLAYERS });
    }
    else if (m.type === 'join' && !ws.room) {
      const jr = rooms.get(String(m.room || '').toUpperCase());
      if (!jr) return send(ws, { type: 'error', message: 'Room tidak ditemukan' });
      const name = String(m.name || 'Pemain').trim().slice(0, 14) || 'Pemain';
      let p = [...jr.players.values()].find(x => x.name === name);
      if (p && p.ws) return send(ws, { type: 'error', message: 'Nama sudah dipakai' });
      if (!p) {
        if (jr.players.size >= MAX_PLAYERS) return send(ws, { type: 'error', message: 'Room penuh (4 pemain)' });
        p = { id: 'p' + nextId++, name, ws: null, score: 0, answer: null };
        jr.players.set(p.id, p);
      }
      p.ws = ws; ws.room = jr.code; ws.role = 'player'; ws.pid = p.id;
      send(ws, { type: 'joined', id: p.id, name: p.name, state: jr.state });
      send(jr.host, { type: 'players', players: plist(jr) });
      if (jr.state === 'question') send(ws, { type: 'question', index: jr.q, total: QUESTIONS.length, seconds: Math.max(1, Math.round((jr.endsAt - Date.now()) / 1000)) });
    }
    else if (r && ws.role === 'host') {
      if (m.type === 'start' && r.state === 'lobby' && [...r.players.values()].some(p => p.ws)) ask(r, 0);
      else if (m.type === 'next' && r.state === 'reveal') (r.q + 1 < QUESTIONS.length ? ask(r, r.q + 1) : final(r));
      else if (m.type === 'restart' && r.state === 'final') { r.players.forEach(p => { p.score = 0; }); ask(r, 0); }
    }
    else if (r && ws.role === 'player' && m.type === 'answer') {
      const p = r.players.get(ws.pid);
      if (!p || r.state !== 'question' || p.answer != null || !COLORS.includes(m.value)) return;
      p.answer = m.value;
      send(ws, { type: 'answered' });
      send(r.host, { type: 'answered_count', count: [...r.players.values()].filter(x => x.answer != null).length, total: r.players.size });
      if (allAnswered(r)) reveal(r);
    }
  });

  ws.on('close', () => {
    const r = ws.room ? rooms.get(ws.room) : null;
    if (!r) return;
    if (ws.role === 'host') { clearTimeout(r.timer); sendPlayers(r, { type: 'room_closed' }); rooms.delete(r.code); }
    else if (ws.role === 'player') {
      const p = r.players.get(ws.pid);
      if (!p || p.ws !== ws) return;
      p.ws = null;
      if (r.state === 'lobby') r.players.delete(p.id);
      send(r.host, { type: 'players', players: plist(r) });
      if (r.state === 'question' && allAnswered(r)) reveal(r);
    }
  });
});

setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);
server.listen(PORT, () => console.log('Tebak Cepat server di port ' + PORT));
