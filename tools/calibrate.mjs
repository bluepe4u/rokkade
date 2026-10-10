#!/usr/bin/env node
// Self-play calibration: plays solver-vs-solver games at given Elo levels and
// reports the accuracy those moves get from a full-strength review, using the
// Lichess accuracy formula (close in spirit to chess.com's CAPS score).
//
//   node tools/calibrate.mjs [--elo 100,800,1500,2200,3000] [--games 6]
//                            [--randomness 1] [--review-depth 12] [--solver path]
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Chess } from '../public/vendor/chess.js';
import { NodeEngine } from './uci-node.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
  return acc;
}, []));
const ELOS = (args.elo || '100,800,1500,2200,3000').split(',').map(Number);
const GAMES = +(args.games || 6);
const RANDOMNESS = +(args.randomness ?? 1);
const REVIEW_DEPTH = +(args['review-depth'] || 12);
const MAX_PLIES = +(args.plies || 120);
const solverPath = args.solver ? pathToFileURL(path.resolve(args.solver)).href : '../public/js/solver.js';
const solver = await import(solverPath);
const TAU = args.tau !== undefined ? +args.tau : undefined;

export function winPct(score) {
  const cp = score.mate !== undefined ? (score.mate > 0 ? 1000 : -1000) : Math.max(-1000, Math.min(1000, score.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
const moveAccuracy = (loss) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));

async function playGame(engine, elo) {
  const chess = new Chess();
  const params = solver.eloParams(elo, { randomness: RANDOMNESS, tau: TAU });
  while (!chess.isGameOver() && chess.history().length < MAX_PLIES) {
    const legal = chess.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
    const pool = solver.candidatePool ? solver.candidatePool(params, legal.length, 0) : Math.min(legal.length, 8);
    const lines = await engine.analyse(chess.fen(), { multipv: pool, depth: params.depth, movetime: 2500 });
    const uci = solver.sampleMove(solver.weighCandidates(lines, legal.length, params), legal);
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  }
  return chess;
}

async function review(engine, chess) {
  const replay = new Chess();
  const fens = [replay.fen()];
  for (const m of chess.history()) { replay.move(m); fens.push(replay.fen()); }
  // White-POV win% for every position.
  const wp = [];
  for (const fen of fens) {
    const g = new Chess(fen);
    let w;
    if (g.isCheckmate()) w = g.turn() === 'w' ? 0 : 100;
    else if (g.isGameOver()) w = 50;
    else {
      const [best] = await engine.analyse(fen, { depth: REVIEW_DEPTH });
      w = winPct(best.score);
      if (g.turn() === 'b') w = 100 - w;
    }
    wp.push(w);
  }
  const acc = { w: [], b: [] };
  for (let i = 0; i < wp.length - 1; i++) {
    const color = i % 2 === 0 ? 'w' : 'b';
    const loss = color === 'w' ? wp[i] - wp[i + 1] : wp[i + 1] - wp[i];
    acc[color].push(moveAccuracy(Math.max(0, loss)));
  }
  return [acc.w, acc.b].filter((l) => l.length);
}

function gameAccuracy(list) {
  if (!list.length) return null;
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  const harmonic = list.length / list.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return (mean + harmonic) / 2;
}

const jobs = ELOS.flatMap((elo) => Array.from({ length: GAMES }, () => elo));
const results = Object.fromEntries(ELOS.map((e) => [e, { acc: [], mean: [], plies: [] }]));
const workers = Math.max(1, Math.min(os.cpus().length, jobs.length));
await Promise.all(Array.from({ length: workers }, async () => {
  const engine = await new NodeEngine().init();
  for (let job; (job = jobs.shift()) !== undefined;) {
    engine.send('ucinewgame');
    const game = await playGame(engine, job);
    for (const list of await review(engine, game)) {
      results[job].acc.push(gameAccuracy(list));
      results[job].mean.push(list.reduce((a, b) => a + b, 0) / list.length);
    }
    results[job].plies.push(game.history().length);
    process.stderr.write('.');
  }
  engine.quit();
}));
process.stderr.write('\n');

console.log(`${TAU !== undefined ? `tau ${TAU}, ` : ''}randomness ${RANDOMNESS}, ${GAMES} games/level, review depth ${REVIEW_DEPTH}`);
const stats = (a) => {
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length);
  return `${mean.toFixed(1).padStart(5)} ± ${sd.toFixed(1).padEnd(4)}`;
};
console.log('  Elo | lichess-style game acc | mean move acc (≈chess.com) | avg plies');
for (const elo of ELOS) {
  const r = results[elo];
  const plies = r.plies.reduce((x, y) => x + y, 0) / r.plies.length;
  console.log(`${String(elo).padStart(5)} | ${stats(r.acc)}            | ${stats(r.mean)}                | ${plies.toFixed(0)}`);
}
