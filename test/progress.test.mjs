import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Library } from '../public/js/coach/library.js';
import { emptyProgress, logActivity, streak, reviewLine, dueLines, mergeProgress, addDays, lineKey, learnedCount, NEW_PER_DAY } from '../public/js/coach/progress.js';
import { insightFromReview, reviewSummary, phaseAccuracy } from '../public/js/coach/analysis.js';

test('activity log, dedupe and streak', () => {
  const d = emptyProgress();
  const t = '2026-11-03';
  assert.equal(logActivity(d, 'drill', { today: t }), true);
  assert.equal(logActivity(d, 'review', { id: 'g1', today: t }), true);
  assert.equal(logActivity(d, 'review', { id: 'g1', today: t }), false, 'same game counts once a day');
  logActivity(d, 'study', { today: addDays(t, -1) });
  logActivity(d, 'game', { today: addDays(t, -2) });
  assert.equal(streak(d, new Set(), t), 3);
  assert.equal(streak(d, new Set([addDays(t, -3)]), t), 4, 'chess.com game days count');
  assert.equal(streak(d, new Set(), addDays(t, 1)), 3, 'today not yet active keeps yesterday\'s streak');
  assert.equal(streak(d, new Set(), addDays(t, 2)), 0);
});

test('spaced repetition intervals', () => {
  const d = emptyProgress();
  const t = '2026-11-03';
  const k = lineKey('w', ['e4', 'e5']);
  assert.equal(reviewLine(d, k, true, t).due, addDays(t, 1));
  assert.equal(reviewLine(d, k, true, t).due, addDays(t, 3));
  assert.equal(reviewLine(d, k, true, t).due, addDays(t, 7));
  const miss = reviewLine(d, k, false, t);
  assert.equal(miss.due, addDays(t, 1));
  assert.equal(miss.reps, 0);
  assert.equal(miss.lapses, 1);
  assert.equal(learnedCount(d), 0);
});

test('due lines: reviews first, then a few new lines, custom lines first', () => {
  const L = new Library();
  L.addLine('w', ['e4', 'a6', 'd4'], 'mine', '', { date: 5 });
  const d = emptyProgress();
  const t = '2026-11-03';
  let due = dueLines(d, L, t);
  assert.equal(due.length, NEW_PER_DAY);
  assert.equal(due[0].line.t, 'mine', 'lines from your games come first');
  reviewLine(d, due[0].key, true, t);
  due = dueLines(d, L, t);
  assert.equal(due.length, NEW_PER_DAY - 1, 'new lines introduced today use up the daily allowance');
  due = dueLines(d, L, addDays(t, 1));
  assert.equal(due.filter((x) => !x.isNew).length, 1, 'the drilled line is due again tomorrow');
  const m = mergeProgress(d, { days: { [t]: { drill: 3 } }, srs: {} });
  assert.equal(m.days[t].drill, 3);
  assert.ok(m.srs[due[0].key] || Object.keys(m.srs).length === 1);
});

test('reviews feed the game list and Insights', () => {
  // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#  (Black blunders on move 3)
  const san = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
  const w = [52, 50, 55, 50, 55, 52, 100, 100];
  const R = { d: 12, san, ev: w.map((v) => ({ w: v, t: '', bs: null })), cl: ['book', 'book', 'inaccuracy', 'best', 'best', 'blunder', 'best'], loss: [0, 2, 0, 0, 0, 45, 0], acc: { w: 90, b: 40 } };
  const s = reviewSummary(R);
  assert.equal(s.b, 40);
  assert.equal(s.c.b.blunder, 1);
  assert.equal(s.s.length, 8);
  const ins = insightFromReview({ id: 'g', col: 'b', sans: san, sc: 0, url: null, g: {} }, R);
  assert.equal(ins.bl.length, 1);
  assert.equal(ins.bl[0].san, 'Nf6');
  assert.equal(ins.bl[0].phase, 'Opening');
  const ph = phaseAccuracy(R, 'b');
  assert.ok(ph.Opening < 80);
  assert.equal(ph.Endgame, null);
});
