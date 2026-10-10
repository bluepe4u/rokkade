import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eloParams, weighCandidates, sampleMove, materialOutcome, describeOutcome, scoreToCp, formatScore,
} from '../public/js/solver.js';
import { parseInfo } from '../public/js/engine.js';

const line = (move, score) => ({ pv: [move], score });

test('stronger Elo means deeper search, lower temperature and fewer blunders', () => {
  const weak = eloParams(400);
  const strong = eloParams(2800);
  assert.ok(strong.depth > weak.depth);
  assert.ok(strong.temperature < weak.temperature);
  assert.ok(strong.blunder < weak.blunder);
  assert.equal(eloParams(0).depth, 1);
  assert.equal(eloParams(3000).depth, 18);
  assert.equal(eloParams(1500, { depth: 12 }).depth, 12);
  assert.equal(eloParams(1500, { randomness: 0 }).blunder, 0);
});

test('probabilities sum to 1 and favour the best move more at high Elo', () => {
  const lines = [line('e2e4', { cp: 30 }), line('d2d4', { cp: 20 }), line('a2a3', { cp: -80 })];
  const weak = weighCandidates(lines, 20, eloParams(400));
  const strong = weighCandidates(lines, 20, eloParams(2800));
  for (const w of [weak, strong]) {
    const total = w.candidates.reduce((s, c) => s + c.prob, 0) + w.otherProb;
    assert.ok(Math.abs(total - 1) < 1e-9);
  }
  assert.ok(strong.candidates[0].prob > weak.candidates[0].prob);
  assert.ok(strong.candidates[0].prob > 0.9);
  assert.ok(weak.candidates[2].prob > strong.candidates[2].prob);
});

test('mate scores dominate centipawn scores', () => {
  assert.ok(scoreToCp({ mate: 3 }) > scoreToCp({ cp: 2000 }));
  assert.ok(scoreToCp({ mate: 1 }) > scoreToCp({ mate: 5 }));
  assert.ok(scoreToCp({ mate: -2 }) < scoreToCp({ cp: -2000 }));
  assert.equal(formatScore({ cp: -150 }), '−1.50');
  assert.equal(formatScore({ mate: 2 }, -1), '−M2');
});

test('sampleMove follows the weights', () => {
  const w = { candidates: [{ move: 'e2e4', prob: 0.7 }, { move: 'd2d4', prob: 0.2 }], otherProb: 0.1 };
  const legal = ['e2e4', 'd2d4', 'g1f3'];
  assert.equal(sampleMove(w, legal, () => 0.1), 'e2e4');
  assert.equal(sampleMove(w, legal, () => 0.8), 'd2d4');
  let calls = 0;
  assert.equal(sampleMove(w, legal, () => (calls++ === 0 ? 0.95 : 0)), 'g1f3');
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
