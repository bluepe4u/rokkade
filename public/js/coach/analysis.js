// Engine work for the Coach: a queued Stockfish adapter, move classes, game review and Insights.
import { Chess } from '../../vendor/chess.js';
import { winPct, moveAccuracy } from '../solver.js';

export const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PN = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };

/** Win chance (0-100) for the side to move. */
export const wp = (score) => (score.mate != null ? (score.mate > 0 ? 100 : 0) : winPct(score));

export function uciToSan(fen, uci) {
  const c = new Chess(fen);
  return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
}

/** UCI PV → SAN list (stops at the first move that doesn't apply). */
export function pvToSan(fen, pv, max = 12) {
  const c = new Chess(fen);
  const out = [];
  for (const u of pv.slice(0, max)) {
    try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; }
  }
  return out;
}

export function evalText(score, whiteToMove) {
  if (score.mate != null) { const n = whiteToMove ? score.mate : -score.mate; return `${n > 0 ? 'M' : '−M'}${Math.abs(n)}`; }
  const v = (whiteToMove ? score.cp : -score.cp) / 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
}

/**
 * Serial job queue over one Engine (engine.js allows a single search at a time).
 * go() resolves with {lines, best, score, pv, second, depth}; scores are from the side to move.
 */
export class EngineQueue {
  constructor(engine) {
    this.engine = engine;
    this.tail = Promise.resolve();
    this.epoch = 0;
  }

  go(fen, { depth = 14, multipv = 1, movetime = 0, onUpdate } = {}) {
    const epoch = this.epoch;
    const job = this.tail.then(async () => {
      if (epoch !== this.epoch) return null;
      const lines = await this.engine.analyse({ fen, depth, multipv, movetime, onUpdate });
      if (!lines || !lines.length) return null;
      const top = lines[0];
      return { lines, best: top.pv[0], score: top.score, pv: top.pv, second: lines[1] || null, depth: top.depth };
    });
    this.tail = job.catch(() => null);
    return job;
  }

  /** Drop every queued job and stop the running search. */
  clear() {
    this.epoch++;
    this.engine.cancel();
  }
}

// ───────────────────────── move classes ─────────────────────────
export const CLASSES = {
  brilliant: { sym: '!!', label: 'Brilliant', color: 'var(--cl-brilliant)' },
  great: { sym: '!', label: 'Great', color: 'var(--cl-great)' },
  best: { sym: '★', label: 'Best', color: 'var(--cl-best)' },
  excellent: { sym: '✓', label: 'Excellent', color: 'var(--cl-excellent)' },
  good: { sym: '✓', label: 'Good', color: 'var(--cl-good)' },
  book: { sym: 'B', label: 'Book', color: 'var(--cl-book)' },
  forced: { sym: '□', label: 'Forced', color: 'var(--cl-forced)' },
  inaccuracy: { sym: '?!', label: 'Inaccuracy', color: 'var(--cl-inaccuracy)' },
  mistake: { sym: '?', label: 'Mistake', color: 'var(--cl-mistake)' },
  miss: { sym: '×', label: 'Miss', color: 'var(--cl-miss)' },
  blunder: { sym: '??', label: 'Blunder', color: 'var(--cl-blunder)' },
};
export const CLASS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];
export const ERROR_CLASSES = ['inaccuracy', 'mistake', 'blunder', 'miss'];

/** Win-chance loss (points) → class; the same thresholds as Chess Coach. */
export function classify({ loss, best, forced, gap, before, after, sac, prevLoss = 0, inBook }) {
  if (forced) return 'forced';
  if (inBook && loss < 5) return 'book';
  if (prevLoss >= 15 && !best && loss >= 10) return 'miss';
  if (loss >= 15) return 'blunder';
  if (loss >= 10) return 'mistake';
  if (loss >= 5) return 'inaccuracy';
  if (sac && loss < 2 && before < 90 && after >= 35) return 'brilliant';
  if (best && gap != null && gap >= 15 && before < 95) return 'great';
  if (best) return 'best';
  if (loss < 2) return 'excellent';
  return 'good';
}

