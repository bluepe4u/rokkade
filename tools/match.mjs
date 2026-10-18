#!/usr/bin/env node
// Strength calibration: the solver at each Elo plays a fixed reference opponent (raw Maia-2
// sampling at --ref Elo, with the opening book) with alternating colours. The score gives a
// performance rating:  ref + 400 * log10(score / (1 - score)).
//
// Games that reach --plies without a result are adjudicated by a full-strength engine's
// win chance (so a clearly winning side gets most of the point instead of a coin-flip draw).
//
//   node tools/match.mjs [--elo 100,600,1100,1500] [--ref 1100] [--games 16]
//        [--mode blend|maia|engine] [--beta-cap .. --tau .. --alpha .. --lambda ..]
//        [--plies 160] [--jobs 4] [--review 1]    (--review 1 also reports the solver's move classes)
import os from 'node:os';
import { Chess } from '../public/vendor/chess.js';
import { winPct } from '../public/js/solver.js';
import { NodeEngine } from './uci-node.mjs';
import {
  parseArgs, loadAssets, chooseMove, play, review, newTally, addMoves, tallyRow, TALLY_HEADER,
} from './lib/harness.mjs';

const args = parseArgs();
const ELOS = (args.elo || '100,600,1100,1500').split(',').map(Number);
const REF = +(args.ref || 1100);
const GAMES = +(args.games || 16);
const MODE = args.mode || 'blend';
const MAX_PLIES = +(args.plies || 160);
const JOBS = Math.max(1, Math.min(+(args.jobs || os.cpus().length), ELOS.length * GAMES));
const overrides = {
  betaCap: args.num('beta-cap'), tau: args.num('tau'), alpha: args.num('alpha'), lambda: args.num('lambda'),
};
const assets = await loadAssets();

/** One game; returns the solver's score (1 / 0.5 / 0, or the adjudicated win chance). */
async function playGame(engine, elo, solverIsWhite) {
  const chess = new Chess();
  const solverColor = solverIsWhite ? 'w' : 'b';
  while (!chess.isGameOver() && chess.history().length < MAX_PLIES) {
    const solverMoves = chess.turn() === solverColor;
    const uci = solverMoves
      ? await chooseMove({ chess, elo, oppElo: REF, mode: MODE, engine, assets, depth: args.num('depth'), humanness: args.num('humanness'), overrides })
      : await chooseMove({ chess, elo: REF, oppElo: elo, mode: 'maia', engine, assets, useBook: true });
    play(chess, uci);
  }
  let score;
  if (chess.isCheckmate()) score = chess.turn() === solverColor ? 0 : 1;
  else if (chess.isGameOver()) score = 0.5;
  else {
    const [best] = await engine.analyse(chess.fen(), { depth: 12 });
    const stm = winPct(best.score) / 100; // side to move
    score = chess.turn() === solverColor ? stm : 1 - stm;
  }
  return { chess, score, solverColor };
}

const jobs = ELOS.flatMap((elo) => Array.from({ length: GAMES }, (_, i) => ({ elo, white: i % 2 === 0 })));
const results = Object.fromEntries(ELOS.map((e) => [e, { scores: [], decided: 0, plies: [], tally: newTally() }]));
await Promise.all(Array.from({ length: JOBS }, async () => {
  const engine = await new NodeEngine().init();
  for (let job; (job = jobs.shift()) !== undefined;) {
    engine.send('ucinewgame');
    const { chess, score, solverColor } = await playGame(engine, job.elo, job.white);
    const r = results[job.elo];
    r.scores.push(score);
    if (chess.isGameOver()) r.decided++;
    r.plies.push(chess.history().length);
    if (args.review) {
      const { sides } = await review(engine, chess, 12);
      addMoves(r.tally, sides[solverColor]);
    }
    process.stderr.write('.');
  }
  engine.quit();
}));
process.stderr.write('\n');

const shown = ['beta-cap', 'tau', 'alpha', 'lambda', 'humanness', 'depth'].filter((k) => args[k] !== undefined).map((k) => `${k}=${args[k]}`).join(' ');
console.log(`solver (${MODE}${shown ? `, ${shown}` : ''}) vs raw Maia-2 @ ${REF}, ${GAMES} games/level, ≤${MAX_PLIES} plies`);
console.log('  Elo | score | performance | finished | avg plies');
for (const elo of ELOS) {
  const r = results[elo];
  const s = r.scores.reduce((a, b) => a + b, 0) / r.scores.length;
  const clipped = Math.min(0.97, Math.max(0.03, s));
  const perf = Math.round(REF + 400 * Math.log10(clipped / (1 - clipped)));
  const bound = s >= 0.97 ? '≥' : s <= 0.03 ? '≤' : ' ';
  const plies = r.plies.reduce((a, b) => a + b, 0) / r.plies.length;
  console.log(`${String(elo).padStart(5)} | ${(100 * s).toFixed(0).padStart(4)}% | ${bound}${String(perf).padStart(5)}      | ${String(r.decided).padStart(2)}/${r.scores.length}    | ${plies.toFixed(0)}`);
}
if (args.review) {
  console.log(`\n  Elo | solver's moves: ${TALLY_HEADER}`);
  for (const elo of ELOS) console.log(`${String(elo).padStart(5)} | ${tallyRow(results[elo].tally)}`);
}
