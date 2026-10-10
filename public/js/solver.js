// Elo-weighted move selection and material-outcome analysis.
//
// Stockfish ranks the candidate moves (MultiPV). A player of a given Elo is
// modelled as:
//   * searching to an Elo-dependent depth,
//   * choosing among the candidates with a softmax over centipawn loss, where
//     the temperature shrinks as Elo grows (a 3000 player almost always picks
//     the top move, a 400 player happily drops a pawn or two),
//   * occasionally "blundering" — playing any legal move uniformly at random.
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

/**
 * Derive the search/selection parameters for an Elo.
 * @param {number} elo 0..3000
 * @param {{randomness?: number, depth?: number}} opts depth 0 = derive from Elo
 */
export function eloParams(elo, { randomness = 1, depth = 0 } = {}) {
  const e = Math.min(ELO_MAX, Math.max(ELO_MIN, elo));
  const r = Math.max(0, randomness);
  const autoDepth = Math.round(1 + 17 * Math.pow(e / ELO_MAX, 1.3));
  return {
    elo: e,
    depth: depth > 0 ? depth : autoDepth,
    // Softmax temperature in centipawns: 400cp @0, ~76 @1000, ~14 @2000, ~3 @3000.
    temperature: Math.max(0.5, 400 * Math.exp(-e / 600)) * r,
    // Probability of a random legal move: 25% @0, ~3% @1000, ~0.5% @2000.
    blunder: Math.min(0.6, 0.25 * Math.exp(-e / 500) * r),
  };
}

/** Score (from side-to-move POV) as a single comparable centipawn number. */
export function scoreToCp(score) {
  if (score.mate !== undefined) {
    if (score.mate === 0) return -MATE_CP;
    return Math.sign(score.mate) * (MATE_CP - Math.abs(score.mate) * 100);
  }
  return score.cp;
}

export function formatScore(score, povSign = 1) {
  if (score.mate !== undefined) {
    const m = score.mate * povSign;
    return m === 0 ? '#' : `${m > 0 ? '' : '−'}M${Math.abs(m)}`;
  }
  const v = (score.cp * povSign) / 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
}

/**
 * Attach Elo-weighted selection probabilities to engine lines.
 * @param {Array<{score, pv}>} lines engine lines (best first)
 * @param {number} legalCount number of legal moves in the position
 * @param {{temperature:number, blunder:number}} params from eloParams()
 * @returns {{candidates: Array, otherProb: number}}
 */
export function weighCandidates(lines, legalCount, params) {
  if (!lines.length) return { candidates: [], otherProb: 0 };
  const values = lines.map((l) => scoreToCp(l.score));
  const best = Math.max(...values);
  const T = Math.max(params.temperature, 1e-6);
  const weights = values.map((v) => Math.exp(-(best - v) / T));
  const total = weights.reduce((a, b) => a + b, 0);
  const n = Math.max(legalCount, lines.length);
  const blunder = n > 1 ? params.blunder : 0;
  const candidates = lines.map((l, i) => ({
    ...l,
    move: l.pv[0],
    cp: values[i],
    loss: best - values[i],
    prob: (1 - blunder) * (weights[i] / total) + blunder / n,
  }));
  const otherProb = Math.max(0, 1 - candidates.reduce((a, c) => a + c.prob, 0));
  return { candidates, otherProb };
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
