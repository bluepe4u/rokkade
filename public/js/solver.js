// Elo-weighted move selection and material-outcome analysis.
//
// Every legal move is scored by Stockfish (MultiPV over the whole move list),
// and its cost is measured as the drop in *win probability* versus the best
// move, the same quantity chess.com / Lichess accuracy is built on. A player
// of a given Elo picks moves with a softmax over that loss: the temperature
// is high at low Elo (hanging a piece is a routine event) and collapses
// towards zero near 3000 (always the top move). The temperature curve is
// calibrated by self-play (tools/calibrate.mjs) against accuracy targets.
import { Chess } from '../vendor/chess.js';

export const ELO_MIN = 0;
export const ELO_MAX = 3000;
export const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const MATE_CP = 100000;

export const ELO_BANDS = [
  [0, 'Newcomer'],
  [600, 'Beginner'],
  [1000, 'Casual'],
  [1400, 'Club'],
  [1800, 'Strong club'],
  [2100, 'Expert'],
  [2300, 'Master'],
  [2500, 'Grandmaster'],
  [2750, 'Super-GM'],
  [2900, 'Engine-like'],
];

export function eloBand(elo) {
  let label = ELO_BANDS[0][1];
  for (const [min, name] of ELO_BANDS) if (elo >= min) label = name;
  return label;
}

// Softmax temperature (in win-% points) at each Elo anchor, interpolated
// log-linearly in between. Calibrated with tools/calibrate.mjs so that self-play
// accuracy roughly tracks ACCURACY_TARGETS below.
export const TAU_ANCHORS = [
  [0, 30],
  [500, 12],
  [1000, 5],
  [1500, 2.2],
  [2000, 1],
  [2500, 0.45],
  [3000, 0.15],
];

/** Approximate chess.com-style average move accuracy we aim for at each Elo. */
export const ACCURACY_TARGETS = [
  [0, 35], [500, 60], [1000, 80], [1500, 87], [2000, 91], [2500, 95], [3000, 97],
];

function interpolateLog(anchors, x) {
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (x <= x1) {
      const [x0, y0] = anchors[i - 1];
      const t = (x - x0) / (x1 - x0);
      return Math.exp(Math.log(y0) + t * (Math.log(y1) - Math.log(y0)));
    }
  }
  return anchors[anchors.length - 1][1];
}

/**
 * Derive the search/selection parameters for an Elo.
 * @param {number} elo 0..3000
 * @param {{randomness?: number, depth?: number, tau?: number}} opts
 *   depth 0 = derive from Elo; tau overrides the calibrated temperature.
 */
export function eloParams(elo, { randomness = 1, depth = 0, tau } = {}) {
  const e = Math.min(ELO_MAX, Math.max(ELO_MIN, elo));
  const r = Math.max(0, randomness);
  const autoDepth = Math.round(1 + 17 * Math.pow(e / ELO_MAX, 1.6));
  return {
    elo: e,
    depth: depth > 0 ? depth : autoDepth,
    // Win-% points of loss that cut a move's selection weight by a factor e.
    tau: (tau ?? interpolateLog(TAU_ANCHORS, e)) * r,
  };
}

/**
 * How many engine lines to request. With `poolSetting` 0 ("all") every legal
 * move is scored, which is what the model needs at club level and below;
 * strong players almost never leave the top handful, so their deep searches
 * stay affordable with a smaller pool.
 */
export function candidatePool(params, legalCount, poolSetting = 0) {
  if (poolSetting > 0) return Math.min(legalCount, poolSetting);
  return params.depth <= 10 ? legalCount : Math.min(legalCount, 10);
}

/** Score (from side-to-move POV) as a single comparable centipawn number. */
export function scoreToCp(score) {
  if (score.mate !== undefined) {
    if (score.mate === 0) return -MATE_CP;
    return Math.sign(score.mate) * (MATE_CP - Math.abs(score.mate) * 100);
  }
  return score.cp;
}

/** Winning chances (0-100) for the side to move — the Lichess curve. */
export function winPct(score) {
  const cp = score.mate !== undefined
    ? (score.mate > 0 ? 1000 : -1000)
    : Math.max(-1000, Math.min(1000, score.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Accuracy (0-100) of a move that drops `loss` win-% points — the Lichess formula. */
export function moveAccuracy(loss) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, loss)) - 3.1669));
}

export function formatScore(score, povSign = 1) {
  if (score.mate !== undefined) {
    const m = score.mate * povSign;
    return m === 0 ? '#' : `${m > 0 ? '' : '−'}M${Math.abs(m)}`;
  }
  const v = (score.cp * povSign) / 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
}

// Loss assumed for legal moves the engine did not list (pool smaller than the move list).
const UNLISTED_MIN_LOSS = 15;

/**
 * Attach Elo-weighted selection probabilities to engine lines.
 * @param {Array<{score, pv}>} lines engine lines (best first)
 * @param {number} legalCount number of legal moves in the position
 * @param {{tau:number}} params from eloParams()
 * @returns {{candidates: Array, otherProb: number, expectedAccuracy: number}}
 */