/** Class for a reply when only its loss is known (Discoveries). */
export const classifyLoss = (loss, isBest) => classify({ loss, best: isBest, before: 50, after: 50 });

export function isSacrifice(c, mv) {
  const v = VAL[mv.piece];
  if (v < 3 || mv.piece === 'k') return false;
  if (v - (mv.captured ? VAL[mv.captured] : 0) < 2) return false;
  const me = mv.color;
  const op = me === 'w' ? 'b' : 'w';
  const at = c.attackers(mv.to, op);
  if (!at.length) return false;
  const low = Math.min(...at.map((s) => VAL[c.get(s).type]));
  return !c.attackers(mv.to, me).length || low < v;
}

function hanging(c, col) {
  let best = null, bv = 0;
  for (const r of c.board()) for (const p of r) {
    if (!p || p.color !== col || p.type === 'k' || VAL[p.type] < 3) continue;
    const op = col === 'w' ? 'b' : 'w';
    if (c.attackers(p.square, op).length && !c.attackers(p.square, col).length && VAL[p.type] > bv) { bv = VAL[p.type]; best = p; }
  }
  return best;
}

export function material(fen, col) {
  let w = 0, b = 0;
  for (const ch of fen.split(' ')[0]) {
    if (/[a-z]/.test(ch)) b += VAL[ch] || 0; else if (/[A-Z]/.test(ch)) w += VAL[ch.toLowerCase()] || 0;
  }
  return col === 'w' ? w - b : b - w;
}
const pieceCount = (fen) => [...fen.split(' ')[0]].filter((c) => /[nbrqNBRQ]/.test(c)).length;

export function accuracyOf(losses) {
  if (!losses.length) return 0;
  const a = losses.map(moveAccuracy);
  const mean = a.reduce((p, v) => p + v, 0) / a.length;
  const har = a.length / a.reduce((p, v) => p + 1 / Math.max(v, 1), 0);
  return (mean + har) / 2;
}

export function fensOf(sans) {
  const c = new Chess();
  const fens = [c.fen()];
  const moves = [];
  for (const s of sans) { moves.push(c.move(s)); fens.push(c.fen()); }
  return { fens, moves };
}

// ───────────────────────── review ─────────────────────────
/**
 * Full-game review. Returns {d, san, ev: [{w (White win %), t, m, best, bs, pv, gap}], cl, loss, acc}
 * or null when cancelled (isCancelled() true).
 */
export async function reviewGame(queue, sans, { depth = 14, bookPlies = 6, tick, isCancelled = () => false } = {}) {
  const { fens, moves } = fensOf(sans);
  const ev = [];
  for (let i = 0; i < fens.length; i++) {
    if (isCancelled()) return null;
    const c = new Chess(fens[i]);
    const wtm = i % 2 === 0;
    if (c.isCheckmate()) { ev.push({ w: wtm ? 0 : 100, t: wtm ? '0-1' : '1-0' }); tick?.(); continue; }
    if (c.isDraw()) { ev.push({ w: 50, t: '½' }); tick?.(); continue; }
    const r = await queue.go(fens[i], { depth, multipv: 2 });
    if (!r) return null;
    const w0 = wp(r.score);
    const pv = pvToSan(fens[i], r.pv, 6);
    ev.push({ w: wtm ? w0 : 100 - w0, t: evalText(r.score, wtm), m: r.score.mate ?? null, best: r.best, bs: pv[0] || null, pv, gap: r.second ? w0 - wp(r.second.score) : null });
    tick?.();
  }
  const cl = [];
  const loss = [];
  let prev = 0;
  for (let i = 0; i < sans.length; i++) {
    const wm = i % 2 === 0;
    const bf = wm ? ev[i].w : 100 - ev[i].w;
    const af = wm ? ev[i + 1].w : 100 - ev[i + 1].w;
    const l = Math.max(0, bf - af);
    const mv = moves[i];
    const forced = new Chess(fens[i]).moves().length === 1;
    const best = !!ev[i].best && mv.from + mv.to + (mv.promotion || '') === ev[i].best;
    cl.push(classify({ loss: l, best, forced, gap: ev[i].gap, before: bf, after: af, sac: isSacrifice(new Chess(fens[i + 1]), mv), prevLoss: prev, inBook: i < bookPlies }));
    loss.push(+l.toFixed(1));
    prev = l;
  }
  return { d: depth, san: sans, ev, cl, loss, acc: { w: +accuracyOf(loss.filter((_, i) => i % 2 === 0)).toFixed(1), b: +accuracyOf(loss.filter((_, i) => i % 2 === 1)).toFixed(1) } };
}

