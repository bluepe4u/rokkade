// Discoveries: positions where an opponent answered your opening with a move your library doesn't cover.
// Caught from imported chess.com games and from games played in the terminal, merged per
// (side, position, opponent move), analysed deeply in the background, then studied and added to the library.
import { Chess } from '../../vendor/chess.js';
import { wp, pvToSan, classifyLoss } from './analysis.js';
import { agg, groupBy } from './games.js';
import { moveLabel } from './library.js';

export const MAX_PLY = 24;
export const DOC = 'discoveries';
export const DEPTH = { main: 20, mainTime: 25000, reply: 18, replyTime: 12000, idea: 12, ideaTime: 3000 };

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
export const discoveryId = (side, nodeKey, san) => `${side}-${fnv(`${nodeKey}|${san}`)}`;

/** Compact record of one game behind a discovery. */
function gameRef(x, ply) {
  return {
    id: x.id, t: x.t || 0, src: x.src || 'chess.com', opp: x.opp || '', opR: x.opR ?? null, myR: x.myR ?? null,
    tc: x.tc || '', sc: x.sc ?? null, ex: x.ex ?? null, url: x.url || null, reply: x.sans[ply + 1] || null,
    fam: x.fam && x.fam !== 'Unknown' ? x.fam : null, name: x.name && x.name !== 'Unknown' ? x.name : null,
  };
}

/**
 * Walk games against the library. Returns new items {id, side, path, move, ply, nodeKey, games, firstSeen}
 * (not yet merged with the saved document).
 */
export function catchDiscoveries(lib, games, maxPly = MAX_PLY) {
  const out = new Map();
  for (const x of games) {
    if (!x.sans?.length) continue;
    const w = lib.walk(x.col, x.sans);
    if (w.type !== 'gap' || w.ply >= maxPly) continue;
    const nodeKey = lib.node(x.col, w.node).k;
    const id = discoveryId(x.col, nodeKey, w.san);
    let it = out.get(id);
    if (!it) {
      it = { id, side: x.col, path: x.sans.slice(0, w.ply), move: w.san, ply: w.ply, nodeKey, games: [], firstSeen: x.t || 0 };
      out.set(id, it);
    }
    it.games.push(gameRef(x, w.ply));
    it.firstSeen = Math.min(it.firstSeen || Infinity, x.t || Infinity);
  }
  return [...out.values()];
}

const later = (a, b) => (!a ? b : !b ? a : (b.at || 0) >= (a.at || 0) ? b : a);

/** Merge two discovery records (same id). Games union by id (incoming wins); deeper analysis wins. */
export function mergeItem(a, b) {
  if (!a) return b;
  if (!b) return a;
  const games = new Map(a.games.map((g) => [g.id, g]));
  for (const g of b.games) games.set(g.id, { ...games.get(g.id), ...g, reply: g.reply ?? games.get(g.id)?.reply ?? null });
  const an = !a.analysis ? b.analysis : !b.analysis ? a.analysis
    : (b.analysis.depth > a.analysis.depth || (b.analysis.depth === a.analysis.depth && (b.analysis.at || 0) >= (a.analysis.at || 0))) ? b.analysis : a.analysis;
  return {
    ...a, ...b,
    path: a.path || b.path,
    games: [...games.values()].sort((p, q) => p.t - q.t),
    analysis: an || null,
    studied: later(a.studied, b.studied) || null,
    dismissed: later(a.dismissed, b.dismissed) || null,
    firstSeen: Math.min(a.firstSeen || Infinity, b.firstSeen || Infinity) === Infinity ? 0 : Math.min(a.firstSeen || Infinity, b.firstSeen || Infinity),
  };
}

export function mergeDocs(a, b) {
  const items = { ...(a?.items || {}) };
  for (const [id, it] of Object.entries(b?.items || {})) items[id] = mergeItem(items[id], it);
  return { v: 1, items };
}

/** Do the analysed replies cover every reply now in the games? */
function analysisCurrent(it, target = DEPTH.main) {
  const a = it.analysis;
  if (!a || a.depth < Math.min(target, a.target || target)) return false;
  return replyMoves(it).every((s) => a.replies?.[s]);
}

export function statusOf(it, target) {
  if (it.studied && !it.studied.undone) return 'studied';
  if (it.dismissed && !it.dismissed.undone) return 'dismissed';
  return analysisCurrent(it, target) ? 'ready' : 'new';
}

export const replyMoves = (it) => [...new Set(it.games.map((g) => g.reply).filter(Boolean))];

