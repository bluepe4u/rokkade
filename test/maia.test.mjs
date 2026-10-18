import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Chess } from '../public/vendor/chess.js';
import { Maia, encodeBoard, eloCategory, mirrorMove, maskedSoftmax } from '../public/js/maia.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const ref = JSON.parse(await fs.readFile(new URL('./fixtures/maia2-reference.json', import.meta.url)));

test('Elo buckets match maia2.utils.map_to_category', () => {
  const cases = [[0, 0], [1099, 0], [1100, 1], [1199, 1], [1200, 2], [1550, 5], [1999, 9], [2000, 10], [3000, 10]];
  for (const [elo, cat] of cases) assert.equal(eloCategory(elo), cat, `elo ${elo}`);
});

test('mirroring flips ranks and keeps promotions', () => {
  assert.equal(mirrorMove('e2e4'), 'e7e5');
  assert.equal(mirrorMove('a2a1q'), 'a7a8q');
});

test('board encoding: start position', () => {
  const { tensor, mirrored } = encodeBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(mirrored, false);
  const sum = (ch) => tensor.slice(ch * 64, ch * 64 + 64).reduce((a, b) => a + b, 0);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(sum), [8, 2, 2, 2, 1, 1]);
  assert.deepEqual([6, 7, 8, 9, 10, 11].map(sum), [8, 2, 2, 2, 1, 1]);
  assert.equal(sum(12), 64);
  assert.deepEqual([13, 14, 15, 16].map(sum), [64, 64, 64, 64]);
  assert.equal(sum(17), 0);
  assert.equal(tensor[0 * 64 + 1 * 8 + 4], 1); // white pawn on e2 -> row 1, col 4
  assert.equal(tensor[5 * 64 + 0 * 8 + 4], 1); // white king on e1
});

test('board encoding: black to move is mirrored (colours swapped, ranks flipped)', () => {
  const { tensor, mirrored } = encodeBoard('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b Kq e3 0 1');
  assert.equal(mirrored, true);
  assert.equal(tensor[0 * 64 + 1 * 8 + 4], 1); // black pawn e7 becomes a white pawn on e2
  assert.equal(tensor[6 * 64 + 4 * 8 + 4], 1); // white pawn e4 becomes a black pawn on e5 (row 4)
  assert.equal(tensor[13 * 64], 0);            // black has only queen-side rights -> white K-side is off
  assert.equal(tensor[14 * 64], 1);            // ... white Q-side is on
  assert.equal(tensor[15 * 64], 1);            // white had K-side -> black K-side is on
  assert.equal(tensor[16 * 64], 0);
  assert.equal(tensor[17 * 64 + 5 * 8 + 4], 1); // e3 mirrored to e6
});

test('maskedSoftmax sums to one', () => {
  const p = maskedSoftmax([5, -1, 3, 100], [0, 2]);
  assert.ok(Math.abs(p[0] + p[1] - 1) < 1e-12 && p[0] > p[1]);
});

const maia = await Maia.load({
  base: pathToFileURL(path.join(root, 'models') + path.sep).href,
  ortModule: await import('../public/vendor/ort/ort.wasm.min.mjs'),
  wasmPaths: pathToFileURL(path.join(root, 'vendor', 'ort') + path.sep).href,
  readBytes: async (url) => new Uint8Array(await fs.readFile(fileURLToPath(url))),
});

test('JS port reproduces the official PyTorch predictions', async () => {
  let worst = 0;
  for (const c of ref) {
    const legal = new Chess(c.fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
    const { probs, value } = await maia.predict(c.fen, c.elo_self, c.elo_oppo, legal);
    assert.deepEqual([...probs.keys()].sort(), Object.keys(c.probs).sort(), `${c.note}: legal move sets differ`);
    for (const [m, p] of probs) worst = Math.max(worst, Math.abs(p - c.probs[m]));
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(top(Object.fromEntries(probs)), top(c.probs), `${c.note} @${c.elo_self}: top move`);
    assert.ok(Math.abs(value - c.value) < 0.01, `${c.note}: value`);
  }
  console.log(`  max |p_js - p_torch| over ${ref.length} cases: ${worst.toExponential(2)}`);
  assert.ok(worst < Number(process.env.MAIA_TOL || 5e-3), `worst probability error ${worst}`);
});

test('predictions are sensible: a back-rank mate in one is found more often as Elo rises', async () => {
  const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
  const legal = new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
  const low = (await maia.predict(fen, 900, 900, legal)).probs.get('d1d8');
  const high = (await maia.predict(fen, 2100, 2100, legal)).probs.get('d1d8');
  assert.ok(low > 0.8, `even 900-rated players usually play Rd8# (got ${low})`);
  assert.ok(high > low, `stronger players find it more often (${low} -> ${high})`);
});
