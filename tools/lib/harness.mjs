// Shared plumbing for tools/calibrate.mjs and tools/match.mjs: loads Maia-2 and the
// opening book in Node and picks moves with exactly the code the app uses.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Chess } from '../../public/vendor/chess.js';
import { Maia } from '../../public/js/maia.js';
import { OpeningBook } from '../../public/js/book.js';
import * as solver from '../../public/js/solver.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

export function parseArgs(argv = process.argv.slice(2)) {
  const args = Object.fromEntries(argv.reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []));
  args.num = (k) => (args[k] !== undefined ? +args[k] : undefined);
  return args;
}

export async function loadAssets() {
  const maia = await Maia.load({
    base: pathToFileURL(path.join(root, 'models') + path.sep).href,
    ortModule: await import('../../public/vendor/ort/ort.wasm.min.mjs'),
    wasmPaths: pathToFileURL(path.join(root, 'vendor', 'ort') + path.sep).href,
    readBytes: async (url) => new Uint8Array(await fs.readFile(fileURLToPath(url))),
  });
  const book = await OpeningBook.load(
    pathToFileURL(path.join(root, 'models', 'opening-book.json')).href,
    async (u) => JSON.parse(await fs.readFile(fileURLToPath(u), 'utf8')),
  );
  return { maia, book };
}

export const uciOf = (m) => m.from + m.to + (m.promotion || '');
export const legalUci = (chess) => chess.moves({ verbose: true }).map(uciOf);
export const play = (chess, uci) => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/** The solver's model for an Elo, plus the experiment overrides understood by the tools. */
export function modelFor(elo, { mode = 'blend', humanness = 1, overrides = {} } = {}) {
  const m = solver.playerModel(elo, { humanness, maia: mode !== 'engine' });
  if (mode === 'maia') Object.assign(m, { alpha: 1, betaCap: 0 });
  if (mode === 'blend') {
    for (const [k, v] of Object.entries(overrides)) if (v !== undefined) m[k] = v;
  } else if (overrides.tau !== undefined) m.tau = overrides.tau;
  return m;
}

/**
 * Pick the solver's move. mode: blend = the real solver, maia = raw Maia-2 sampling,
 * engine = Stockfish-only fallback.
 */
export async function chooseMove({ chess, elo, oppElo = elo, mode = 'blend', engine, assets, depth, humanness, overrides, useBook }) {
  const legal = legalUci(chess);
  const fen = chess.fen();
  const model = modelFor(elo, { mode, humanness, overrides });
  const budget = solver.searchBudget(elo, legal.length);
  const needEngine = mode !== 'maia' || depth;
  const lines = needEngine
    ? await engine.analyse(fen, { multipv: budget.multipv, depth: depth ?? budget.depth, movetime: budget.movetime })
    : [];
  let prior = null;
  if (mode !== 'engine') {
    prior = ((useBook ?? mode !== 'maia') ? assets.book.prior(fen, legal) : null) ?? (await assets.maia.predict(fen, elo, oppElo, legal)).probs;
  }
  return solver.sampleMove(solver.blendMoves(lines, prior, legal, model));
}

// chess.com-style move classes by win-% points lost.
export const CLASSES = [['best', 0.5], ['excellent', 2], ['good', 5], ['inaccuracy', 10], ['mistake', 20], ['blunder', Infinity]];
export const classOf = (loss) => CLASSES.find(([, max]) => loss < max)[0];

/**
 * Review a finished game with a full-strength engine. Returns, per colour, one record per move:
 * win-% lost, whether the position had a standout "only move" (best beats the runner-up by
 * >= 10 points), and whether the opponent had just blundered (>= 15 points).
 */
export async function review(engine, chess, reviewDepth = 12) {
  const replay = new Chess();
  const fens = [replay.fen()];
  for (const m of chess.history()) { replay.move(m); fens.push(replay.fen()); }
  const wp = []; // white-POV win% of the best move
  const gap = []; // best minus second-best win% (side to move)
  for (const fen of fens) {
    const g = new Chess(fen);
    let w;
    let d = 0;
    if (g.isCheckmate()) w = g.turn() === 'w' ? 0 : 100;
    else if (g.isGameOver()) w = 50;
    else {
      const lines = await engine.analyse(fen, { depth: reviewDepth, multipv: 2 });
      w = solver.winPct(lines[0].score);
      if (lines[1]) d = w - solver.winPct(lines[1].score);
      if (g.turn() === 'b') w = 100 - w;
    }
    wp.push(w);
    gap.push(d);
  }
  const sides = { w: [], b: [] };
  for (let i = 0; i < wp.length - 1; i++) {
    const color = i % 2 === 0 ? 'w' : 'b';
    const loss = Math.max(0, color === 'w' ? wp[i] - wp[i + 1] : wp[i + 1] - wp[i]);
    const prevLoss = i === 0 ? 0 : Math.max(0, color === 'w' ? wp[i] - wp[i - 1] : wp[i - 1] - wp[i]);
    const before = color === 'w' ? wp[i] : 100 - wp[i]; // side to move's win% with best play
    sides[color].push({ loss, shot: gap[i] >= 10, blunderBefore: prevLoss >= 15, contested: before >= 20 && before <= 80 });
  }
  return { sides, finalWhiteWin: wp[wp.length - 1] };
}

export function newTally() {
  // classes/moves count only contested positions (best-play win chance 20-80%): in a decided
  // game nearly every move is "best" because nothing more can be lost.
  return { moveAcc: [], moves: 0, classes: {}, contestedMoves: 0, shots: 0, shotsFound: 0, chances: 0, punished: 0 };
}

export function addMoves(tally, moves) {
  if (!moves.length) return;
  tally.moveAcc.push(moves.reduce((a, m) => a + solver.moveAccuracy(m.loss), 0) / moves.length);
  for (const m of moves) {
    if (m.contested) {
      const c = classOf(m.loss);
      tally.classes[c] = (tally.classes[c] || 0) + 1;
      tally.contestedMoves++;
    }
    if (m.shot) { tally.shots++; if (m.loss < 2) tally.shotsFound++; }
    if (m.blunderBefore) { tally.chances++; if (m.loss < 5) tally.punished++; }
  }
  tally.moves += moves.length;
}

const pc = (x, n) => (n ? ((100 * x) / n).toFixed(0) : '-').padStart(3);
export const meanSd = (a) => {
  const mean = a.reduce((x, y) => x + y, 0) / (a.length || 1);
  return [mean, Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / (a.length || 1))];
};

export function tallyRow(t) {
  const [m, sd] = meanSd(t.moveAcc);
  const cls = CLASSES.map(([name]) => `${pc(t.classes[name] || 0, t.contestedMoves)} `).join(' ');
  return `${m.toFixed(1).padStart(5)} ± ${sd.toFixed(1).padEnd(4)} | ${cls}              | ${pc(t.shotsFound, t.shots)}% (n=${t.shots})    | ${pc(t.punished, t.chances)}% (n=${t.chances})`;
}

export const TALLY_HEADER = 'acc (mean±sd) | best exc good inac mist blun (% of contested moves) | only-move found | blunder punished';
