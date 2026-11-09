import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../public/vendor/chess.js';
import { fitCalibration, applyCalibration, calibrationPairs } from '../public/js/coach/calibration.js';
import { toLichess, bandsFor } from '../public/js/coach/lichess.js';
import { parseTC, clockData, clockReport, clockAdvice } from '../public/js/coach/clock.js';
import { goalProgress, weekSummary } from '../public/js/coach/goals.js';
import { buildPrep, choices, expectedLines } from '../public/js/coach/prep.js';
import { ENDGAMES } from '../public/js/coach/training.js';
import { emptyProgress, logActivity, reviewLine, dayKey, addDays } from '../public/js/coach/progress.js';
import { Library } from '../public/js/coach/library.js';

test('calibration learns a mapping to chess.com accuracy', () => {
  // chess.com = 20 + 0.8·ours, with a little noise
  const pairs = Array.from({ length: 40 }, (_, i) => { const raw = 30 + i * 1.5; return { raw, ref: 20 + 0.8 * raw + ((i % 3) - 1) * 0.5 }; });
  const cal = fitCalibration(pairs);
  assert.ok(cal.maeFit < 1 && cal.maeRaw > 5);
  assert.ok(Math.abs(applyCalibration(60, cal) - 68) < 1);
  assert.equal(applyCalibration(60, null), 60);
  assert.equal(fitCalibration(pairs.slice(0, 5)), null, 'too few games');
  const idx = { a: { w: 70, b: 50 } };
  assert.equal(calibrationPairs([{ id: 'a', g: { accuracies: { white: 80, black: 60 } } }], idx).length, 2);
});

test('chess.com → Lichess rating conversion and explorer bands', () => {
  assert.ok(toLichess(800, 'blitz') > 1200 && toLichess(800, 'blitz') < 1400);
  assert.ok(toLichess(1000, 'rapid') > toLichess(1000, 'blitz'), 'chess.com rapid ratings run lower');
  assert.ok(Math.abs(toLichess(2500, 'blitz') - 2500) < 50, 'the scales converge at the top');
  assert.ok(toLichess(1500, 'blitz') > toLichess(1400, 'blitz'));
  assert.deepEqual(bandsFor(1750), [1600, 1800]);
  assert.deepEqual(bandsFor(2600), [2500]);
});

const pgnWithClocks = (n, secs) => {
  let s = '';
  const c = new Chess();
  let wt = 180, bt = 180;
  for (let i = 0; i < n; i++) {
    const m = c.moves()[0];
    c.move(m);
    if (i % 2 === 0) wt -= secs(i); else bt -= secs(i);
    s += `${i % 2 === 0 ? `${i / 2 + 1}. ` : ''}${m} {[%clk 0:${String(Math.floor((i % 2 ? bt : wt) / 60)).padStart(2, '0')}:${String(Math.max(0, (i % 2 ? bt : wt) % 60)).padStart(2, '0')}]} `;
  }
  return { pgn: `[Event "x"]\n\n${s}`, sans: c.history() };
};

test('clock data and report', () => {
  assert.deepEqual(parseTC('180+2'), { base: 180, inc: 2 });
  assert.equal(parseTC('1/86400'), null);
  const games = [];
  for (let k = 0; k < 6; k++) {
    const { pgn, sans } = pgnWithClocks(40, (i) => (i < 10 ? 1 : 4));
    games.push({ id: `c${k}`, col: 'w', tc: 'blitz', sc: k % 2, sans, g: { pgn, time_control: '180', white: { result: k % 2 ? 'win' : 'timeout' }, black: {} } });
  }
  const d = clockData(games[0]);
  assert.equal(d.length, 20);
  assert.equal(d[1].spent, 1);
  assert.equal(d[10].spent, 4);
  const idx = Object.fromEntries(games.map((x) => [x.id, { l: Array.from({ length: 40 }, (_, i) => (i === 30 ? 20 : 1)) }]));
  const r = clockReport(games, idx);
  assert.equal(r.mainTc, 'blitz');
  assert.ok(r.phase.Opening < r.phase.Middlegame);
  assert.ok(r.buckets.some((b) => b.n > 0));
  assert.equal(r.timeouts, 3);
  assert.ok(Array.isArray(clockAdvice(r)));
});

