// Plans with accountability: one focus, one number to move, daily tasks, a fixed length. The plan is
// judged honestly against your own baseline: no verdict until enough games are in, and a change only
// counts when it is larger than the noise (about two standard errors).
import { addDays, dayKey } from './progress.js';
import { tagsOf, prevInSession } from './journal.js';
import { clockData, parseTC } from './clock.js';

const DAY = 86400;
export const MIN_GAMES = 8;
export const BASELINE_DAYS = 90;
export const BASELINE_MAX = 40;

/**
 * Per-game metrics. value(x, ctx) → number or null (null = game does not count).
 * dir: +1 higher is better, −1 lower is better. kind 'share' values are 0/1.
 */
export const METRICS = {
  trouble: {
    label: 'Games with time trouble', short: 'time-trouble games', dir: -1, kind: 'share',
    value(x) {
      const d = clockData(x);
      if (d.length < 5) return null;
      const tc = parseTC(x.g?.time_control);
      const base = tc?.base || Math.max(...d.map((m) => m.left));
      return Math.min(...d.map((m) => m.left)) < Math.max(10, base * 0.1) ? 1 : 0;
    },
  },
  blunders: { label: 'Blunders per game', short: 'blunders per game', dir: -1, kind: 'mean', value: (x, c) => c.an?.[x.id]?.bl?.length ?? null },
  missed: { label: 'Missed chances per game', short: 'missed chances per game', dir: -1, kind: 'mean', value: (x, c) => c.an?.[x.id]?.missed?.length ?? null },
  accuracy: { label: 'Accuracy', short: 'accuracy', dir: 1, kind: 'mean', value: (x, c) => (c.accOf ? c.accOf(x) : null) },
  opening: {
    label: 'Accuracy in moves 1–12', short: 'opening accuracy', dir: 1, kind: 'mean',
    value(x, c) {
      const l = c.idx?.[x.id]?.l;
      if (!l || !c.accFromLosses) return null;
      return c.accFromLosses(l.slice(0, 24), x.col);
    },
  },
  afterLoss: {
    label: 'Score in the game after a loss', short: 'score after a loss', dir: 1, kind: 'mean',
    value(x, c) { const p = prevInSession(c.games, x); return p && p.sc === 0 ? x.sc : null; },
  },
};

/** Ready-made plans, keyed by the metric they move. */
export const TEMPLATES = {
  trouble: { title: 'Fix time trouble', why: 'Bank time early so the critical moments get it.', rule: 'Play your opening moves quickly, and spend time only where the position changes.', tasks: [{ kind: 'puzzle', n: 10 }, { kind: 'journal', n: 1 }] },
  blunders: { title: 'Cut the blunders', why: 'One fewer blunder a game is worth more than any opening.', rule: 'Before every move: checks, captures and threats, for both sides.', tasks: [{ kind: 'puzzle', n: 10 }, { kind: 'journal', n: 1 }] },
  missed: { title: 'Punish mistakes', why: 'Your opponents hand you chances you do not take.', rule: 'After every opponent move, ask what it allows.', tasks: [{ kind: 'puzzle', n: 10 }, { kind: 'train', n: 1 }] },
  opening: { title: 'Know your openings', why: 'Leave the opening without being worse.', rule: 'Drill the lines that came up in your games first.', tasks: [{ kind: 'drill', n: 5 }, { kind: 'study', n: 1 }] },
  afterLoss: { title: 'Stop the tilt', why: 'Your results drop in the game after a loss.', rule: 'After two losses in a row, stop for the day. After one, take a 5-minute break.', tasks: [{ kind: 'journal', n: 1 }, { kind: 'puzzle', n: 5 }] },
  accuracy: { title: 'Play cleaner games', why: 'A steady habit across the whole game.', rule: 'Look for the opponent\'s best reply before you move.', tasks: [{ kind: 'puzzle', n: 5 }, { kind: 'drill', n: 3 }] },
};
export const TASK_LABEL = {
  puzzle: (n) => `${n} puzzle${n === 1 ? '' : 's'} from your games`,
  drill: (n) => `${n} library line${n === 1 ? '' : 's'}`,
  study: (n) => `${n} position${n === 1 ? '' : 's'} studied`,
  train: (n) => `${n} training exercise${n === 1 ? '' : 's'}`,
  journal: () => 'Journal your games',
  review: (n) => `${n} game${n === 1 ? '' : 's'} reviewed`,
};

