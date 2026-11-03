import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPuzzles, motif, puzzleQueue, focusFor, puzzleStats, NEW_PUZZLES_PER_DAY } from '../public/js/coach/puzzles.js';
import { trackedPositions } from '../public/js/coach/positions.js';
import { emptyProgress, reviewLine, puzzleKey, lineKey, dayKey, learnedCount, dueLines } from '../public/js/coach/progress.js';
import { Library } from '../public/js/coach/library.js';

const FEN_FORK = 'r3k3/pp3ppp/8/3N4/8/8/PPP2PPP/4K3 w - - 0 1';

test('motif labels', () => {
  assert.equal(motif(FEN_FORK, 'Nc7+'), 'Double attack');
  assert.equal(motif('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'Ra8#'), 'Mate');
  assert.equal(motif('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e4'), 'Quiet move');
});

const games = [
  { id: 'g1', col: 'w', t: 100, opp: 'ann', fam: 'Italian Game', sans: ['e4', 'e5'], sc: 0, ex: 0.5 },
  { id: 'g2', col: 'w', t: 200, opp: 'bob', fam: 'Italian Game', sans: ['e4', 'e5'], sc: 1, ex: 0.5 },
];
const an = {
  g1: { bl: [{ ply: 6, mv: 4, san: 'Qh5', best: 'Nc7+', drop: 30, fen: FEN_FORK, phase: 'Opening' }], missed: [] },
  g2: { bl: [], missed: [{ ply: 20, mv: 11, san: 'a3', best: 'Nc7+', drop: 20, opp: 'Kd8', fen: FEN_FORK }] },
};

test('puzzles from blunders and missed punishments, queued and scheduled', () => {
  const P = buildPuzzles(games, an);
  assert.equal(P.length, 2);
  assert.deepEqual(P.map((p) => p.kind).sort(), ['blunder', 'punish']);
  assert.equal(P.find((p) => p.kind === 'punish').oppName, 'bob');
  const prog = emptyProgress();
  const today = dayKey();
  let q = puzzleQueue(P, prog, { focus: focusFor('punish'), today });
  assert.equal(q[0].kind, 'punish', 'the focus area comes first');
  reviewLine(prog, puzzleKey(q[0].id), true, today);
  q = puzzleQueue(P, prog, { today });
  assert.equal(q.length, 1);
  assert.equal(puzzleStats(P, prog).solved, 1);
  // puzzles don't count as library lines
  assert.equal(learnedCount(prog), 0);
  assert.equal(dueLines(prog, new Library(), today).length, 2);
  assert.ok(NEW_PUZZLES_PER_DAY >= 1);
});

test('position progress: before vs after you started working on it', () => {
  const pre = ['e4', 'a6'];
  const day = 86400;
  const t0 = Date.UTC(2026, 8, 1) / 1000;
  const G = [];
  for (let i = 0; i < 10; i++) G.push({ id: `p${i}`, col: 'w', t: t0 + i * 3 * day, sans: ['e4', 'a6', 'd4'], sc: i < 5 ? 0 : 1, ex: 0.5 });
  const studiedAt = (t0 + 13 * day) * 1000; // between game 4 and 5
  const disc = [{ id: 'd1', side: 'w', path: ['e4'], move: 'a6', status: 'studied', studied: { at: studiedAt }, games: [], opening: 'St George' }];
  const prog = emptyProgress();
  reviewLine(prog, lineKey('w', ['e4', 'a6', 'd4', 'b5', 'Bd3']), true, '2026-09-20');
  const [p] = trackedPositions({ games: G, discoveries: disc, lib: null, prog, puzzles: [] });
  assert.equal(p.before.n, 5);
  assert.equal(p.after.n, 5);
  assert.equal(p.before.sc, 0);
  assert.equal(p.after.sc, 1);
  assert.equal(p.status, 'improving');
  assert.equal(p.work.drills, 1);
  assert.ok(p.worked);
  assert.equal(p.roll.length, 10);
});