/** Plain-language comment for ply i of a review. */
export function reviewComment(R, i, opening = '') {
  const k = R.cl[i];
  const san = R.san[i];
  const l = R.loss[i];
  const e = R.ev[i];
  const n = R.ev[i + 1];
  const { fens } = fensOf(R.san.slice(0, i + 1));
  const c = new Chess(fens[i + 1]);
  const mover = i % 2 === 0 ? 'w' : 'b';
  const parts = [];
  const better = e.bs && e.bs !== san ? e.bs : null;
  if (k === 'brilliant') parts.push('A sacrifice that holds up: the piece can be taken, and the position stays good.');
  else if (k === 'great') parts.push(`The only good move here. The next-best option was about ${Math.round(e.gap)} points of win chance worse.`);
  else if (k === 'best') parts.push("This is the engine's top choice.");
  else if (k === 'book') parts.push(`A known opening move${opening ? ` in the ${opening}` : ''}.`);
  else if (k === 'forced') parts.push('This was the only legal move.');
  else if (k === 'excellent' || k === 'good') parts.push(`Fine move${better ? `, though ${better} was slightly better` : ''}.`);
  else {
    const nxt = n.bs;
    const h = hanging(c, mover);
    if (k === 'miss') parts.push(`Your opponent had just made a serious error, and this lets them off.${better ? ` ${better} punished it.` : ''}`);
    else parts.push(`This costs about ${Math.round(l)} points of win chance.${better ? ` ${better} was better.` : ''}`);
    if (n.m != null && n.m > 0) parts.push(`It allows mate in ${n.m}.`);
    else if (h && nxt && nxt.includes('x')) parts.push(`It leaves your ${PN[h.type]} on ${h.square} undefended, and ${nxt} follows.`);
    else if (nxt && nxt.includes('x')) parts.push(`The engine's reply is ${nxt}.`);
    if (e.m != null && e.m > 0 && !(n.m != null && n.m < 0)) parts.push(`You had a forced mate in ${e.m}.`);
  }
  return { k, text: parts.join(' '), line: ERROR_CLASSES.includes(k) && e.pv?.length ? e.pv.join(' ') : '' };
}

