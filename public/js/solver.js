// The solver: combines Maia-2 (how likely is a human of this Elo to play each
// move?) with Stockfish (how much does each move cost?) into one move
// distribution, and measures what each line does to the material balance.
//
//   q(m) = Maia(m | elo)^alpha            human prior (alpha < 1 flattens it, e.g. below
//                                         Maia's trained range; alpha -> 0 hands over to the engine)
//   s(m) = exp(-winLoss(m) / tau)         soundness: win-% points lost against the best move
//   g    = sum_m Maia(m) * s(m)           how likely a typical player of this Elo is to find
//                                         a sound move in THIS position
//   beta = cap(elo) * g^kappa             how strictly the engine vetoes unsound moves
//   p(m) ~ q(m) * s(m)^beta
//
// Where good moves are easy to find (g high) bad moves are pruned; where the sound
// moves are ones a typical player would miss (g low) beta collapses and Maia's
// own, human, mistakes come through. Errors therefore cluster in the positions
// where players of that rating actually go wrong, instead of being sprinkled
// at random.
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

// ───────────────────────── per-Elo parameters ─────────────────────────
// Maia-2 was trained on rated Lichess games and only distinguishes ratings from
// "<1100" to ">=2000". Between 1100 and 2000 it is used as is. Outside that range
// the curves below extrapolate: below 1100 the human prior is flattened and the
// engine's veto weakened (more, and more random, mistakes); above 2000 the prior
// fades out and the engine's veto tightens until, near 3000, it plays the top
// engine moves. tools/calibrate.mjs measures the resulting self-play accuracy.
const ANCHORS = {
  elo:     [0,    500,  1000, 1500, 2000, 2500, 3000],
  alpha:   [0.35, 0.6,  0.95, 1,    1,    0.6,  0.2],
  tau:     [8,    8,    7,    6,    5,    2,    0.5],   // win-% points
  betaCap: [0,    0.3,  0.6,  0.8,  1,    1,    1],
  kappa:   [1,    1,    1,    1,    1,    0.4,  0],
};