export function newPlan(metric, { today = dayKey(), now = Date.now() / 1000, weeks = 4, tc = null } = {}) {
  const t = TEMPLATES[metric];
  return { id: Math.round(now).toString(36), metric, title: t.title, rule: t.rule, tasks: t.tasks.map((k) => ({ ...k })), start: today, startT: Math.floor(now), weeks, tc };
}

export const activePlan = (prog) => (prog?.plans || []).filter((p) => !p.ended).at(-1) || null;

function stats(vals, kind) {
  const n = vals.length;
  if (!n) return { n: 0, mean: null, se: null };
  const mean = vals.reduce((s, v) => s + v, 0) / n;
  let v;
  if (kind === 'share') v = Math.max(mean * (1 - mean), 0.05); // floor keeps 0% or 100% from looking certain
  else v = n > 1 ? vals.reduce((s, q) => s + (q - mean) ** 2, 0) / (n - 1) : mean * mean || 1;
  return { n, mean, se: Math.sqrt(v / n) };
}

/** Values of a metric over games (respecting the plan's time class). */
export function metricValues(metric, games, ctx, tc = null) {
  const M = METRICS[metric];
  const c = { ...ctx, games: ctx.games || games };
  return games.filter((x) => !tc || x.tc === tc).map((x) => ({ x, v: M.value(x, c) })).filter((p) => p.v != null);
}

/**
 * How the plan is going. ctx: {games, an, idx, accOf(x), accFromLosses(l, col), prog}
 * → {base, now, delta, better, verdict: 'early'|'working'|'worse'|'flat', need, days:{done, total, elapsed}, week, over}
 */
export function evaluatePlan(plan, ctx, { now = Date.now() / 1000, today = dayKey() } = {}) {
  const M = METRICS[plan.metric];
  const all = metricValues(plan.metric, ctx.games, ctx, plan.tc);
  const before = all.filter((p) => p.x.t < plan.startT && plan.startT - p.x.t < BASELINE_DAYS * DAY).slice(-BASELINE_MAX);
  const after = all.filter((p) => p.x.t >= plan.startT);
  const base = stats(before.map((p) => p.v), M.kind);
  const cur = stats(after.map((p) => p.v), M.kind);
  let verdict = 'early';
  let delta = null;
  let better = null;
  let margin = null;
  if (base.n >= 3 && cur.n >= 1) {
    delta = cur.mean - base.mean;
    better = delta * M.dir > 0;
    margin = 1.96 * Math.sqrt(base.se ** 2 + cur.se ** 2);
  }
  if (cur.n >= MIN_GAMES && base.n >= 3) verdict = Math.abs(delta) > margin ? (better ? 'working' : 'worse') : 'flat';
  // Days on plan: every task met that day.
  const total = plan.weeks * 7;
  const elapsedDays = Math.min(total, Math.max(1, Math.round((new Date(`${today}T12:00:00`) - new Date(`${plan.start}T12:00:00`)) / DAY / 1000) + 1));
  let done = 0;
  for (let i = 0; i < elapsedDays; i++) {
    const k = addDays(plan.start, i);
    const d = ctx.prog?.days?.[k] || {};
    const ok = plan.tasks.every((t) => t.kind === 'journal' ? (d.journal || 0) >= 1 || !ctx.games.some((x) => dayKeyOf(x.t) === k) : (d[t.kind] || 0) >= t.n);
    if (ok) done++;
  }
  const todayD = ctx.prog?.days?.[today] || {};
  const todayTasks = plan.tasks.map((t) => ({ ...t, have: t.kind === 'journal' ? todayD.journal || 0 : todayD[t.kind] || 0, ok: t.kind === 'journal' ? (todayD.journal || 0) >= 1 : (todayD[t.kind] || 0) >= t.n }));
  return {
    metric: M, base, now: cur, delta, better, margin, verdict, need: Math.max(0, MIN_GAMES - cur.n),
    days: { done, elapsed: elapsedDays, total }, week: Math.min(plan.weeks, Math.floor((elapsedDays - 1) / 7) + 1),
    over: elapsedDays >= total && now - plan.startT >= total * DAY, todayTasks,
  };
}
const dayKeyOf = (t) => dayKey(new Date(t * 1000));

