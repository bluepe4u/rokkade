#!/usr/bin/env node
// Zero-dependency server for the Stockfish Elo Terminal: serves public/ and the Coach API.
// Usage: node server.js [port]   (default 8080, or $PORT)
//
// Coach API (same layout as Chess Coach, so an old chess-coach "data" folder keeps working):
//   GET  /api/archives?user=NAME      list of months, and which ones still need downloading
//   GET  /api/month?user=NAME&ym=Y/M  download one month of games from chess.com into data/users/NAME/
//   GET  /api/games?user=NAME         every cached game for NAME
//   GET  /api/store?name=KEY          read data/store/KEY.json (null if missing)
//   POST /api/store?name=KEY          write data/store/KEY.json (JSON body)
// The only outside site contacted is chess.com's public API ($CHESSCOM_API_BASE overrides it for tests).
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = path.join(__dirname, 'public');
const DATA = process.env.TERMINAL_DATA_DIR ? path.resolve(process.env.TERMINAL_DATA_DIR) : path.join(__dirname, 'data');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const API_BASE = (process.env.CHESSCOM_API_BASE || 'https://api.chess.com').replace(/\/$/, '');
const UA = 'stockfish-elo-terminal/1.0 (personal game analysis tool)';
const USER_RE = /^[A-Za-z0-9_-]{1,40}$/;
const YM_RE = /^\d{4}\/\d{2}$/;
const STORE_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_BODY = 32 * 1024 * 1024;
const KEEP = ['uuid', 'url', 'pgn', 'time_class', 'time_control', 'rules', 'rated', 'end_time', 'eco', 'accuracies'];
const crypto = require('crypto');
const EXPLORER = (process.env.LICHESS_EXPLORER_BASE || 'https://explorer.lichess.ovh').replace(/\/$/, '');
const TOKEN_FILE = () => path.join(DATA, 'lichess-token.txt');
const EXPLORER_TTL = 30 * 86400 * 1000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// ───────────────────────── chess.com ─────────────────────────
class HttpError extends Error {
  constructor(code) { super(`HTTP ${code}`); this.code = code; }
}

function getOnce(url, redirects = 3, extra = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...extra }, timeout: 45000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(getOnce(new URL(res.headers.location, url).href, redirects - 1, extra));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new HttpError(res.statusCode)); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('chess.com did not answer in time')));
    req.on('error', reject);
  });
}

