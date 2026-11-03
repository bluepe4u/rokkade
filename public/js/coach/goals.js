// Goals with projections, and the weekly summary.
import { dayKey, addDays, dayTotal, KINDS, streak } from './progress.js';
import { agg } from './games.js';

export const GOAL_TYPES = {
  rating: { label: 'Reach a rating', unit: '' },
  accuracy: { label: 'Average accuracy (last 10 reviewed games)', unit: '%' },
  puzzles: { label: 'Puzzles solved', unit: '' },
  streak: { label: 'Practice streak', unit: ' days' },
};

const DAY = 86400;
/** Least-squares slope (value per day) of [{t, v}]. */
function slope(pts) {
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.t, 0) / n;
  const my = pts.reduce((s, p) => s + p.v, 0) / n;
  const num = pts.reduce((s, p) => s + (p.t - mx) * (p.v - my), 0);
  const den = pts.reduce((s, p) => s + (p.t - mx) ** 2, 0);
  return den ? (num / den) * DAY : null;
}

/**
 * ctx: {games, idx (review index), acc (raw → calibrated), prog, now}
 * → {current, start, target, pct, series, perDay, eta (Date|null), onTrack (bool|null), done}
 */
export function goalProgress(goal, { games = [], idx = {}, acc = (v) => v, prog, now = Date.now() / 1000 }) {
  let series = [];
  let current = null;
  if (goal.type === 'rating') {
    const L = games.filter((x) => x.tc === goal.tc && x.myR);
    series = L.filter((x) => now - x.t < 120 * DAY).map((x) => ({ t: x.t, v: x.myR }));
    current = L.at(-1)?.myR ?? null;
  } else if (goal.type === 'accuracy') {
    const L = games.filter((x) => idx[x.id]);
    const vals = L.map((x) => ({ t: x.t, v: acc(idx[x.id][x.col]) }));
    series = vals.map((p, i) => ({ t: p.t, v: vals.slice(Math.max(0, i - 9), i + 1).reduce((s, q) => s + q.v, 0) / Math.min(10, i + 1) })).slice(-60);
    current = series.at(-1)?.v ?? null;
  } else if (goal.type === 'puzzles') {
    const firsts = Object.entries(prog.srs).filter(([k, e]) => k.startsWith('pz|') && e.reps > 0).map(([, e]) => e.first).sort();
    let n = 0;
    series = firsts.map((d) => ({ t: new Date(`${d}T12:00:00`).getTime() / 1000, v: ++n }));
    current = n;
  } else if (goal.type === 'streak') {
    current = streak(prog, new Set(games.map((x) => dayKey(new Date(x.t * 1000)))));
  }
  const start = goal.start?.v ?? current ?? 0;
  const target = goal.target;
  const span = target - start;
  const pct = current == null ? 0 : span === 0 ? 1 : Math.max(0, Math.min(1, (current - start) / span));
  const done = current != null && (span >= 0 ? current >= target : current <= target);
  const recent = series.filter((p) => now - p.t < 60 * DAY);
  const perDay = goal.type === 'streak' ? 1 : slope(recent);
  let eta = null;
  if (!done && perDay && current != null && Math.sign(perDay) === Math.sign(target - current)) eta = new Date((now + ((target - current) / perDay) * DAY) * 1000);
  const by = goal.by ? new Date(`${goal.by}T23:59:59`) : null;
  const onTrack = done ? true : eta && by ? eta <= by : by ? false : null;
  return { current, start, target, pct, series, perDay, eta, onTrack, done, by };
}

/** This week (Monday-based) vs the week before: practice, games, rating, accuracy, best game. */
export function weekSummary({ games = [], idx = {}, acc = (v) => v, prog }, today = dayKey()) {
  const d = new Date(`${today}T12:00:00`);
  const monday = addDays(today, -((d.getDay() + 6) % 7));
  const span = (from, to) => {
    const days = [];
    for (let k = from; k <= to; k = addDays(k, 1)) days.push(k);
    const practice = Object.fromEntries(KINDS.map((k) => [k, days.reduce((s, day) => s + (prog.days[day]?.[k] || 0), 0)]));
    const active = days.filter((day) => dayTotal(prog.days[day]) > 0).length;
    const t0 = new Date(`${from}T00:00:00`).getTime() / 1000;
    const t1 = new Date(`${to}T23:59:59`).getTime() / 1000;
    const G = games.filter((x) => x.t >= t0 && x.t <= t1);
    const reviewed = G.filter((x) => idx[x.id]);
    const accs = reviewed.map((x) => acc(idx[x.id][x.col]));
    const byTc = new Map();
    for (const x of G) { const a = byTc.get(x.tc) || []; a.push(x); byTc.set(x.tc, a); }
    const main = [...byTc].sort((a, b) => b[1].length - a[1].length)[0];
    let ratingChange = null;
    if (main) {
      const before = games.filter((x) => x.tc === main[0] && x.t < t0).at(-1);
      const last = main[1].at(-1);
      if (before && last) ratingChange = { tc: main[0], from: before.myR, to: last.myR, delta: last.myR - before.myR };
    }
    const best = reviewed.filter((x) => x.sc === 1).sort((a, b) => idx[b.id][b.col] - idx[a.id][a.col])[0] || null;
    const learned = Object.entries(prog.srs).filter(([k, e]) => (k.startsWith('w|') || k.startsWith('b|')) && e.reps > 0 && e.first >= from && e.first <= to).length;
    return { from, to, practice, active, games: G.length, score: agg(G), accuracy: accs.length ? accs.reduce((s, v) => s + v, 0) / accs.length : null, ratingChange, best, learned };
  };
  return { now: span(monday, today), prev: span(addDays(monday, -7), addDays(monday, -1)) };
}