// ───────────────────────── Insights (batch) ─────────────────────────
/** One game for Insights: blunders, mistakes, missed punishments and material given up. */
export async function insightGame(queue, x, depth, { tick, isCancelled = () => false } = {}) {
  const s = x.sans;
  const { fens } = fensOf(s);
  const clk = (x.g?.pgn || '').match(/%clk/) ? [...(x.g.pgn.matchAll(/%clk (\d+):(\d+):([\d.]+)/g))].map((m) => +m[1] * 3600 + +m[2] * 60 + +m[3]) : [];
  const evals = [];
  const bests = [];
  for (let i = 0; i < fens.length; i++) {
    if (isCancelled()) return null;
    const c = new Chess(fens[i]);
    const wtm = i % 2 === 0;
    if (c.isCheckmate()) { evals.push(wtm ? 0 : 100); bests.push(null); continue; }
    if (c.isDraw()) { evals.push(50); bests.push(null); continue; }
    const r = await queue.go(fens[i], { depth });
    if (!r) return null;
    const w = wp(r.score);
    evals.push(wtm ? w : 100 - w);
    bests.push(r.best);
    tick?.();
  }
  const me = (v) => (x.col === 'w' ? v : 100 - v);
  const out = { u: x.id, col: x.col, moves: 0, loss: 0, bl: [], mi: 0, inacc: 0, missed: [], sac: [], sc: x.sc, url: x.url, d: depth };
  let skip = -1;
  for (let i = 0; i < s.length; i++) {
    if ((i % 2 === 0) !== (x.col === 'w')) continue;
    out.moves++;
    const drop = Math.max(0, me(evals[i]) - me(evals[i + 1]));
    out.loss += drop;
    const mvn = Math.floor(i / 2) + 1;
    let bestSan = null;
    try { if (bests[i]) bestSan = uciToSan(fens[i], bests[i]); } catch { bestSan = null; }
    const phase = mvn <= 10 ? 'Opening' : pieceCount(fens[i]) <= 6 ? 'Endgame' : 'Middlegame';
    if (drop >= 15) out.bl.push({ ply: i, mv: mvn, san: s[i], best: bestSan, drop: Math.round(drop), fen: fens[i], phase, clk: clk[i] ?? null });
    else if (drop >= 10) out.mi++;
    else if (drop >= 5) out.inacc++;
    if (i > 0) {
      const oppDrop = (100 - me(evals[i - 1])) - (100 - me(evals[i]));
      if (oppDrop >= 15 && drop >= 10 && s[i] !== bestSan) out.missed.push({ ply: i, mv: mvn, san: s[i], best: bestSan, drop: Math.round(drop), opp: s[i - 1], fen: fens[i] });
    }
    if (i > skip && i + 3 < fens.length) {
      const net = material(fens[i], x.col) - material(fens[i + 3], x.col);
      if (net >= 2) { skip = i + 2; out.sac.push({ ply: i, mv: mvn, san: s[i], net, drop: Math.round(drop), sound: drop < 10, fen: fens[i], best: bestSan, res: x.sc }); }
    }
  }
  return out;
}

export function insightStats(list, an) {
  const R = list.map((x) => an[x.id]).filter(Boolean);
  if (!R.length) return null;
  const g = R.length;
  let mv = 0, loss = 0, bl = 0, mi = 0, ms = 0, low = 0, clkN = 0;
  const ph = { Opening: 0, Middlegame: 0, Endgame: 0 };
  const first = [], sac = [], blunders = [], missed = [];
  for (const r of R) {
    mv += r.moves; loss += r.loss; bl += r.bl.length; mi += r.mi; ms += r.missed.length;
    for (const b of r.bl) { ph[b.phase]++; if (b.clk != null) { clkN++; if (b.clk < 60) low++; } blunders.push({ ...b, url: r.url, col: r.col, u: r.u }); }
    if (r.bl.length) first.push(r.bl[0].mv);
    for (const s of r.sac) sac.push({ ...s, url: r.url, col: r.col, u: r.u });
    for (const q of r.missed) missed.push({ ...q, url: r.url, col: r.col, u: r.u });
  }
  first.sort((a, b) => a - b);
  return { g, mv, avg: loss / Math.max(1, mv), bl, mi, ms, ph, firstMed: first.length ? first[Math.floor(first.length / 2)] : null, firstAll: first, sac, blunders: blunders.sort((a, b) => b.drop - a.drop), missed: missed.sort((a, b) => b.drop - a.drop), low, clkN, noBl: g - first.length };
}

