import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoTags, criticalMoment, lossStreak, ratingBefore, tagStats, afterResult, journalInbox, mergeJournal, isJournaled, tagsOf } from '../public/js/coach/journal.js';
import { newPlan, evaluatePlan, verdictText, suggestMetric, activePlan, MIN_GAMES } from '../public/js/coach/plans.js';
import { emptyProgress, mergeProgress, logActivity, dayKey, addDays } from '../public/js/coach/progress.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let seq = 0;
const game = (o = {}) => ({ id: `g${++seq}`, col: 'w', tc: 'blitz', sc: 0, t: 1_700_000_000 + seq * 600, myR: 1400, opp: 'opp', g: { time_control: '180', white: { result: o.sc === 1 ? 'win' : 'resigned' }, black: {} }, ...o });

test('critical moment and suggested tags', () => {
  const an = { bl: [{ ply: 10, mv: 6, san: 'e4', best: 'd4', drop: 20, fen: START_FEN, phase: 'Opening' }, { ply: 40, mv: 21, san: 'Nf3', best: 'Nc3', drop: 35, fen: START_FEN, phase: 'Endgame' }], missed: [] };
  const c = criticalMoment(an);
  assert.equal(c.mv, 21);
  assert.equal(c.kind, 'blunder');
  assert.equal(criticalMoment({ bl: [], missed: [] }), null);

  const x = game({ g: { time_control: '180', white: { result: 'timeout' }, black: {} } });
  const tags = autoTags(x, { games: [x], an: { [x.id]: an } });
  const ids = tags.map((t) => t.tag);
  assert.ok(ids.includes('time'), 'lost on time');
  assert.ok(ids.includes('endgame'), 'biggest mistake in the endgame');
  assert.ok(!ids.includes('opening'));
  assert.ok(tags.every((t) => t.why.length > 5), 'every suggestion says why');

  const op = game();
  assert.ok(autoTags(op, { games: [op], an: { [op.id]: { bl: [{ ...an.bl[0] }], missed: [] } } }).some((t) => t.tag === 'opening'));
});

test('missed punishment suggests a missed tactic; a won position not won suggests conversion', () => {
  const x = game({ sc: 0.5 });
  const an = { bl: [], missed: [{ ply: 20, mv: 11, san: 'a3', best: 'Qxd7', opp: 'Bd7', drop: 30, fen: START_FEN }] };
  const idx = { [x.id]: { s: [50, 52, 55, 60, 70, 88, 90, 60, 50] } };
  const tags = autoTags(x, { games: [x], an: { [x.id]: an }, idx }).map((t) => t.tag);
  assert.ok(tags.includes('tactic'));
  assert.ok(tags.includes('convert'));
});

test('streaks, rating before, after-result stats and the inbox', () => {
  seq = 100;
  const G = [game({ sc: 1, myR: 1420 }), game({ sc: 0, myR: 1412 }), game({ sc: 0, myR: 1404 }), game({ sc: 1, myR: 1412, tc: 'rapid' })];
  assert.equal(lossStreak(G, G[2]), 2);
  assert.equal(lossStreak(G, G[3]), 0);
  assert.equal(ratingBefore(G, G[2]), 1412);
  assert.equal(ratingBefore(G, G[3]), null, 'first rapid game');
  assert.ok(autoTags(G[2], { games: G }).some((t) => t.tag === 'tilt'));
  const a = afterResult(G);
  assert.equal(a.fresh.n, 1);
  assert.equal(a.afterWin.n, 1);
  assert.equal(a.afterLoss.n, 2);
  assert.equal(a.afterLoss.score, 0.5);
  assert.equal(a.afterTwoLosses.n, 1);
  const j = { v: 1, e: { [G[3].id]: { note: 'ok', tags: [], at: 1 } } };
  const now = G[3].t + 100;
  assert.deepEqual(journalInbox(G, j, { now }).map((x) => x.id), [G[2].id, G[1].id, G[0].id]);
});