test('goals project from the trend; the week summary compares with last week', () => {
  const now = Date.now() / 1000;
  const games = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, tc: 'blitz', myR: 1200 + i * 5, t: now - (30 - i) * 86400, sc: 1, col: 'w', sans: [] }));
  const prog = emptyProgress();
  const g = goalProgress({ type: 'rating', tc: 'blitz', target: 1400, start: { v: 1200 }, by: addDays(dayKey(), 60) }, { games, prog, now });
  assert.equal(g.current, 1345);
  assert.ok(g.perDay > 4 && g.perDay < 6);
  assert.ok(g.eta && g.onTrack === true);
  const late = goalProgress({ type: 'rating', tc: 'blitz', target: 1400, start: { v: 1200 }, by: addDays(dayKey(), 3) }, { games, prog, now });
  assert.equal(late.onTrack, false);
  logActivity(prog, 'drill');
  reviewLine(prog, 'pz|x', true);
  const pz = goalProgress({ type: 'puzzles', target: 10, start: { v: 0 } }, { games, prog, now });
  assert.equal(pz.current, 1);
  // A game from a minute ago, so "this week" has one whatever weekday the test runs on.
  const w = weekSummary({ games: [...games, { id: 'today', tc: 'blitz', myR: 1350, t: now - 60, sc: 1, col: 'w', sans: [] }], prog });
  assert.equal(w.now.practice.drill, 1);
  assert.ok(w.now.games >= 1 && w.prev.games >= 1);
});

test('opponent prep: what they play and what to expect against your library', () => {
  const mk = (i, white, black, pgn, res) => ({ uuid: `o${i}`, rules: 'chess', pgn, end_time: 1000 + i, time_class: 'blitz', eco: '', white: { username: white, rating: 1500, result: res[0] }, black: { username: black, rating: 1500, result: res[1] } });
  const raw = [
    mk(1, 'me', 'Villain', '1. e4 a6 2. d4 b5 *', ['win', 'resigned']),
    mk(2, 'x', 'Villain', '1. e4 a6 2. d4 e6 *', ['win', 'timeout']),
    mk(3, 'y', 'Villain', '1. e4 a6 *', ['resigned', 'win']),
    mk(4, 'Villain', 'z', '1. d4 d5 *', ['win', 'resigned']),
  ];
  const P = buildPrep('villain', raw, { lib: new Library(), myGames: [{ opp: 'Villain', sc: 1, ex: 0.5, t: 1 }] });
  assert.equal(P.n, 4);
  assert.equal(P.asBlack.vsE4[0].san, 'a6');
  assert.equal(P.asWhite.first[0].san, 'd4');
  assert.equal(P.ends.time, 1);
  assert.equal(P.h2h.n, 1);
  const ex = P.you.w;
  assert.ok(ex.gaps.some((g) => g.san === 'a6'), '1...a6 is not in the White library');
  assert.equal(choices(P.games.filter((x) => x.col === 'b'), ['e4', 'a6', 'd4']).length, 2);
  void expectedLines;
});

test('endgame positions are legal', () => {
  for (const e of ENDGAMES) assert.doesNotThrow(() => new Chess(e.fen), e.id);
});

test('parametric accuracy: defaults reproduce the original formula; parameters move it as expected', async () => {
  const { paramAccuracy, DEFAULT_PARAMS } = await import('../public/js/coach/calibration.js');
  const { accuracyOf } = await import('../public/js/coach/analysis.js');
  const loss = [0, 2, 5, 0, 30, 1, 0, 8, 12, 0];
  const white = loss.filter((_, i) => i % 2 === 0);
  assert.equal(paramAccuracy(loss, 'w', DEFAULT_PARAMS), +accuracyOf(white).toFixed(1));
  assert.ok(paramAccuracy(loss, 'w', { k: 0.5, w: 0.5, b: 0 }) > paramAccuracy(loss, 'w', DEFAULT_PARAMS), 'a smaller k is more lenient');
  assert.ok(paramAccuracy(loss, 'w', { k: 1, w: 0, b: 0 }) > paramAccuracy(loss, 'w', { k: 1, w: 1, b: 0 }), 'the harmonic mean punishes bad moves more');
  assert.ok(paramAccuracy(loss, 'w', { k: 1, w: 0.5, b: 6 }) > paramAccuracy(loss, 'w', DEFAULT_PARAMS), 'skipping the first plies drops the early blunder here');
});