/** Plies to treat as "book" in a review: the chess.com opening name's length or the library depth. */
export function bookPlies(x, libPly = 0) {
  const slug = (x.g?.eco || '').split('/openings/')[1] || '';
  let n = 0;
  const re = /(?:^|-)(\d+)(\.+)([^-]+)(?:-((?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8][+#]?|O-O(?:-O)?)))?/g;
  let m;
  while ((m = re.exec(slug))) n = +m[1] * 2 - (m[2].length > 1 || m[4] ? 0 : 1);
  return Math.max(n || 6, libPly);
}

// ───────────────────────── reviews feed Insights and the game list ─────────────────────────
export const reviewDocName = (id) => `rv-${String(id).replace(/[^A-Za-z0-9_-]/g, '-').slice(-70)}`;

/** Insights record (same shape as insightGame) computed from a finished review, no extra engine work. */
export function insightFromReview(x, R) {
  const s = R.san;
  const { fens } = fensOf(s);
  const clk = [...((x.g?.pgn || '').matchAll(/%clk (\d+):(\d+):([\d.]+)/g))].map((m) => +m[1] * 3600 + +m[2] * 60 + +m[3]);
  const me = (v) => (x.col === 'w' ? v : 100 - v);
  const out = { u: x.id, col: x.col, moves: 0, loss: 0, bl: [], mi: 0, inacc: 0, missed: [], sac: [], sc: x.sc, url: x.url, d: R.d, from: 'review' };
  let skip = -1;
  for (let i = 0; i < s.length; i++) {
    if ((i % 2 === 0) !== (x.col === 'w')) continue;
    out.moves++;
    const drop = Math.max(0, me(R.ev[i].w) - me(R.ev[i + 1].w));
    out.loss += drop;
    const mvn = Math.floor(i / 2) + 1;
    const bestSan = R.ev[i].bs || null;
    const phase = mvn <= 10 ? 'Opening' : pieceCount(fens[i]) <= 6 ? 'Endgame' : 'Middlegame';
    if (drop >= 15) out.bl.push({ ply: i, mv: mvn, san: s[i], best: bestSan, drop: Math.round(drop), fen: fens[i], phase, clk: clk[i] ?? null });
    else if (drop >= 10) out.mi++;
    else if (drop >= 5) out.inacc++;
    if (i > 0) {
      const oppDrop = (100 - me(R.ev[i - 1].w)) - (100 - me(R.ev[i].w));
      if (oppDrop >= 15 && drop >= 10 && s[i] !== bestSan) out.missed.push({ ply: i, mv: mvn, san: s[i], best: bestSan, drop: Math.round(drop), opp: s[i - 1], fen: fens[i] });
    }
    if (i > skip && i + 3 < fens.length) {
      const net = material(fens[i], x.col) - material(fens[i + 3], x.col);
      if (net >= 2) { skip = i + 2; out.sac.push({ ply: i, mv: mvn, san: s[i], net, drop: Math.round(drop), sound: drop < 10, fen: fens[i], best: bestSan, res: x.sc }); }
    }
  }
  return out;
}

/** Compact facts about a review for lists: accuracy, an eval sparkline and move-class counts per side. */
export function reviewSummary(R) {
  const n = R.ev.length;
  const step = Math.max(1, Math.ceil(n / 40));
  const spark = R.ev.filter((_, i) => i % step === 0 || i === n - 1).map((e) => Math.round(e.w));
  const c = { w: {}, b: {} };
  R.cl.forEach((k, i) => { const side = i % 2 ? 'b' : 'w'; c[side][k] = (c[side][k] || 0) + 1; });
  return { w: R.acc.w, b: R.acc.b, s: spark, c, d: R.d };
}

/** Accuracy per phase for one side: {Opening, Middlegame, Endgame} (null where the side made no move). */
export function phaseAccuracy(R, col) {
  const { fens } = fensOf(R.san);
  const buckets = { Opening: [], Middlegame: [], Endgame: [] };
  R.loss.forEach((l, i) => {
    if ((i % 2 === 0) !== (col === 'w')) return;
    const mvn = Math.floor(i / 2) + 1;
    buckets[mvn <= 10 ? 'Opening' : pieceCount(fens[i]) <= 6 ? 'Endgame' : 'Middlegame'].push(l);
  });
  return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length ? +accuracyOf(v).toFixed(1) : null]));
}