/** Format a metric value for display. */
export function fmtMetric(metric, v) {
  if (v == null) return '–';
  const M = METRICS[metric];
  if (M.kind === 'share' || metric === 'afterLoss') return `${Math.round(v * 100)}%`;
  if (metric === 'accuracy' || metric === 'opening') return v.toFixed(1);
  return v.toFixed(2);
}

/** One sentence for the verdict, with the sample sizes. */
export function verdictText(plan, r) {
  const f = (v) => fmtMetric(plan.metric, v);
  const s = r.metric.short;
  if (r.base.n < 3) return `Not enough games before the plan to compare against (${r.base.n}). The plan still runs; the comparison starts once there is a baseline.`;
  if (r.verdict === 'early') return `Too early to tell: ${r.now.n} of ${MIN_GAMES} games since you started${r.now.n ? ` (${s} ${f(r.now.mean)} vs ${f(r.base.mean)} before)` : ''}. Any change this soon is mostly luck.`;
  const chg = `${s} ${f(r.base.mean)} → ${f(r.now.mean)} over ${r.now.n} games (baseline ${r.base.n})`;
  if (r.verdict === 'working') return `It is working: ${chg}. That is bigger than the noise.`;
  if (r.verdict === 'worse') return `Going the wrong way: ${chg}. Worth changing the plan.`;
  return `No clear change yet: ${chg}. The difference is within the noise (±${f(r.margin)}).`;
}

/**
 * Which plan to suggest: the metric where you are furthest from good, using the tag stats
 * (from journal + detected tags) and the after-loss numbers.
 */
export function suggestMetric({ tags = [], after = null, clockShare = null }) {
  const by = Object.fromEntries(tags.map((t) => [t.tag, t]));
  const cands = [];
  if (by.time) cands.push({ metric: 'trouble', w: by.time.lossShare, why: `${Math.round(by.time.lossShare * 100)}% of your losses had time trouble` });
  else if (clockShare != null) cands.push({ metric: 'trouble', w: clockShare * 0.8, why: `Time trouble in ${Math.round(clockShare * 100)}% of games` });
  if (by.tactic) cands.push({ metric: 'missed', w: by.tactic.lossShare, why: `${Math.round(by.tactic.lossShare * 100)}% of your losses had a missed tactic` });
  if (by.opening) cands.push({ metric: 'opening', w: by.opening.lossShare * 0.9, why: `${Math.round(by.opening.lossShare * 100)}% of your losses went wrong in the opening` });
  if (by.tilt) cands.push({ metric: 'afterLoss', w: by.tilt.lossShare * 1.1, why: `${Math.round(by.tilt.lossShare * 100)}% of your losses came in a losing streak` });
  if (after?.afterLoss?.n >= 8 && after.fresh.n >= 8 && after.fresh.score - after.afterLoss.score > 0.08) cands.push({ metric: 'afterLoss', w: (after.fresh.score - after.afterLoss.score) * 2, why: `You score ${Math.round(after.afterLoss.score * 100)}% after a loss, ${Math.round(after.fresh.score * 100)}% in a first game` });
  if (by.fast || by.calc) cands.push({ metric: 'blunders', w: ((by.fast?.lossShare || 0) + (by.calc?.lossShare || 0)) * 0.8, why: 'Quick or miscalculated moves cost you games' });
  cands.push({ metric: 'blunders', w: 0.15, why: 'Blunders decide most games at club level' });
  cands.sort((a, b) => b.w - a.w);
  const seen = new Set();
  return cands.filter((c) => !seen.has(c.metric) && seen.add(c.metric));
}

export { tagsOf };
