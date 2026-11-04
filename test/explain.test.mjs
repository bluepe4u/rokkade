import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materialOutcome, tradeText, tacticOf, standing, swingText, explainMove, highlights, gameStory } from '../public/js/coach/explain.js';
import { fensOf } from '../public/js/coach/analysis.js';

const SANS = ['e4', 'e5', 'Qh5', 'Nc6', 'Qxe5+', 'Nxe5'];
const { fens } = fensOf(SANS);
// White blunders the queen on move 3; Black takes it.
const R = {
  san: SANS,
  cl: ['book', 'book', 'good', 'best', 'blunder', 'best'],
  loss: [0, 0, 2, 0, 45, 0],
  ev: [
    { w: 52, pv: ['e4'], bs: 'e4' }, { w: 52, pv: ['e5'], bs: 'e5' }, { w: 52, pv: ['Nf3'], bs: 'Nf3' },
    { w: 50, pv: ['Nc6'], bs: 'Nc6' }, { w: 52, pv: ['Bc4', 'Nf6'], bs: 'Bc4', gap: 2 }, { w: 4, pv: ['Nxe5'], bs: 'Nxe5' }, { w: 4, pv: [] },
  ],
};

test('material outcome of a line, in pieces', () => {
  const o = materialOutcome(fens[4], ['Qxe5+', 'Nxe5'], 'w');
  assert.deepEqual(o.lost, { q: 1 });
  assert.deepEqual(o.won, { p: 1 });
  assert.equal(o.net, -8);
  assert.equal(tradeText(o, 'lose'), 'a queen for a pawn');
  // Waits for the recapture: Qxe5+ alone is not "winning a pawn" when Nxe5 follows.
  const half = materialOutcome(fens[4], ['Qxe5+'], 'w');
  assert.equal(half.net, 1);
  assert.equal(tradeText({ lost: { r: 1 }, won: { n: 1 } }, 'lose'), 'the exchange (a rook for a minor piece)');
  assert.equal(tradeText({ won: { r: 1, p: 2 }, lost: {} }, 'win'), 'a rook and two pawns');
});

test('tactics are named: a knight fork', () => {
  const t = tacticOf('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'Nc7+');
  assert.equal(t.kind, 'fork');
  assert.deepEqual(t.names, ['king', 'rook']);
  assert.equal(tacticOf('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'Ra8+').kind, 'check');
});

test('standing and swings read like a person', () => {
  assert.equal(standing(95).text, 'winning');
  assert.equal(standing(50).text, 'about equal');
  assert.match(swingText(95, 50), /throws away a winning position/);
  assert.match(swingText(50, 5), /level game straight to a losing one/);
  assert.equal(swingText(50, 52), null);
});

test('a blunder is explained with the piece it loses, and the better move', () => {
  const ex = explainMove(R, 4, fens, 'w');
  assert.equal(ex.headline, 'Blunder');
  assert.equal(ex.tone, 'warn');
  const t = ex.text.join(' ');
  assert.match(t, /queen on e5 can simply be taken: after Nxe5 you lose a queen for a pawn/);
  assert.match(t, /Bc4 was better/);
  assert.doesNotMatch(t, /points/);
});

test('punishing the blunder is celebrated, from the other side', () => {
  const ex = explainMove(R, 5, fens, 'b');
  assert.equal(ex.headline, 'Punished!');
  assert.equal(ex.tone, 'cheer');
  assert.match(ex.text.join(' '), /wins a queen/);
  const theirs = explainMove(R, 4, fens, 'b');
  assert.equal(theirs.headline, 'Their blunder');
  assert.match(theirs.text.join(' '), /they lose a queen/);
});

test('highlights include celebrations and errors; the story names them', () => {
  const hb = highlights(R, fens, 'b');
  assert.deepEqual(hb.map((m) => m.type), ['theirs', 'punish']);
  const hw = highlights(R, fens, 'w');
  assert.deepEqual(hw.map((m) => m.type), ['blunder']);
  const st = gameStory(R, fens, 'b', { result: 'win', opp: 'bob' });
  assert.match(st.text, /punished a mistake/);
  assert.match(st.text, /turning point was 3\.Qxe5\+, when bob went wrong/);
});
