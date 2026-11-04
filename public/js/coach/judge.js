// Lichess-style move judging for puzzles and training: any move that keeps (nearly) as much as
// the best move counts, not only the one stored solution. Also gives the engine's best reply to
// the move actually played, so a puzzle can continue down your line.
import { Chess } from '../../vendor/chess.js';
import { wp } from './analysis.js';
import { interactiveQueue } from './review.js';

const uciMove = (fen, u) => new Chess(fen).move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

/**
 * fen: position before the move; san: the move played (legal there).
 * expected: the stored solution move (accepted at once, no engine needed).
 * tolerance: win-chance points the move may give up against the best move.
 * → {ok, exact, bestSan, loss, reply (engine's best answer to the played move, as a chess.js move) | null}
 */
export async function judgeMove(fen, san, { expected = null, tolerance = 3, depth = 12 } = {}) {
  const q = interactiveQueue();
  const after = new Chess(fen);
  after.move(san);
  const exact = expected != null && san === expected;
  if (after.isCheckmate()) return { ok: true, exact, bestSan: exact ? san : null, loss: 0, reply: null, mate: true };
  if (exact && !after.isGameOver()) {
    const r1 = await q.go(after.fen(), { depth: Math.min(depth, 10) });
    return { ok: true, exact: true, bestSan: san, loss: 0, reply: r1 ? uciMove(after.fen(), r1.best) : null };
  }
  const r0 = await q.go(fen, { depth, multipv: 1 });
  if (!r0) return { ok: false, exact: false, bestSan: expected, loss: 100, reply: null };
  const bestSan = uciMove(fen, r0.best).san;
  const before = wp(r0.score);
  if (after.isDraw()) { const loss = Math.max(0, before - 50); return { ok: loss <= tolerance, exact: false, bestSan, loss, reply: null }; }
  const r1 = await q.go(after.fen(), { depth });
  if (!r1) return { ok: false, exact: false, bestSan, loss: 100, reply: null };
  const loss = Math.max(0, before - (100 - wp(r1.score)));
  return { ok: san === bestSan || loss <= tolerance, exact: san === bestSan, bestSan, loss, reply: uciMove(after.fen(), r1.best) };
}

/** The engine's best move in a position (for hints). */
export async function bestMove(fen, depth = 14) {
  const r = await interactiveQueue().go(fen, { depth });
  return r ? uciMove(fen, r.best) : null;
}