function interpolate(ys, elo, log = false) {
  const xs = ANCHORS.elo;
  if (elo <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (elo <= xs[i]) {
      const t = (elo - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return log
        ? Math.exp(Math.log(ys[i - 1]) + t * (Math.log(ys[i]) - Math.log(ys[i - 1])))
        : ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

// Engine-only fallback (Maia-2 not available): softmax over win-% loss. These
// temperatures come from the earlier self-play calibration of that model.
const ENGINE_ONLY_TAU = [150, 80, 25, 12, 4.5, 2.5, 0.7];

/**
 * Everything derived from one number, the Elo. `humanness` (advanced, default 1)
 * scales how much room Maia's human errors get: above 1 = more human slips,
 * below 1 = the engine vetoes more strictly.
 */
export function playerModel(elo, { humanness = 1, maia = true } = {}) {
  const e = Math.min(ELO_MAX, Math.max(ELO_MIN, elo));
  const h = Math.max(0.05, humanness);
  const m = {
    elo: e,
    maia,
    alpha: interpolate(ANCHORS.alpha, e),
    tau: interpolate(ANCHORS.tau, e, true),
    betaCap: Math.min(1, interpolate(ANCHORS.betaCap, e) / h),
    kappa: interpolate(ANCHORS.kappa, e),
  };
  if (!maia) {
    Object.assign(m, { alpha: 0, tau: interpolate(ENGINE_ONLY_TAU, e, true) * h, betaCap: 1, kappa: 0 });
  }
  return m;
}

/** How hard Stockfish looks. Weaker players are judged shallowly (the judge only needs to
 *  spot what a human of that level would also be punished for); strong ones need depth. */
export function searchBudget(elo, legalCount) {
  const t = Math.max(0, (Math.min(elo, ELO_MAX) - 2000) / 1000);
  return {
    depth: Math.round(10 + 6 * t),
    movetime: Math.round(1500 + 2000 * t),
    // Score every legal move (the human prior needs the whole list); only the very
    // strongest levels, where the prior has faded, settle for the best dozen.
    multipv: elo >= 2300 ? Math.min(legalCount, 12) : legalCount,
  };
}

// ───────────────────────── evaluation helpers ─────────────────────────
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

// Win-% loss assumed for legal moves the engine did not score (only at the top levels).
const UNLISTED_MIN_LOSS = 15;

/**
 * Combine the engine's lines with Maia-2's move probabilities.
 *
 * @param {Array<{score, pv, depth?}>} lines Stockfish MultiPV lines
 * @param {Map<string, number>|null} prior Maia-2 probability per legal move (null = engine only)
 * @param {string[]} legalUci every legal move
 * @param {ReturnType<typeof playerModel>} model
 * @returns {{candidates: Array, soundMass: number, beta: number, expectedAccuracy: number, humanAccuracy: number}}
 *   candidates: one entry per legal move, sorted by final probability. `pv`/`score` are
 *   missing on moves the engine did not score.
 */
export function blendMoves(lines, prior, legalUci, model) {
  if (!legalUci.length) return { candidates: [], soundMass: 1, beta: 1, expectedAccuracy: 100, humanAccuracy: 100 };
  const byMove = new Map(lines.map((l) => [l.pv[0], l]));
  const wins = lines.map((l) => winPct(l.score));
  const cps = lines.map((l) => scoreToCp(l.score));
  const bestWin = lines.length ? Math.max(...wins) : 50;
  const bestCp = lines.length ? Math.max(...cps) : 0;
  const lossOf = new Map(lines.map((l, i) => [l.pv[0], bestWin - wins[i]]));
  const cpOf = new Map(lines.map((l, i) => [l.pv[0], cps[i]]));
  const worstListed = lines.length ? Math.max(...lossOf.values()) : 0;

  const uniform = 1 / legalUci.length;
  const human = legalUci.map((m) => (prior ? prior.get(m) ?? 0 : uniform));
  const loss = legalUci.map((m) => lossOf.get(m) ?? Math.max(UNLISTED_MIN_LOSS, worstListed));
  const tieBreak = legalUci.map((m) => (cpOf.has(m) ? (bestCp - cpOf.get(m)) * 1e-4 : 0));
  const tau = Math.max(model.tau, 1e-6);
  const sound = loss.map((l, i) => Math.exp(-(l + tieBreak[i]) / tau));

  const soundMass = human.reduce((a, p, i) => a + p * sound[i], 0);
  const beta = Math.min(1, model.betaCap * Math.pow(Math.max(soundMass, 1e-9), model.kappa));
  const weights = human.map((p, i) => {
    const prior_ = model.alpha > 0 ? Math.pow(Math.max(p, 1e-9), model.alpha) : 1;
    return prior_ * Math.pow(sound[i], beta);
  });
  const total = weights.reduce((a, b) => a + b, 0);

  const candidates = legalUci.map((move, i) => {
    const line = byMove.get(move);
    return {
      move,
      ...(line || {}),
      listed: !!line,
      prob: weights[i] / total,
      human: prior ? human[i] : null,
      loss: loss[i],
      accuracy: moveAccuracy(loss[i]),
      cp: cpOf.get(move),
    };
  }).sort((a, b) => b.prob - a.prob);
  const expectedAccuracy = candidates.reduce((a, c) => a + c.prob * c.accuracy, 0);
  const humanAccuracy = prior ? human.reduce((a, p, i) => a + p * moveAccuracy(loss[i]), 0) : expectedAccuracy;
  return { candidates, soundMass, beta, expectedAccuracy, humanAccuracy };
}

/** Sample a move (UCI string) from blended candidates. */
export function sampleMove(blended, rng = Math.random) {
  let x = rng();
  for (const c of blended.candidates) {
    if (x < c.prob) return c.move;
    x -= c.prob;
  }
  return blended.candidates[0].move;
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
