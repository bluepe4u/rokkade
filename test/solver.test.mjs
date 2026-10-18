import test from 'node:test';
import assert from 'node:assert/strict';
import {
  playerModel, searchBudget, blendMoves, sampleMove, materialOutcome, describeOutcome,
  scoreToCp, formatScore, winPct, moveAccuracy,
} from '../public/js/solver.js';
import { parseInfo } from '../public/js/engine.js';
import { OpeningBook } from '../public/js/book.js';

// An engine line: first move + eval in centipawns (side to move's view).
const line = (move, cp) => ({ pv: [move], score: typeof cp === 'object' ? cp : { cp } });
const probOf = (blended, move) => blended.candidates.find((c) => c.move === move).prob;
const uniform = (moves) => new Map(moves.map((m) => [m, 1 / moves.length]));

test('model regimes: engine softmax at the bottom, Maia in the middle, engine again at the top', () => {
  // the temperature (how forgiving of costly moves) only ever falls as Elo rises
  let prev = playerModel(0);
  for (let e = 50; e <= 3000; e += 50) {
    const m = playerModel(e);
    assert.ok(m.tau <= prev.tau + 1e-9, `tau not monotone at ${e}`);
    prev = m;
  }
  for (const e of [100, 300, 500]) {                      // below Maia's range: wide softmax, weak prior
    const m = playerModel(e);
    assert.ok(m.betaCap === 1 && m.tau >= 15 && m.alpha < 0.5, `low regime at ${e}`);
  }
  for (const e of [1100, 1500, 2000]) {                   // Maia's range: prior as is, light veto
    const m = playerModel(e);
    assert.ok(m.alpha === 1 && m.betaCap <= 0.5, `maia regime at ${e}`);
  }
  assert.ok(playerModel(2900).alpha < 0.5 && playerModel(2900).betaCap > 0.9);
  assert.ok(playerModel(1500, { humanness: 2 }).betaCap < playerModel(1500).betaCap);
});

test('search budget grows with Elo and covers every legal move for weaker levels', () => {
  assert.equal(searchBudget(1200, 33).multipv, 33);
  assert.ok(searchBudget(2900, 33).multipv < 33);
  assert.ok(searchBudget(2900, 33).depth > searchBudget(1200, 33).depth);
  assert.equal(searchBudget(1200, 5).multipv, 5);
});

test('probabilities sum to one and unscored moves are still candidates', () => {
  const legal = ['e2e4', 'd2d4', 'a2a3', 'h2h4'];
  const lines = [line('e2e4', 30), line('d2d4', 20), line('a2a3', -80)];
  const b = blendMoves(lines, uniform(legal), legal, playerModel(1500));
  assert.equal(b.candidates.length, 4);
  assert.ok(Math.abs(b.candidates.reduce((s, c) => s + c.prob, 0) - 1) < 1e-9);
  assert.equal(b.candidates.find((c) => c.move === 'h2h4').listed, false);
  assert.deepEqual(b.candidates.map((c) => c.prob), [...b.candidates.map((c) => c.prob)].sort((x, y) => y - x));
});

test('stockfish vetoes a move humans like but that loses a queen, when sound moves are easy to find', () => {
  const legal = ['e2e4', 'd2d4', 'd1h5'];
  const lines = [line('e2e4', 20), line('d2d4', 10), line('d1h5', -900)];
  const prior = new Map([['e2e4', 0.5], ['d2d4', 0.35], ['d1h5', 0.15]]);
  const b = blendMoves(lines, prior, legal, playerModel(1800));
  assert.ok(b.soundMass > 0.6, `sound mass ${b.soundMass}`);
  assert.ok(probOf(b, 'd1h5') < 0.08, `queen hang prob ${probOf(b, 'd1h5')}`);
  assert.ok(probOf(b, 'd1h5') < 0.15 / 2, 'the veto must cut the humans\' 15% at least in half');
});

test('where the sound moves are ones humans rarely find, the human mistake wins out', () => {
  // Only Nf7+ keeps the position; a typical player plays the natural-looking Bxh7 instead.
  const legal = ['g5f7', 'c1h6', 'd3h7'];
  const lines = [line('g5f7', 300), line('c1h6', -200), line('d3h7', -250)];
  const prior = new Map([['g5f7', 0.04], ['c1h6', 0.26], ['d3h7', 0.70]]);
  const b = blendMoves(lines, prior, legal, playerModel(1400));
  assert.ok(b.soundMass < 0.1, `sound mass ${b.soundMass}`);
  assert.ok(b.beta < 0.1, `beta ${b.beta}`);
  assert.ok(probOf(b, 'd3h7') > 0.5, `human move prob ${probOf(b, 'd3h7')}`);
  // ...whereas the same position at engine strength finds the only good move.
  const strong = blendMoves(lines, prior, legal, playerModel(3000));
  assert.ok(probOf(strong, 'g5f7') > 0.95);
});