async function fetchJSON(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await getOnce(url);
    } catch (e) {
      if (e instanceof HttpError && e.code === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('chess.com kept refusing the request');
}

function slim(g) {
  const o = {};
  for (const k of KEEP) if (k in g) o[k] = g[k];
  for (const c of ['white', 'black']) {
    const p = g[c] || {};
    o[c] = { username: p.username || '', rating: p.rating || 0, result: p.result || '' };
  }
  return o;
}

function userDir(user) {
  const d = path.join(DATA, 'users', user.toLowerCase());
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// ───────────────────────── API ─────────────────────────
function sendJSON(res, obj, code = 200) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
}

const localHost = (req) => ['127.0.0.1', 'localhost'].includes(String(req.headers.host || '').replace(/:\d+$/, ''));

async function apiGet(req, res, url) {
  const q = Object.fromEntries(url.searchParams);
  if (url.pathname === '/api/store') {
    if (!STORE_RE.test(q.name || '')) return sendJSON(res, { error: 'bad name' }, 400);
    const f = path.join(DATA, 'store', `${q.name}.json`);
    if (!fs.existsSync(f)) return sendJSON(res, null);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return fs.createReadStream(f).pipe(res);
  }
  if (url.pathname === '/api/lichess-status') {
    return sendJSON(res, { token: !!process.env.LICHESS_EXPLORER_BASE || (fs.existsSync(TOKEN_FILE()) && fs.readFileSync(TOKEN_FILE(), 'utf8').trim().length > 0) });
  }
  if (url.pathname === '/api/lichess') {
    // Lichess opening explorer (needs a free personal token); answers are cached for 30 days.
    const fen = q.fen || '';
    const ratings = (q.ratings || '').replace(/[^0-9,]/g, '');
    const speeds = (q.speeds || '').replace(/[^a-z,]/g, '');
    if (!/^[1-8pnbrqkPNBRQK/]+ [wb] [KQkq-]+ [a-h1-8-]+( \d+ \d+)?$/.test(fen)) return sendJSON(res, { error: 'bad fen' }, 400);
    const qs = `variant=standard&fen=${encodeURIComponent(fen)}&ratings=${ratings}&speeds=${speeds}&moves=12&topGames=0&recentGames=0`;
    const dir = path.join(DATA, 'cache', 'explorer');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${crypto.createHash('sha1').update(qs).digest('hex')}.json`);
    if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < EXPLORER_TTL) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return fs.createReadStream(f).pipe(res);
    }
    const token = fs.existsSync(TOKEN_FILE()) ? fs.readFileSync(TOKEN_FILE(), 'utf8').trim() : '';
    if (!token && !process.env.LICHESS_EXPLORER_BASE) return sendJSON(res, { error: 'no-token' }, 401);
    try {
      const j = await getOnce(`${EXPLORER}/lichess?${qs}`, 3, token ? { Authorization: `Bearer ${token}` } : {});
      fs.writeFileSync(f, JSON.stringify(j));
      return sendJSON(res, j);
    } catch (e) {
      if (e instanceof HttpError && (e.code === 401 || e.code === 403)) return sendJSON(res, { error: 'bad-token' }, 401);
      if (e instanceof HttpError && e.code === 429) return sendJSON(res, { error: 'Lichess is rate-limiting; try again in a minute.' }, 429);
      throw e;
    }
  }
  const user = q.user || '';
  if (!USER_RE.test(user)) return sendJSON(res, { error: 'That does not look like a chess.com username.' }, 400);
  if (url.pathname === '/api/player') {
    const u0 = encodeURIComponent(user.toLowerCase());
    const [profile, stats] = await Promise.all([fetchJSON(`${API_BASE}/pub/player/${u0}`), fetchJSON(`${API_BASE}/pub/player/${u0}/stats`).catch(() => ({}))]);
    return sendJSON(res, { profile: { username: profile.username, name: profile.name || '', avatar: profile.avatar || '', country: (profile.country || '').split('/').pop(), joined: profile.joined || 0, last_online: profile.last_online || 0, title: profile.title || '' }, stats });
  }
  const u = encodeURIComponent(user.toLowerCase());
  if (url.pathname === '/api/archives') {
    const arch = (await fetchJSON(`${API_BASE}/pub/player/${u}/games/archives`)).archives || [];
    const yms = arch.map((a) => a.split('/games/')[1]).filter((ym) => YM_RE.test(ym || ''));
    const d = userDir(user);
    const cached = new Set(fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5).replace('-', '/')));
    const recent = new Set(yms.slice(-2));
    return sendJSON(res, { months: yms, todo: yms.filter((ym) => !cached.has(ym) || recent.has(ym)) });
  }
  if (url.pathname === '/api/month') {
    const ym = q.ym || '';
    if (!YM_RE.test(ym)) return sendJSON(res, { error: 'bad month' }, 400);
    const games = ((await fetchJSON(`${API_BASE}/pub/player/${u}/games/${ym}`)).games || []).map(slim);
    fs.writeFileSync(path.join(userDir(user), `${ym.replace('/', '-')}.json`), JSON.stringify(games));
    return sendJSON(res, { count: games.length });
  }
  if (url.pathname === '/api/games') {
    const d = userDir(user);
    let games = [];
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json')).sort()) {
      games = games.concat(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
    }
    return sendJSON(res, { games });
  }
  return sendJSON(res, { error: 'not found' }, 404);
}

function apiPost(req, res, url) {
  const origin = req.headers.origin;
  let originHost = null;
  try { originHost = origin ? new URL(origin).hostname : null; } catch { originHost = 'bad'; }
  if (!['/api/store', '/api/lichess-token'].includes(url.pathname) || ![null, '127.0.0.1', 'localhost'].includes(originHost)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (url.pathname === '/api/lichess-token') {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 4096) req.destroy(); });
    req.on('end', () => {
      let token = '';
      try { token = String(JSON.parse(b).token || '').trim(); } catch { sendJSON(res, { error: 'not JSON' }, 400); return; }
      if (token && !/^[A-Za-z0-9_-]{8,200}$/.test(token)) { sendJSON(res, { error: 'That does not look like a Lichess token.' }, 400); return; }
      fs.mkdirSync(DATA, { recursive: true });
      if (token) fs.writeFileSync(TOKEN_FILE(), token, { mode: 0o600 }); else if (fs.existsSync(TOKEN_FILE())) fs.unlinkSync(TOKEN_FILE());
      sendJSON(res, { ok: true });
    });
    return;
  }
  const name = url.searchParams.get('name') || '';
  if (!STORE_RE.test(name)) { sendJSON(res, { error: 'bad name' }, 400); return; }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { sendJSON(res, { error: 'too large' }, 413); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (res.headersSent) return;
    const body = Buffer.concat(chunks);
    try { JSON.parse(body.toString('utf8')); } catch { sendJSON(res, { error: 'not JSON' }, 400); return; }
    const d = path.join(DATA, 'store');
    fs.mkdirSync(d, { recursive: true });
    const tmp = path.join(d, `${name}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, path.join(d, `${name}.json`));
    sendJSON(res, { ok: true });
  });
}

// ───────────────────────── static files ─────────────────────────
function serveStatic(req, res, urlPath) {
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
    decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  // Only answer requests addressed to this computer (blocks DNS-rebinding pages).
  if (!localHost(req)) { res.writeHead(403).end('Forbidden'); return; }
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'POST') { apiPost(req, res, url); return; }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    apiGet(req, res, url).catch((e) => {
      if (res.headersSent) { res.destroy(); return; }
      const msg = e instanceof HttpError
        ? (e.code === 404 ? 'chess.com has no player with that name.' : `chess.com answered with error ${e.code}.`)
        : `Could not reach chess.com: ${e.message}`;
      sendJSON(res, { error: msg }, 502);
    });
    return;
  }
  serveStatic(req, res, decodeURIComponent(url.pathname));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is busy. Try: node server.js ${PORT + 1}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`\n  Outpost running at ${url}\n  Press Ctrl+C to stop.\n`);
  if (process.env.NO_OPEN) return;
  const opener = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(opener, () => {});
});