export function weighCandidates(lines, legalCount, params) {
  if (!lines.length) return { candidates: [], otherProb: 0, expectedAccuracy: 100 };
  const wins = lines.map((l) => winPct(l.score));
  const cps = lines.map((l) => scoreToCp(l.score));
  const bestWin = Math.max(...wins);
  const bestCp = Math.max(...cps);
  const losses = wins.map((w) => bestWin - w);
  const unlisted = Math.max(0, legalCount - lines.length);
  const unlistedLoss = Math.max(UNLISTED_MIN_LOSS, ...losses);
  const weight = (loss, cp) => {
    if (params.tau <= 1e-9) return cp === bestCp ? 1 : 0;
    // Tiny centipawn tie-break so equal win-% moves (e.g. two mates) prefer the better one.
    return Math.exp(-(loss + (bestCp - cp) * 1e-4) / params.tau);
  };
  const weights = losses.map((loss, i) => weight(loss, cps[i]));
  const otherWeight = unlisted ? unlisted * (params.tau <= 1e-9 ? 0 : Math.exp(-unlistedLoss / params.tau)) : 0;
  const total = weights.reduce((a, b) => a + b, 0) + otherWeight;
  const candidates = lines.map((l, i) => ({
    ...l,
    move: l.pv[0],
    cp: cps[i],
    loss: losses[i],
    accuracy: moveAccuracy(losses[i]),
    prob: weights[i] / total,
  }));
  const otherProb = otherWeight / total;
  const expectedAccuracy = candidates.reduce((a, c) => a + c.prob * c.accuracy, 0)
    + otherProb * moveAccuracy(unlistedLoss);
  return { candidates, otherProb, expectedAccuracy };
}

/**
 * Sample a move (UCI string) from weighted candidates. With probability
 * `otherProb` a random legal move outside the candidate list is chosen.
 */
export function sampleMove(weighted, legalUci, rng = Math.random) {
  const { candidates, otherProb } = weighted;
  let x = rng();
  for (const c of candidates) {
    if (x < c.prob) return c.move;
    x -= c.prob;
  }
  const known = new Set(candidates.map((c) => c.move));
  const others = legalUci.filter((m) => !known.has(m));
  if (otherProb > 0 && others.length) return others[Math.floor(rng() * others.length)];
  return candidates.length ? candidates[0].move : legalUci[0];
}

export function materialOf(chess) {
  const total = { w: 0, b: 0 };
  for (const row of chess.board()) {
    for (const sq of row) if (sq) total[sq.color] += PIECE_VALUE[sq.type];
  }
  return total;
}

export function uciToMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}

/**
 * Play out a principal variation and report how material changes for the
 * side to move. The horizon is extended while captures are still happening
 * so an exchange is not cut off halfway (up to 6 extra plies).
 */
export function materialOutcome(fen, pv, horizon = 6) {
  const chess = new Chess(fen);
  const mover = chess.turn();
  const diff = () => {
    const m = materialOf(chess);
    return mover === 'w' ? m.w - m.b : m.b - m.w;
  };
  const start = diff();
  const won = [];
  const lost = [];
  const san = [];
  let plies = 0;
  for (const uci of pv) {
    const lastWasCapture = plies > 0 && /x/.test(san[san.length - 1]);
    if (plies >= horizon && !(lastWasCapture && plies < horizon + 6)) break;
    let mv;
    try {
      mv = chess.move(uciToMove(uci));
    } catch {
      break;
    }
    san.push(mv.san);
    if (mv.captured) (mv.color === mover ? won : lost).push(mv.captured);
    if (mv.promotion) (mv.color === mover ? won : lost).push(`=${mv.promotion}`);
    plies++;
  }
  return {
    delta: diff() - start,
    won,
    lost,
    san,
    plies,
    endsInMate: chess.isCheckmate(),
    matedSide: chess.isCheckmate() ? chess.turn() : null,
  };
}

/** Human-readable one-liner for a material outcome. */
export function describeOutcome(outcome, score) {
  if (score && score.mate !== undefined && score.mate > 0) return `Mates in ${score.mate}`;
  if (score && score.mate !== undefined && score.mate < 0) return `Gets mated in ${-score.mate}`;
  const { delta, won, lost } = outcome;
  const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
  const list = (arr) => arr.filter((p) => !p.startsWith('=')).map((p) => names[p]);
  if (delta === 0 && !won.length && !lost.length) return 'No material change';
  if (delta === 0) return 'Even trade';
  const w = list(won);
  const l = list(lost);
  if (delta > 0) {
    if (!l.length && w.length === 1) return `Wins a ${w[0]}`;
    return `Wins ${delta} point${delta === 1 ? '' : 's'}`;
  }
  if (!w.length && l.length === 1) return `Loses a ${l[0]}`;
  return `Loses ${-delta} point${delta === -1 ? '' : 's'}`;
}