test('errors cluster where sound moves are hard: expected accuracy is lower in the hard position', () => {
  const easy = blendMoves(
    [line('a', 50), line('b', 40), line('c', -400)],
    new Map([['a', 0.55], ['b', 0.35], ['c', 0.10]]), ['a', 'b', 'c'], playerModel(1500));
  const hard = blendMoves(
    [line('a', 300), line('b', -250), line('c', -400)],
    new Map([['a', 0.05], ['b', 0.55], ['c', 0.40]]), ['a', 'b', 'c'], playerModel(1500));
  assert.ok(easy.expectedAccuracy > hard.expectedAccuracy + 20);
});

test('low-Elo lapses pick natural-looking moves, never the odd ones nobody plays', () => {
  assert.ok(playerModel(100).lambda > 0.8);
  assert.equal(playerModel(1100).lambda, 0);
  assert.equal(playerModel(2000).lambda, 0);
  assert.ok(playerModel(100, { humanness: 1.5 }).lambda > playerModel(100).lambda);
  assert.ok(playerModel(100, { humanness: 5 }).lambda <= 0.97);
  // 20 legal moves: m0 is the only good one; humans like m1..m4 (all bad) and ignore the rest
  const legal = Array.from({ length: 20 }, (_, i) => `m${i}`);
  const lines = legal.map((m, i) => line(m, i === 0 ? 100 : -500));
  const human = new Map(legal.map((m, i) => [m, i === 0 ? 0.2 : i <= 4 ? 0.19 : 0.0025]));
  const b = blendMoves(lines, human, legal, playerModel(100));
  assert.ok(Math.abs(b.candidates.reduce((s, c) => s + c.prob, 0) - 1) < 1e-9);
  const p = (m) => b.candidates.find((c) => c.move === m).prob;
  assert.ok(p('m1') > 3 * p('m10'), `natural-looking bad move ${p('m1')} vs odd move ${p('m10')}`);
  assert.ok(p('m0') < 0.6, 'the one good move is no longer near-certain');
  // no human prior (engine-only fallback): no lapses
  assert.equal(blendMoves(lines, null, legal, playerModel(100, { maia: false })).candidates.length, 20);
});

test('the engine move is near-certain at the top and not at the bottom', () => {
  const legal = ['a', 'b', 'c', 'd'];
  const lines = [line('a', 100), line('b', 20), line('c', -60), line('d', -10)];
  const prior = new Map([['a', 0.3], ['b', 0.4], ['c', 0.1], ['d', 0.2]]);
  const p = (elo) => probOf(blendMoves(lines, prior, legal, playerModel(elo)), 'a');
  assert.ok(p(3000) > 0.95, `p(3000)=${p(3000)}`);
  assert.ok(p(2500) > p(1500), `${p(1500)} -> ${p(2500)}`);
  assert.ok(p(100) < 0.6, `p(100)=${p(100)}`);
});

test('a wide softmax (low Elo) finds a standout tactic less often and rarely favours the top move', () => {
  const moves = ['best', ...Array.from({ length: 24 }, (_, i) => `m${i}`)];
  const uniformPrior = new Map(moves.map((m) => [m, 1 / moves.length]));
  // standout tactic: the best move keeps +3.00, everything else drops to about 0.
  const shot = [line('best', 300), ...moves.slice(1).map((m) => line(m, 0))];
  const found = (elo) => probOf(blendMoves(shot, uniformPrior, moves, playerModel(elo)), 'best');
  assert.ok(found(100) < 0.35, `100 Elo finds it ${found(100)}`);
  assert.ok(found(100) < found(500) && found(500) < found(2500), [100, 500, 2500].map(found).join(' < '));
  assert.ok(found(3000) > 0.9);
  // quiet position: near-equal moves; the best (placed last, so no tie favours it) is barely favoured
  const reordered = [...moves.slice(1), 'best'];
  const quiet = reordered.map((m) => line(m, m === 'best' ? 10 : 8));
  const top = probOf(blendMoves(quiet, new Map(reordered.map((m) => [m, 1 / reordered.length])), reordered, playerModel(100)), 'best');
  assert.ok(top < 2 / moves.length, `top move share ${top} vs uniform ${1 / moves.length}`);
});

