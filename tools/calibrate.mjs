#!/usr/bin/env node
// Self-play calibration for the Maia-2 + Stockfish solver.
//
// Plays solver-vs-solver games at the given Elo levels, then has a full-strength
// Stockfish review every move: accuracy (Lichess formula), the share of best /
// excellent / good / inaccuracy / mistake / blunder moves (chess.com-style classes by
// win-% lost), how often a standout "only move" is found, and how often the
// opponent's blunder is punished. For actual playing STRENGTH use tools/match.mjs.
//
//   node tools/calibrate.mjs [--elo 1100,1500,1900] [--games 8]
//        [--mode blend|maia|engine]  blend = the real solver, maia = raw Maia-2
//                                    sampling, engine = Stockfish-only fallback
//        [--beta-cap 0.3] [--tau 6] [--alpha 1] [--lambda 0] [--humanness 1]   override the model
//        [--depth 10] [--plies 80] [--review-depth 12] [--jobs 4]
import os from 'node:os';
import { Chess } from '../public/vendor/chess.js';
import { NodeEngine } from './uci-node.mjs';
import {
  parseArgs, loadAssets, chooseMove, play, review, newTally, addMoves, tallyRow, TALLY_HEADER,
} from './lib/harness.mjs';

const args = parseArgs();
const ELOS = (args.elo || '1100,1500,1900').split(',').map(Number);
const GAMES = +(args.games || 8);
const MODE = args.mode || 'blend';
const MAX_PLIES = +(args.plies || 80);
const REVIEW_DEPTH = +(args['review-depth'] || 12);
const JOBS = Math.max(1, Math.min(+(args.jobs || os.cpus().length), ELOS.length * GAMES));
const overrides = {
  betaCap: args.num('beta-cap'), tau: args.num('tau'), alpha: args.num('alpha'), lambda: args.num('lambda'),
};
const assets = await loadAssets();

async function playGame(engine, elo) {
  const chess = new Chess();
  while (!chess.isGameOver() && chess.history().length < MAX_PLIES) {
    const uci = await chooseMove({
      chess, elo, mode: MODE, engine, assets, depth: args.num('depth'), humanness: args.num('humanness'), overrides,
    });
    play(chess, uci);
  }
  return chess;
}

const jobs = ELOS.flatMap((elo) => Array.from({ length: GAMES }, () => elo));
const results = Object.fromEntries(ELOS.map((e) => [e, newTally()]));
await Promise.all(Array.from({ length: JOBS }, async () => {
  const engine = await new NodeEngine().init();
  for (let job; (job = jobs.shift()) !== undefined;) {
    engine.send('ucinewgame');
    const game = await playGame(engine, job);
    const { sides } = await review(engine, game, REVIEW_DEPTH);
    for (const moves of Object.values(sides)) addMoves(results[job], moves);
    process.stderr.write('.');
  }
  engine.quit();
}));
process.stderr.write('\n');

const shown = ['beta-cap', 'tau', 'alpha', 'lambda', 'humanness', 'depth'].filter((k) => args[k] !== undefined).map((k) => `${k}=${args[k]}`).join(' ');
console.log(`mode ${MODE}${shown ? ` (${shown})` : ''}, ${GAMES} games/level, ≤${MAX_PLIES} plies, review depth ${REVIEW_DEPTH}`);
console.log(`  Elo | ${TALLY_HEADER}`);
for (const elo of ELOS) console.log(`${String(elo).padStart(5)} | ${tallyRow(results[elo])}`);
