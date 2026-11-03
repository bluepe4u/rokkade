// Progress on known positions: for each position you are working on (an opponent surprise from
// Discoveries, or a spot where you leave your library), how your games from it went before and
// after you started working on it, what work you put in, and which way it is going.
import { agg, fit } from './games.js';
import { moveLabel, sanLine } from './library.js';
import { puzzleKey } from './progress.js';

const prefixMatch = (sans, pre) => sans.length > pre.length && pre.every((s, i) => sans[i] === s);
const DAY = 86400;

function workOn(side, pre, prog, puzzlesById, gameIds) {
  const key = `${side}|${pre.join(' ')}`;
  let drills = 0;
  let first = null;
  let last = null;
  for (const [k, e] of Object.entries(prog.srs)) {
    if (k.startsWith('pz|') || !(k === key || k.startsWith(`${key} `))) continue;
    drills += (e.reps || 0) + (e.lapses || 0);
    if (!first || e.first < first) first = e.first;
    if (!last || (e.at || 0) > last) last = e.at || 0;
  }
  let puzzles = 0;
  for (const [id, p] of puzzlesById) {
    if (!gameIds.has(p.gid)) continue;
    const e = prog.srs[puzzleKey(id)];
    if (!e) continue;
    puzzles += (e.reps || 0) + (e.lapses || 0);
    if (!first || e.first < first) first = e.first;
  }
  return { drills, puzzles, firstDay: first, last };
}

const dayToT = (k) => (k ? new Date(`${k}T00:00:00`).getTime() / 1000 : null);

function trend(L, startT) {
  const sorted = L.slice().sort((a, b) => a.t - b.t);
  let before;
  let after;
  if (startT) {
    before = sorted.filter((x) => x.t < startT);
    after = sorted.filter((x) => x.t >= startT);
  } else {
    const half = Math.floor(sorted.length / 2);
    before = sorted.slice(0, half);
    after = sorted.slice(half);
  }
  const a = agg(before);
  const b = agg(after);
  const delta = a.n && b.n ? b.sc - a.sc : null;
  // rolling score of the last 5 games, for the sparkline
  const roll = sorted.filter((x) => x.sc != null).map((_, i, arr) => { const w = arr.slice(Math.max(0, i - 4), i + 1); return w.reduce((s, g) => s + g.sc, 0) / w.length; });
  let status = 'new';
  if (b.n >= 2 && a.n >= 2) status = delta >= 0.1 ? 'improving' : delta <= -0.1 ? 'slipping' : 'steady';
  else if (sorted.length >= 2) status = 'early';
  return { before: a, after: b, delta, roll, all: agg(sorted), n: sorted.length, last: sorted.at(-1)?.t || 0 };
}

/**
 * tracked positions: [{id, kind ('surprise'|'habit'), side, pre (SAN list), label, title, games, work, trend, status}]
 */
export function trackedPositions({ games = [], discoveries = [], lib, prog, puzzles = [] }) {
  const pzById = new Map(puzzles.map((p) => [p.id, p]));
  const out = [];
  for (const d of discoveries) {
    if (d.status === 'dismissed') continue;
    const pre = [...d.path, d.move];
    const L = games.filter((x) => x.col === d.side && prefixMatch(x.sans, pre));
    for (const g of d.games) if (g.src === 'terminal' && !L.some((x) => x.id === g.id)) L.push({ ...g, sans: pre });
    if (L.length < 2) continue;
    const ids = new Set(L.map((x) => x.id));
    const work = workOn(d.side, pre, prog, pzById, ids);
    const studiedT = d.studied && !d.studied.undone ? d.studied.at / 1000 : null;
    const startT = [studiedT, dayToT(work.firstDay)].filter(Boolean).sort((a, b) => a - b)[0] || null;
    out.push({ id: d.id, kind: 'surprise', side: d.side, pre, label: `${moveLabel(pre.length - 1)}${d.move}`, title: d.opening || null, line: sanLine(pre), games: L, studied: !!studiedT, work, startT, ...trend(L, startT), href: `#discoveries/${d.id}` });
  }
  if (lib && games.length) {
    for (const h of fit(lib, games).hab.slice(0, 6)) {
      if (h.L.length < 3) continue;
      const pre = h.path;
      const L = games.filter((x) => x.col === h.col && x.sans.length > pre.length && pre.every((s, i) => x.sans[i] === s));
      const ids = new Set(L.map((x) => x.id));
      const work = workOn(h.col, pre, prog, pzById, ids);
      const startT = dayToT(work.firstDay);
      out.push({ id: `hab-${h.col}-${pre.join('.')}`, kind: 'habit', side: h.col, pre, label: pre.length ? `after ${moveLabel(pre.length - 1)}${pre.at(-1)}` : 'move 1', title: `You often play ${moveLabel(h.ply)}${h.san} here`, line: sanLine(pre) || 'Start position', games: L, studied: false, work, startT, ...trend(L, startT), href: `#library/${h.col}/${encodeURIComponent(pre.join(','))}/drill` });
    }
  }
  for (const p of out) {
    const worked = p.studied || p.work.drills || p.work.puzzles;
    p.worked = !!worked;
    p.status = p.before.n >= 2 && p.after.n >= 2 ? (p.delta >= 0.1 ? 'improving' : p.delta <= -0.1 ? 'slipping' : 'steady') : 'early';
    p.days = p.startT ? Math.max(0, Math.round((Date.now() / 1000 - p.startT) / DAY)) : null;
  }
  return out.sort((a, b) => (b.worked - a.worked) || (b.n - a.n));
}