test('engine-only fallback (no human prior) still prefers better moves and sums to one', () => {
  const legal = ['a', 'b', 'c'];
  const lines = [line('a', 100), line('b', 20), line('c', -300)];
  const b = blendMoves(lines, null, legal, playerModel(1200, { maia: false }));
  assert.ok(Math.abs(b.candidates.reduce((s, c) => s + c.prob, 0) - 1) < 1e-9);
  assert.equal(b.candidates[0].move, 'a');
  assert.ok(b.candidates.every((c) => c.human === null));
});

test('humanness above 1 gives human slips more room', () => {
  const legal = ['a', 'b'];
  const lines = [line('a', 100), line('b', -300)];
  const prior = new Map([['a', 0.7], ['b', 0.3]]);
  const lo = probOf(blendMoves(lines, prior, legal, playerModel(1500, { humanness: 0.5 })), 'b');
  const hi = probOf(blendMoves(lines, prior, legal, playerModel(1500, { humanness: 2 })), 'b');
  assert.ok(hi > lo, `${lo} -> ${hi}`);
});

test('sampleMove follows the blended probabilities', () => {
  const blended = { candidates: [{ move: 'a', prob: 0.7 }, { move: 'b', prob: 0.2 }, { move: 'c', prob: 0.1 }] };
  assert.equal(sampleMove(blended, () => 0.1), 'a');
  assert.equal(sampleMove(blended, () => 0.8), 'b');
  assert.equal(sampleMove(blended, () => 0.95), 'c');
});

test('win percentage and move accuracy follow the Lichess curves', () => {
  assert.equal(winPct({ cp: 0 }), 50);
  assert.ok(winPct({ cp: 300 }) > 70 && winPct({ cp: 300 }) < 80);
  assert.equal(winPct({ mate: 3 }), winPct({ cp: 5000 }));
  assert.ok(Math.abs(moveAccuracy(0) - 100) < 0.01);
  assert.ok(moveAccuracy(20) < 45);
});

test('opening book: known positions give a prior, unknown ones do not', () => {
  const book = new OpeningBook({
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -': { e2e4: 6, d2d4: 5, g1f3: 3 },
  });
  const legal = ['e2e4', 'd2d4', 'g1f3', 'a2a3'];
  const p = book.prior('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', legal);
  assert.ok(p.get('e2e4') > p.get('d2d4') && p.get('d2d4') > p.get('g1f3') && p.get('g1f3') > p.get('a2a3'));
  assert.ok(p.get('a2a3') > 0, 'off-book moves keep a small chance');
  assert.ok(Math.abs([...p.values()].reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(book.prior('4k3/8/8/8/8/8/8/4K3 w - - 0 1', ['e1e2']), null);
});

test('mate scores dominate centipawn scores', () => {
  assert.ok(scoreToCp({ mate: 3 }) > scoreToCp({ cp: 2000 }));
  assert.ok(scoreToCp({ mate: 1 }) > scoreToCp({ mate: 5 }));
  assert.ok(scoreToCp({ mate: -2 }) < scoreToCp({ cp: -2000 }));
  assert.equal(formatScore({ cp: -150 }), '−1.50');
  assert.equal(formatScore({ mate: 2 }, -1), '−M2');
});

test('materialOutcome counts captures along the line and finishes exchanges', () => {
  // A hanging knight on d5.
  const fen = '4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1';
  const out = materialOutcome(fen, ['d1d5'], 4);
  assert.equal(out.delta, 3);
  assert.deepEqual(out.won, ['n']);
  assert.equal(describeOutcome(out), 'Wins a knight');

  // Queen takes a defended pawn and gets recaptured: horizon 1 is extended past the capture.
  const fen2 = '4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1';
  const out2 = materialOutcome(fen2, ['d1d5', 'c6d5'], 1);
  assert.equal(out2.plies, 2);
  assert.equal(out2.delta, -8);
  assert.match(describeOutcome(out2), /Loses/);
});

test('materialOutcome detects mate', () => {
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
  const out = materialOutcome(fen, ['h5f7'], 6);
  assert.equal(out.endsInMate, true);
  assert.equal(describeOutcome(out, { mate: 1 }), 'Mates in 1');
});

test('parseInfo reads multipv lines', () => {
  const info = parseInfo('info depth 12 seldepth 18 multipv 2 score cp -35 nodes 1000 nps 50000 time 20 pv e7e5 g1f3 b8c6');
  assert.equal(info.depth, 12);
  assert.equal(info.multipv, 2);
  assert.deepEqual(info.score, { cp: -35 });
  assert.deepEqual(info.pv, ['e7e5', 'g1f3', 'b8c6']);
  assert.deepEqual(parseInfo('info depth 3 multipv 1 score mate -2 upperbound pv a1a2').score, { mate: -2 });
  assert.equal(parseInfo('info string NNUE enabled'), null);
});
