import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, fromPieces, legalMoves, playMove, sq, moveFrom, moveTo, serialize, deserialize,
  ROOK, QUEEN, KING, KNIGHT,
} from '../public/js/four/rules.js';
import { chooseMove, evaluate } from '../public/js/four/bot.js';

const KINGS = [[7, 0, KING, 0], [0, 6, KING, 1], [6, 13, KING, 2], [13, 7, KING, 3]];
const first = () => 0; // deterministic "random": always the best candidate

test('every level returns a legal move from the opening', () => {
  const g = newGame();
  for (let level = 1; level <= 4; level++) {
    const r = chooseMove(g, level, { timeMs: 150 });
    assert.ok(legalMoves(g).includes(r.move), `level ${level}`);
  }
});

test('levels 2+ take a free queen', () => {
  for (let level = 2; level <= 4; level++) {
    const g = fromPieces([...KINGS, [7, 3, ROOK, 0], [7, 6, QUEEN, 1]]);
    const r = chooseMove(g, level, { rng: first, timeMs: 400 });
    assert.deepEqual([moveFrom(r.move), moveTo(r.move)], [sq(7, 3), sq(7, 6)], `level ${level}`);
  }
});

test('deeper levels do not walk a queen into a defended square', () => {
  // Red's queen could take a knight on h7, but a Green rook guards it: capturing loses the queen for a knight.
  const g = fromPieces([...KINGS, [7, 2, QUEEN, 0], [7, 8, KNIGHT, 1], [12, 8, ROOK, 3]]);
  const r = chooseMove(g, 3, { rng: first, timeMs: 600 });
  assert.notDeepEqual([moveFrom(r.move), moveTo(r.move)], [sq(7, 2), sq(7, 8)]);
});

test('Teams: finds a checkmate in one, and understands teammates are not enemies', () => {
  const g = fromPieces([[7, 0, KING, 0], [0, 3, KING, 1], [7, 13, KING, 2], [13, 7, KING, 3], [5, 3, ROOK, 0], [5, 10, ROOK, 0]], { mode: 'teams' });
  const r = chooseMove(g, 3, { rng: first, timeMs: 600 });
  assert.deepEqual([moveFrom(r.move), moveTo(r.move)], [sq(5, 10), sq(5, 4)]);
  // evaluation: a teammate's queen counts for the bot, an opponent's against it
  const t = fromPieces([...KINGS, [4, 4, QUEEN, 2]], { mode: 'teams' });
  assert.ok(evaluate(t, 0) > 800 && evaluate(t, 1) < -800);
});

test('bots play whole stretches of games without ever making an illegal move', () => {
  for (const mode of ['ffa', 'teams']) {
    const g = newGame(mode);
    let seed = 7;
    const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let ply = 0; ply < 80 && !g.result; ply++) {
      const level = 1 + (ply % 3); // mix of levels 1-3
      const r = chooseMove(g, level, { rng, timeMs: 60 });
      assert.ok(legalMoves(g).includes(r.move), `${mode} ply ${ply} level ${level}`);
      playMove(g, r.move);
    }
  }
});

test('the worker message round trip yields the same move as a direct call', () => {
  const g = newGame();
  const direct = chooseMove(g, 2, { rng: first });
  const viaWire = chooseMove(deserialize(JSON.parse(JSON.stringify({ ...serialize(g), board: [...g.board] }))), 2, { rng: first });
  assert.equal(direct.move, viaWire.move);
});

import { analyse, describeMaterial } from '../public/js/four/bot.js';
import { pieceType, makeMove, unmakeMove, FLAG_PROMOTION } from '../public/js/four/rules.js';

test('analyse: the top n moves, best first, each with a principal variation', () => {
  const g = fromPieces([...KINGS, [7, 3, ROOK, 0], [7, 6, QUEEN, 1], [3, 3, KNIGHT, 0]]);
  const snapshot = g.board.slice();
  const r = analyse(g, { n: 3, timeMs: 400, maxDepth: 4 });
  assert.deepEqual([...g.board], [...snapshot], 'analysis leaves the position untouched');
  assert.ok(r.lines.length === 3 && r.depth >= 2);
  assert.deepEqual(r.lines.map((l) => l.rank), [1, 2, 3]);
  for (let i = 1; i < r.lines.length; i++) assert.ok(r.lines[i - 1].value >= r.lines[i].value);
  const top = r.lines[0];
  assert.deepEqual([moveFrom(top.move), moveTo(top.move)], [sq(7, 3), sq(7, 6)], 'best move takes the free queen');
  assert.equal(top.line[0], top.move);
  assert.ok(top.line.length >= 2, 'the principal variation continues past the first move');
  assert.equal(top.steps[0].text, 'Rh4xh7');
  assert.equal(top.gain, 9);
  assert.equal(describeMaterial(top), 'Wins a queen');
  // every line is playable from the position
  for (const l of r.lines) {
    const undos = l.line.map((m) => makeMove(g, m));
    while (undos.length) unmakeMove(g, undos.pop());
  }
  assert.deepEqual([...g.board], [...snapshot]);
});

test('analyse: reports every depth, and finds a forced checkmate in Teams', () => {
  const g = fromPieces([[7, 0, KING, 0], [0, 3, KING, 1], [7, 13, KING, 2], [13, 7, KING, 3], [5, 3, ROOK, 0], [5, 10, ROOK, 0]], { mode: 'teams' });
  const depths = [];
  const r = analyse(g, { n: 2, timeMs: 600, maxDepth: 5, onDepth: (d) => depths.push(d.depth) });
  assert.deepEqual(depths, [...depths].sort((a, b) => a - b));
  assert.deepEqual([moveFrom(r.lines[0].move), moveTo(r.lines[0].move)], [sq(5, 10), sq(5, 4)]);
  assert.ok(r.lines[0].value > 90000, 'a mate score');
});

test('describeMaterial wording', () => {
  assert.equal(describeMaterial({ gained: [], lost: [], delta: 0 }), 'No material change');
  assert.equal(describeMaterial({ gained: [{ type: 2 }], lost: [{ type: 2 }], delta: 0 }), 'Even trade');
  assert.equal(describeMaterial({ gained: [{ type: 2 }], lost: [], delta: 3 }), 'Wins a knight');
  assert.equal(describeMaterial({ gained: [{ type: 5 }], lost: [{ type: 4 }], delta: 4 }), 'Wins 4 points');
  assert.equal(describeMaterial({ gained: [], lost: [{ type: 4 }], delta: -5 }), 'Loses a rook');
});

test('analyse: in Teams a partner\'s captures count for the player to move', () => {
  // Red to move; the only capture in the line is Yellow's (Red's partner) after Red's quiet move.
  const g = fromPieces([...KINGS, [7, 3, ROOK, 0], [7, 6, QUEEN, 1]], { mode: 'teams' });
  const r = analyse(g, { n: 1, timeMs: 300, maxDepth: 3 });
  assert.equal(r.lines[0].gain, 9);
});
