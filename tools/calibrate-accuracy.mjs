// Fit Outpost's accuracy formula to chess.com's, from a public sample of games
// (tools/fetch_accuracy_sample.py). Each game is reviewed with the bundled Stockfish, then three
// parameters are grid-searched to minimise the error against chess.com's per-player accuracy:
//   k: scale on win-chance loss per move (how harshly a lost point counts)
//   w: weight of the harmonic mean against the plain mean (how much a few bad moves drag the score)
//   b: opening plies left out (book moves)
// Writes public/models/accuracy-calibration.json, which the app uses as its default.
//
// Usage: node tools/calibrate-accuracy.mjs sample.json [--depth 12] [--reviews reviews.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeEngine } from './uci-node.mjs';
import { EngineQueue, reviewGame } from '../public/js/coach/analysis.js';
import { pgnSans } from '../public/js/coach/games.js';
import { paramAccuracy, DEFAULT_PARAMS } from '../public/js/coach/calibration.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const samplePath = args[0];
const depth = Number(opt('depth', 12));
const cachePath = opt('reviews', samplePath.replace(/\.json$/, `.reviews-d${depth}.json`));
const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};

const ne = await new NodeEngine().init();
// engine.js-style adapter for EngineQueue
const adapter = { analyse: ({ fen, depth: d, multipv = 1, movetime = 0 }) => ne.analyse(fen, { depth: d, multipv, movetime }), cancel() {} };
const queue = new EngineQueue(adapter);
let done = 0;
for (const g of sample) {
  if (cache[g.uuid]) { done++; continue; }
  const sans = pgnSans(g.pgn);
  try {
    const R = await reviewGame(queue, sans, { depth, bookPlies: 0 });
    cache[g.uuid] = { loss: R.loss };
  } catch (e) { console.error('skip', g.uuid, e.message); cache[g.uuid] = { error: true }; }
  done++;
  if (done % 5 === 0) { fs.writeFileSync(cachePath, JSON.stringify(cache)); console.error(`reviewed ${done}/${sample.length}`); }
}
fs.writeFileSync(cachePath, JSON.stringify(cache));
ne.quit();

const rows = [];
for (const g of sample) {
  const r = cache[g.uuid];
  if (!r?.loss) continue;
  for (const side of ['w', 'b']) {
    const rating = side === 'w' ? g.white.rating : g.black.rating;
    rows.push({ loss: r.loss, side, ref: side === 'w' ? g.accuracies.white : g.accuracies.black, rating });
  }
}
const mae = (p) => rows.reduce((s, r) => s + Math.abs(paramAccuracy(r.loss, r.side, p) - r.ref), 0) / rows.length;
const bias = (p) => rows.reduce((s, r) => s + (paramAccuracy(r.loss, r.side, p) - r.ref), 0) / rows.length;
let best = null;
for (let k = 0.2; k <= 3.0001; k += 0.02) {
  for (let w = 0; w <= 1.0001; w += 0.05) {
    for (const b of [0, 4, 8, 12]) {
      const p = { k: +k.toFixed(2), w: +w.toFixed(2), b };
      const m = mae(p);
      if (!best || m < best.m) best = { p, m };
    }
  }
}
const bands = [[0, 800], [800, 1200], [1200, 1600], [1600, 2000], [2000, 4000]];
const byBand = bands.map(([lo, hi]) => {
  const R = rows.filter((r) => r.rating >= lo && r.rating < hi);
  const e = (p) => (R.length ? R.reduce((s, r) => s + Math.abs(paramAccuracy(r.loss, r.side, p) - r.ref), 0) / R.length : null);
  const avg = (f) => (R.length ? R.reduce((s, r) => s + f(r), 0) / R.length : null);
  return { band: `${lo}-${hi}`, n: R.length, chesscom: avg((r) => r.ref), ours: avg((r) => paramAccuracy(r.loss, r.side, DEFAULT_PARAMS)), fitted: avg((r) => paramAccuracy(r.loss, r.side, best.p)), maeDefault: e(DEFAULT_PARAMS), maeFitted: e(best.p) };
});
const out = {
  ...best.p, depth, n: rows.length, games: rows.length / 2, date: new Date().toISOString().slice(0, 10),
  mae: +best.m.toFixed(2), maeDefault: +mae(DEFAULT_PARAMS).toFixed(2), biasDefault: +bias(DEFAULT_PARAMS).toFixed(2), bias: +bias(best.p).toFixed(2),
  byBand: byBand.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v]))),
  source: 'Public chess.com games (blitz and rapid) sampled across rating bands; reviewed with Stockfish 19 lite.',
};
fs.writeFileSync(path.join(ROOT, 'public/models/accuracy-calibration.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
