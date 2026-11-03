// Both servers (Node and the Python fallback) must expose the same Coach API. They are run against a
// mock chess.com on a random port with a throwaway data folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GAME = (i) => ({
  uuid: `g${i}`, url: `https://www.chess.com/game/live/${i}`, pgn: '1. e4 e5 *', time_class: 'blitz', rules: 'chess',
  rated: true, end_time: 1700000000 + i, eco: 'https://www.chess.com/openings/Kings-Pawn', secret: 'dropped',
  white: { username: 'Tester', rating: 1500, result: 'win', '@id': 'x' }, black: { username: 'Opp', rating: 1490, result: 'checkmated' },
});

let mock, mockPort, hits = 0;
before(async () => {
  mock = http.createServer((req, res) => {
    hits++;
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/pub/player/tester/games/archives') {
      return send(200, { archives: ['2024/01', '2024/02', '2024/03'].map((m) => `https://api.chess.com/pub/player/tester/games/${m}`) });
    }
    const m = req.url.match(/^\/pub\/player\/tester\/games\/(\d{4})\/(\d{2})$/);
    if (m) return send(200, { games: [GAME(Number(m[2]) * 10), GAME(Number(m[2]) * 10 + 1)] });
    return send(404, { message: 'not found' });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockPort = mock.address().port;
});
after(() => mock.close());

const hasPython = spawnSync('python3', ['--version']).status === 0;

async function startServer(kind) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sfet-data-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, NO_OPEN: '1', TERMINAL_DATA_DIR: data, CHESSCOM_API_BASE: `http://127.0.0.1:${mockPort}` };
  const proc = kind === 'node'
    ? spawn(process.execPath, [path.join(ROOT, 'server.js'), String(port)], { env, stdio: 'ignore' })
    : spawn('python3', ['-I', path.join(ROOT, 'serve.py'), String(port)], { env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  return { port, data, stop: () => { proc.kill(); fs.rmSync(data, { recursive: true, force: true }); } };
}

function raw(port, { method = 'GET', pathName, host, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathName, headers: { Host: host || `127.0.0.1:${port}`, ...headers } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

for (const kind of ['node', 'python']) {
  test(`${kind} server: coach API`, { skip: kind === 'python' && !hasPython }, async () => {
    const s = await startServer(kind);
    try {
      const base = `http://127.0.0.1:${s.port}`;
      const j = async (p, o) => { const r = await fetch(base + p, o); return { status: r.status, body: await r.json() }; };

      // static files still work
      const idx = await fetch(`${base}/`);
      assert.equal(idx.status, 200);

      let r = await j('/api/archives?user=Tester');
      assert.deepEqual(r.body.months, ['2024/01', '2024/02', '2024/03']);
      assert.deepEqual(r.body.todo, ['2024/01', '2024/02', '2024/03']);

      r = await j('/api/month?user=Tester&ym=2024/01');
      assert.deepEqual(r.body, { count: 2 });
      assert.ok(fs.existsSync(path.join(s.data, 'users', 'tester', '2024-01.json')));
      await j('/api/month?user=Tester&ym=2024/02');

      // cached old months drop out of todo; the last two always refresh
      r = await j('/api/archives?user=Tester');
      assert.deepEqual(r.body.todo, ['2024/02', '2024/03']);

      r = await j('/api/games?user=tester');
      assert.equal(r.body.games.length, 4);
      const g = r.body.games[0];
      assert.equal(g.uuid, 'g10');
      assert.equal(g.secret, undefined, 'unknown fields are dropped');
      assert.deepEqual(g.white, { username: 'Tester', rating: 1500, result: 'win' });

      // unknown player → friendly 502
      r = await j('/api/archives?user=nobody');
      assert.equal(r.status, 502);
      assert.match(r.body.error, /no player/);

      // validation
      assert.equal((await j('/api/games?user=bad%20name')).status, 400);
      assert.equal((await j('/api/month?user=Tester&ym=2024-01')).status, 400);
      assert.equal((await j('/api/store?name=../x')).status, 400);

      // store round trip
      assert.equal((await j('/api/store?name=custom')).body, null);
      r = await j('/api/store?name=custom', { method: 'POST', body: JSON.stringify({ lines: [1, 2] }), headers: { 'Content-Type': 'application/json' } });
      assert.deepEqual(r.body, { ok: true });
      assert.deepEqual((await j('/api/store?name=custom')).body, { lines: [1, 2] });
      r = await j('/api/store?name=custom', { method: 'POST', body: 'not json' });
      assert.equal(r.status, 400);
      assert.deepEqual((await j('/api/store?name=custom')).body, { lines: [1, 2] }, 'bad write leaves the old value');

      // security: foreign Host header, foreign Origin on POST
      assert.equal((await raw(s.port, { pathName: '/api/games?user=tester', host: 'evil.example' })).status, 403);
      assert.equal((await raw(s.port, { pathName: '/', host: 'evil.example:80' })).status, 403);
      const post = await raw(s.port, { method: 'POST', pathName: '/api/store?name=custom', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json', 'Content-Length': 2 }, body: '{}' });
      assert.equal(post.status, 403);
      assert.deepEqual((await j('/api/store?name=custom')).body, { lines: [1, 2] });
      // localhost host name is accepted
      assert.equal((await raw(s.port, { pathName: '/api/store?name=custom', host: `localhost:${s.port}` })).status, 200);
    } finally {
      s.stop();
    }
  });
}