test('journal merge, confirmed tags win over detected ones, tag stats', () => {
  const a = { e: { x: { note: 'old', at: 1 }, y: { note: 'y', at: 5 } } };
  const b = { e: { x: { note: 'new', at: 2 } } };
  const m = mergeJournal(a, b);
  assert.equal(m.e.x.note, 'new');
  assert.equal(m.e.y.note, 'y');
  assert.ok(isJournaled({ tags: ['time'] }));
  assert.ok(!isJournaled({ note: '', tags: [] }));

  seq = 200;
  const G = Array.from({ length: 10 }, (_, i) => game({ sc: i % 2 ? 1 : 0, t: 1_700_000_000 + i * 86400 * 2 }));
  const journal = { e: Object.fromEntries(G.filter((x) => x.sc === 0).slice(0, 3).map((x) => [x.id, { tags: ['time'], at: 1 }])) };
  assert.deepEqual(tagsOf(G[0], journal, { games: G }), { tags: ['time'], confirmed: true });
  const st = tagStats(G, journal, { games: G, an: {} });
  const time = st.find((t) => t.tag === 'time');
  assert.equal(time.losses, 3);
  assert.equal(time.totalLosses, 5);
  assert.equal(time.confirmed, 3);
  assert.equal(time.lossShare, 0.6);
});

test('plans: honest verdicts with sample sizes', () => {
  seq = 300;
  const startT = 1_700_000_000 + 60 * 86400;
  const mk = (n, t0, bl) => Array.from({ length: n }, (_, i) => game({ t: t0 + i * 3600 * 5, sc: 0.5 }));
  const before = mk(30, startT - 30 * 86400);
  const after = mk(12, startT + 3600);
  const games = [...before, ...after];
  const an = {};
  before.forEach((x, i) => { an[x.id] = { bl: Array(i % 2 ? 3 : 2).fill({}), missed: [] }; });
  const plan = newPlan('blunders', { today: dayKey(new Date(startT * 1000)), now: startT });
  const prog = emptyProgress();

  // Too early: only 3 games after the start.
  after.slice(0, 3).forEach((x) => { an[x.id] = { bl: [], missed: [] }; });
  let r = evaluatePlan(plan, { games: [...before, ...after.slice(0, 3)], an, prog }, { now: startT + 86400 });
  assert.equal(r.verdict, 'early');
  assert.equal(r.need, MIN_GAMES - 3);
  assert.match(verdictText(plan, r), /Too early/);

  // Clearly fewer blunders over 12 games: working.
  after.forEach((x) => { an[x.id] = { bl: Array(x.id.endsWith('1') ? 1 : 0).fill({}), missed: [] }; });
  r = evaluatePlan(plan, { games, an, prog }, { now: startT + 7 * 86400 });
  assert.equal(r.verdict, 'working');
  assert.ok(r.better);
  assert.match(verdictText(plan, r), /12 games \(baseline 30\)/);

  // Same rate as before: no clear change.
  after.forEach((x, i) => { an[x.id] = { bl: Array(i % 2 ? 3 : 2).fill({}), missed: [] }; });
  r = evaluatePlan(plan, { games, an, prog }, { now: startT + 7 * 86400 });
  assert.equal(r.verdict, 'flat');
});

test('plan days count only days with every task done', () => {
  const today = '2026-03-10';
  const plan = newPlan('blunders', { today: '2026-03-08', now: new Date('2026-03-08T12:00:00').getTime() / 1000 });
  const prog = emptyProgress();
  for (let i = 0; i < 10; i++) logActivity(prog, 'puzzle', { id: `p${i}`, today: '2026-03-08' });
  logActivity(prog, 'journal', { id: 'a', today: '2026-03-08' });
  for (let i = 0; i < 4; i++) logActivity(prog, 'puzzle', { id: `q${i}`, today: '2026-03-09' });
  const r = evaluatePlan(plan, { games: [], an: {}, prog }, { today, now: new Date(`${today}T12:00:00`).getTime() / 1000 });
  assert.equal(r.days.elapsed, 3);
  assert.equal(r.days.done, 1);
  assert.equal(r.week, 1);
  assert.deepEqual(r.todayTasks.map((t) => t.ok), [false, false]);
});

test('plans survive the progress merge; suggestions follow the biggest leak', () => {
  const a = emptyProgress();
  const b = emptyProgress();
  b.plans = [{ id: 'p', metric: 'trouble', start: '2026-01-01' }];
  b.plansAt = 10;
  const m = mergeProgress(a, b);
  assert.equal(m.plans.length, 1);
  assert.equal(activePlan(m).id, 'p');
  assert.equal(activePlan({ plans: [{ id: 'x', ended: { day: addDays('2026-01-01', 1) } }] }), null);
  const s = suggestMetric({ tags: [{ tag: 'time', lossShare: 0.41 }, { tag: 'tactic', lossShare: 0.2 }] });
  assert.equal(s[0].metric, 'trouble');
  assert.match(s[0].why, /41%/);
  assert.equal(new Set(s.map((c) => c.metric)).size, s.length, 'no duplicates');
});
