#!/usr/bin/env node
// Self-play calibration for the Maia-2 + Stockfish solver.
//
// Plays solver-vs-solver games at the given Elo levels, then has a full-strength
// Stockfish review every move and reports how accurate those moves were (Lichess
// accuracy formula, close in spirit to chess.com's CAPS) and how often they were
// blunders (>= 20 win-% points lost).
//
//   node tools/calibrate.mjs [--elo 1100,1500,1900] [--games 8]
//        [--mode blend|maia|engine]  blend = the real solver, maia = raw Maia-2
//                                    sampling, engine = Stockfish-only fallback
//        [--beta-cap 0.3] [--tau 6] [--alpha 1] [--humanness 1]   override the model
//        [--depth 10] [--plies 80] [--review-depth 12] [--jobs 4]
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Chess } from '../public/vendor/chess.js';
import { Maia } from '../public/js/maia.js';
import { OpeningBook } from '../public/js/book.js';
import * as solver from '../public/js/solver.js';
import { NodeEngine } from './uci-node.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
const ELOS = (args.elo || '1100,1500,1900').split(',').map(Number);
const GAMES = +(args.games || 8);
const MODE = args.mode || 'blend';
const MAX_PLIES = +(args.plies || 80);
const REVIEW_DEPTH = +(args['review-depth'] || 12);
const JOBS = Math.max(1, Math.min(+(args.jobs || os.cpus().length), ELOS.length * GAMES));
const num = (k) => (args[k] !== undefined ? +args[k] : undefined);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const maia = await Maia.load({
  base: pathToFileURL(path.join(root, 'models') + path.sep).href,
  ortModule: await import('../public/vendor/ort/ort.wasm.min.mjs'),
  wasmPaths: pathToFileURL(path.join(root, 'vendor', 'ort') + path.sep).href,
  readBytes: async (url) => new Uint8Array(await fs.readFile(fileURLToPath(url))),
});

const book = await OpeningBook.load(pathToFileURL(path.join(root, 'models', 'opening-book.json')).href, async (u) => JSON.parse(await fs.readFile(fileURLToPath(u), 'utf8')));

function modelFor(elo) {
  const m = solver.playerModel(elo, { humanness: num('humanness') ?? 1, maia: MODE !== 'engine' });
  if (MODE === 'maia') Object.assign(m, { alpha: 1, betaCap: 0 });
  if (num('beta-cap') !== undefined && MODE === 'blend') m.betaCap = num('beta-cap');
  if (num('tau') !== undefined) m.tau = num('tau');
  if (num('alpha') !== undefined && MODE === 'blend') m.alpha = num('alpha');
  return m;
}

async function playGame(engine, elo) {
  const chess = new Chess();
  const model = modelFor(elo);
  while (!chess.isGameOver() && chess.history().length < MAX_PLIES) {
    const legal = chess.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
    const budget = solver.searchBudget(elo, legal.length);
    const lines = MODE === 'maia' && !args.depth
      ? []
      : await engine.analyse(chess.fen(), { multipv: budget.multipv, depth: num('depth') ?? budget.depth, movetime: budget.movetime });
    const prior = MODE === 'engine' ? null : (MODE === 'maia' ? null : book.prior(chess.fen(), legal)) ?? (await maia.predict(chess.fen(), elo, elo, legal)).probs;
    const uci = solver.sampleMove(solver.blendMoves(lines, prior, legal, model));
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  }
  return chess;
}

/** Per-move win-% loss for both sides, judged by a full-strength engine. */
async function review(engine, chess) {
  const replay = new Chess();
  const fens = [replay.fen()];
  for (const m of chess.history()) { replay.move(m); fens.push(replay.fen()); }
  const wp = []; // white-POV win%
  for (const fen of fens) {
    const g = new Chess(fen);
    let w;
    if (g.isCheckmate()) w = g.turn() === 'w' ? 0 : 100;
    else if (g.isGameOver()) w = 50;
    else {
      const [best] = await engine.analyse(fen, { depth: REVIEW_DEPTH });
      w = solver.winPct(best.score);
      if (g.turn() === 'b') w = 100 - w;
    }
    wp.push(w);
  }
  const losses = { w: [], b: [] };
  for (let i = 0; i < wp.length - 1; i++) {
    const color = i % 2 === 0 ? 'w' : 'b';
    losses[color].push(Math.max(0, color === 'w' ? wp[i] - wp[i + 1] : wp[i + 1] - wp[i]));
  }
  return [losses.w, losses.b].filter((l) => l.length);
}

const jobs = ELOS.flatMap((elo) => Array.from({ length: GAMES }, () => elo));
const results = Object.fromEntries(ELOS.map((e) => [e, { moveAcc: [], blunders: [], moves: 0, plies: [] }]));
await Promise.all(Array.from({ length: JOBS }, async () => {
  const engine = await new NodeEngine().init();
  for (let job; (job = jobs.shift()) !== undefined;) {
    engine.send('ucinewgame');
    const game = await playGame(engine, job);
    for (const losses of await review(engine, game)) {
      const r = results[job];
      r.moveAcc.push(losses.reduce((a, l) => a + solver.moveAccuracy(l), 0) / losses.length);
      r.blunders.push(losses.filter((l) => l >= 20).length / losses.length);
      r.moves += losses.length;
    }
    results[job].plies.push(game.history().length);
    process.stderr.write('.');
  }
  engine.quit();
}));
process.stderr.write('\n');

const stats = (a) => {
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length);
  return [mean, sd];
};
const overrides = ['beta-cap', 'tau', 'alpha', 'humanness', 'depth'].filter((k) => args[k] !== undefined).map((k) => `${k}=${args[k]}`).join(' ');
console.log(`mode ${MODE}${overrides ? ` (${overrides})` : ''}, ${GAMES} games/level, ≤${MAX_PLIES} plies, review depth ${REVIEW_DEPTH}`);
console.log('  Elo | move accuracy (mean ± sd per game) | blunders per 100 moves');
for (const elo of ELOS) {
  const r = results[elo];
  const [m, sd] = stats(r.moveAcc);
  const [b] = stats(r.blunders);
  console.log(`${String(elo).padStart(5)} | ${m.toFixed(1).padStart(6)} ± ${sd.toFixed(1).padEnd(5)}                  | ${(b * 100).toFixed(1).padStart(5)}`);
}
