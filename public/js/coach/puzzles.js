// Puzzles built from your own games: every blunder you made ("find the better move") and every
// opponent blunder you didn't punish ("punish it"), from the background reviews. Scheduled with
// spaced repetition and ordered toward your current weak spots.
import { Chess } from '../../vendor/chess.js';
import { VAL } from './analysis.js';
import { dayKey, puzzleKey } from './progress.js';

export const NEW_PUZZLES_PER_DAY = 6;
export const KIND = {
  punish: { label: 'Punish the mistake', prompt: (p) => `Your opponent just played ${p.opp}. It was a serious mistake: punish it.` },
  blunder: { label: 'Find the better move', prompt: (p) => `In the game you played ${p.played} here and lost ${p.drop} points of win chance. Find a better move.` },
};

/** A simple motif label for the solution's first move. */
export function motif(fen, san) {
  const c = new Chess(fen);
  let mv;
  try { mv = c.move(san); } catch { return 'Quiet move'; }
  if (c.isCheckmate()) return 'Mate';
  const me = mv.color;
  const op = me === 'w' ? 'b' : 'w';
  // Pieces of value ≥ 3 (or the king) attacked by the moved piece afterwards: a double attack.
  let hits = 0;
  for (const row of c.board()) for (const p of row) {
    if (!p || p.color !== op || (p.type !== 'k' && VAL[p.type] < 3)) continue;
    if (c.attackers(p.square, me).includes(mv.to)) hits++;
  }
  if (hits >= 2) return 'Double attack';
  if (mv.captured && VAL[mv.captured] >= 3) return 'Win material';
  if (mv.san.includes('+')) return 'Check';
  if (mv.captured) return 'Capture';
  return 'Quiet move';
}

/** Puzzles from the Insights records of reviewed games. games: prepped games (for names and dates). */
export function buildPuzzles(games, an) {
  const out = [];
  for (const x of games) {
    const r = an[x.id];
    if (!r) continue;
    for (const b of r.bl || []) {
      if (!b.best || b.best === b.san) continue;
      out.push({ id: `${x.id}|${b.ply}`, gid: x.id, ply: b.ply, fen: b.fen, best: b.best, played: b.san, kind: 'blunder', drop: b.drop, phase: b.phase, col: x.col, t: x.t, opp: x.opp, fam: x.fam, theme: motif(b.fen, b.best) });
    }
    for (const m of r.missed || []) {
      if (!m.best || m.best === m.san) continue;
      if (out.some((p) => p.id === `${x.id}|${m.ply}`)) continue;
      out.push({ id: `${x.id}|${m.ply}`, gid: x.id, ply: m.ply, fen: m.fen, best: m.best, played: m.san, opp: m.opp, oppName: x.opp, kind: 'punish', drop: m.drop, phase: m.mv <= 10 ? 'Opening' : 'Middlegame', col: x.col, t: x.t, fam: x.fam, theme: motif(m.fen, m.best) });
    }
  }
  return out;
}

/** Which puzzles to give first, from the top priority of the Plan. */
export function focusFor(priorityKey) {
  return {
    punish: (p) => p.kind === 'punish',
    blunders: (p) => p.kind === 'blunder',
    endgame: (p) => p.phase === 'Endgame',
    opening: (p) => p.phase === 'Opening',
    king: (p) => p.theme === 'Mate' || p.theme === 'Check',
    sacrifice: (p) => p.kind === 'blunder' && p.theme !== 'Quiet move',
  }[priorityKey] || null;
}

/** Today's queue: due reviews first, then new puzzles (focus first, biggest swings, most recent). */
export function puzzleQueue(puzzles, prog, { focus = null, today = dayKey(), limit = 10 } = {}) {
  const due = [];
  const fresh = [];
  const introduced = Object.entries(prog.srs).filter(([k, e]) => k.startsWith('pz|') && e.first === today).length;
  for (const p of puzzles) {
    const e = prog.srs[puzzleKey(p.id)];
    if (e) { if (e.due <= today) due.push({ ...p, srs: e }); } else fresh.push(p);
  }
  const score = (p) => (focus && focus(p) ? 1000 : 0) + p.drop + (p.t || 0) / 1e8;
  fresh.sort((a, b) => score(b) - score(a));
  due.sort((a, b) => (a.srs.due < b.srs.due ? -1 : 1));
  return [...due, ...fresh.slice(0, Math.max(0, NEW_PUZZLES_PER_DAY - introduced))].slice(0, limit);
}

export function puzzleStats(puzzles, prog) {
  let tried = 0, solved = 0, firstTry = 0;
  for (const p of puzzles) {
    const e = prog.srs[puzzleKey(p.id)];
    if (!e) continue;
    tried++;
    if (e.reps > 0) solved++;
    if (e.reps > 0 && !e.lapses) firstTry++;
  }
  return { total: puzzles.length, tried, solved, firstTry };
}