/** Everything the UI shows for one discovery, derived from the stored record. */
export function summarize(it, target) {
  const status = statusOf(it, target);
  const a = agg(it.games);
  const groups = [...groupBy(it.games.filter((g) => g.reply), (g) => g.reply)].map(([san, gs]) => {
    const r = it.analysis?.replies?.[san] || null;
    return { san, games: gs, n: gs.length, a: agg(gs), eval: r };
  }).sort((p, q) => q.n - p.n);
  const usual = groups[0] || null;
  const shortfall = Math.max(0, a.ex - a.sc);
  const last = it.games.reduce((m, g) => Math.max(m, g.t || 0), 0);
  const names = [...groupBy(it.games.filter((g) => g.fam), (g) => g.fam)].sort((p, q) => q[1].length - p[1].length);
  return {
    ...it, status, a, groups, usual, last, n: it.games.length, opening: names[0]?.[0] || null,
    label: `${moveLabel(it.ply)}${it.move}`,
    impact: it.games.length * (1 + 2 * shortfall) + (usual?.eval?.loss >= 10 ? 2 : 0),
  };
}

export const fenOf = (it) => { const c = new Chess(); for (const s of [...it.path, it.move]) c.move(s); return c.fen(); };

/**
 * Deep analysis of one discovery (the position after the opponent's move; you are to move).
 * Win chances are from your side. Returns the `analysis` record or null when cancelled.
 */
export async function analyseDiscovery(queue, it, opt = DEPTH, onProgress) {
  const fen = fenOf(it);
  const c = new Chess(fen);
  if (c.isGameOver()) return { depth: opt.main, target: opt.main, at: Date.now(), fen, lines: [], replies: {}, idea: [], over: true };
  onProgress?.({ stage: 'main', depth: 0 });
  const r = await queue.go(fen, { depth: opt.main, multipv: Math.min(4, c.moves().length), movetime: opt.mainTime, onUpdate: (ls) => onProgress?.({ stage: 'main', depth: ls[0]?.depth || 0 }) });
  if (!r) return null;
  const lines = r.lines.map((l) => {
    const pv = pvToSan(fen, l.pv, 10);
    return { uci: l.pv[0], san: pv[0], pv, score: l.score, wp: +wp(l.score).toFixed(1), depth: l.depth };
  }).filter((l) => l.san);
  const bestWp = lines[0]?.wp ?? 50;
  const replies = {};
  for (const san of replyMoves(it)) {
    const inLines = lines.find((l) => l.san === san);
    let w;
    let pv;
    let depth;
    if (inLines) {
      w = inLines.wp; pv = inLines.pv; depth = inLines.depth;
    } else {
      const c2 = new Chess(fen);
      let mv;
      try { mv = c2.move(san); } catch { continue; }
      if (c2.isCheckmate()) { w = 100; pv = [mv.san]; depth = 0; }
      else if (c2.isDraw()) { w = 50; pv = [mv.san]; depth = 0; }
      else {
        onProgress?.({ stage: 'reply', san });
        const r2 = await queue.go(c2.fen(), { depth: opt.reply, movetime: opt.replyTime });
        if (!r2) return null;
        w = 100 - wp(r2.score);
        pv = [mv.san, ...pvToSan(c2.fen(), r2.pv, 8)];
        depth = r2.depth;
      }
    }
    const loss = Math.max(0, bestWp - w);
    replies[san] = { wp: +w.toFixed(1), loss: +loss.toFixed(1), cls: classifyLoss(loss, san === lines[0]?.san), pv, depth };
  }
  // The engine's idea: evaluations along its main line (for the sparkline), your side's view.
  const idea = [{ san: null, wp: bestWp }];
  const ic = new Chess(fen);
  for (const san of (lines[0]?.pv || []).slice(0, 6)) {
    ic.move(san);
    if (ic.isGameOver()) { idea.push({ san, wp: ic.isCheckmate() ? (ic.turn() === it.side ? 0 : 100) : 50 }); break; }
    onProgress?.({ stage: 'idea', san });
    const ri = await queue.go(ic.fen(), { depth: opt.idea, movetime: opt.ideaTime });
    if (!ri) return null;
    const w = wp(ri.score);
    idea.push({ san, wp: +(ic.turn() === it.side ? w : 100 - w).toFixed(1) });
  }
  return { depth: r.depth || opt.main, target: opt.main, at: Date.now(), fen, lines, replies, idea };
}

/**
 * The line to add once a discovery is studied: the path, their move, your chosen answer and the
 * engine's continuation (up to two more moves each, so it ends on your move).
 */
export function studiedLine(it, chosenSan) {
  const a = it.analysis;
  const list = [...it.path, it.move, chosenSan];
  const src = a?.replies?.[chosenSan]?.pv || a?.lines?.find((l) => l.san === chosenSan)?.pv || [chosenSan];
  const c = new Chess();
  for (const s of list) c.move(s);
  for (const s of src.slice(1, 3)) {
    try { c.move(s); list.push(s); } catch { break; }
  }
  return list;
}
