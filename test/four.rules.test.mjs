import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, fromPieces, legalMoves, playMove, findMove, inCheck, attackedBy, sq, squareName, cloneState,
  makeMove, unmakeMove, pieceType, pieceOwner, moveFrom, moveTo, moveFlags, describeResult, isValidSquare,
  captureValue, serialize, deserialize, makePiece, backSquare, promotionPiece, isPromoted, xOf, yOf,
  BISHOP,
  PAWN, KNIGHT, ROOK, QUEEN, KING, FLAG_CASTLE_K, FLAG_CASTLE_Q, FLAG_PROMOTION, CELLS, INVALID,
} from '../public/js/four/rules.js';

const KINGS = [[7, 0, KING, 0], [0, 6, KING, 1], [6, 13, KING, 2], [13, 7, KING, 3]];
const dests = (state, from, p = state.turn) => legalMoves(state, p)
  .filter((m) => moveFrom(m) === sq(...from)).map((m) => squareName(moveTo(m))).sort();
const play = (state, from, to) => {
  const m = findMove(state, sq(...from), sq(...to));
  assert.ok(m !== null, `illegal move ${squareName(sq(...from))}-${squareName(sq(...to))}`);
  return playMove(state, m);
};
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test('board shape: 160 valid squares, corners removed', () => {
  let valid = 0;
  for (let i = 0; i < CELLS; i++) if (isValidSquare(i)) valid++;
  assert.equal(valid, 160);
  assert.ok(!isValidSquare(sq(0, 0)) && !isValidSquare(sq(13, 13)) && !isValidSquare(sq(2, 11)) && isValidSquare(sq(2, 10)));
  assert.ok(isValidSquare(sq(3, 0)) && isValidSquare(sq(0, 3)) && isValidSquare(sq(10, 13)));
});

test('starting position (chess.com Old Standard): 16 pieces each, all kings on light squares, each king facing the opposing queen', () => {
  const g = newGame();
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < CELLS; i++) { const v = g.board[i]; if (v && v !== INVALID) counts[pieceOwner(v)]++; }
  assert.deepEqual(counts, [16, 16, 16, 16]);
  assert.deepEqual(g.kingSq.map(squareName), ['h1', 'a8', 'g14', 'n7'], 'Red h1, Blue a8, Yellow g14, Green n7');
  const queen = (p) => { for (let k = 0; k < 8; k++) if (pieceType(g.board[backSquare(p, k)]) === QUEEN) return squareName(backSquare(p, k)); };
  assert.deepEqual([0, 1, 2, 3].map(queen), ['g1', 'a7', 'h14', 'n8'], 'Red g1, Blue a7, Yellow h14, Green n8');
  // every king stands on a light square (x + y odd) and has the opposing queen straight across the board
  for (const king of g.kingSq) assert.equal((king % 14 + Math.floor(king / 14)) % 2, 1, `${squareName(king)} is a light square`);
  assert.equal(pieceType(g.board[sq(7, 13)]), QUEEN);  // Yellow's queen h14 faces Red's king h1
  assert.equal(pieceType(g.board[sq(13, 7)]), QUEEN);  // Green's queen n8 faces Blue's king a8
  assert.equal(pieceType(g.board[sq(0, 6)]), QUEEN);   // Blue's queen a7 faces Green's king n7
  // the position is symmetric under a half turn: (x, y) -> (13 - x, 13 - y) swaps Red<->Yellow and Blue<->Green
  for (let i = 0; i < CELLS; i++) {
    const v = g.board[i];
    if (!v || v === INVALID) continue;
    const w = g.board[sq(13 - (i % 14), 13 - Math.floor(i / 14))];
    assert.equal(pieceType(w), pieceType(v), `type under half turn at ${squareName(i)}`);
    assert.equal(pieceOwner(w), (pieceOwner(v) + 2) & 3);
  }
});

test('Omatamix setup: Blue and Green swap king and queen, making the whole board symmetric under a quarter turn', () => {
  const g = newGame('ffa', { setup: 'omatamix' });
  assert.deepEqual(g.kingSq.map(squareName), ['h1', 'a7', 'g14', 'n8']);
  for (const king of g.kingSq.slice(1, 2).concat(g.kingSq.slice(3))) assert.equal((king % 14 + Math.floor(king / 14)) % 2, 0, 'Blue and Green kings are on dark squares');
  // a clockwise quarter turn (x, y) -> (y, 13 - x) carries each player's army onto the next player's
  for (let i = 0; i < CELLS; i++) {
    const v = g.board[i];
    if (!v || v === INVALID) continue;
    const w = g.board[sq(Math.floor(i / 14), 13 - (i % 14))];
    assert.equal(pieceType(w), pieceType(v), `type under rotation at ${squareName(i)}`);
    assert.equal(pieceOwner(w), (pieceOwner(v) + 1) & 3);
  }
  for (let p = 0; p < 4; p++) assert.equal(legalMoves(g, p).length, 20);
  assert.throws(() => newGame('ffa', { setup: 'nope' }));
});

test('every player has the 20 usual opening moves', () => {
  const g = newGame();
  for (let p = 0; p < 4; p++) assert.equal(legalMoves(g, p).length, 20, `player ${p}`);
});

test('pawns advance toward the opposite side', () => {
  const g = newGame();
  assert.deepEqual(dests(g, [3, 1], 0), ['d3', 'd4']);   // Red moves up
  assert.deepEqual(dests(g, [1, 10], 1), ['c11', 'd11']); // Blue moves right
  assert.deepEqual(dests(g, [10, 12], 2), ['k11', 'k12']); // Yellow moves down
  assert.deepEqual(dests(g, [12, 3], 3), ['k4', 'l4']);   // Green moves left
});

test('turn order is Red, Blue, Yellow, Green', () => {
  const g = newGame();
  const order = [];
  for (let i = 0; i < 8; i++) {
    order.push(g.turn);
    playMove(g, legalMoves(g)[0]);
  }
  assert.deepEqual(order, [0, 1, 2, 3, 0, 1, 2, 3]);
});

test('check comes from any enemy in FFA, but only from the other team in Teams', () => {
  const ffa = fromPieces([...KINGS, [7, 8, ROOK, 2]], { mode: 'ffa' });
  assert.ok(inCheck(ffa, 0), 'Yellow rook checks Red in FFA');
  const teamsYellow = fromPieces([...KINGS, [7, 8, ROOK, 2]], { mode: 'teams' });
  assert.ok(!inCheck(teamsYellow, 0), 'Yellow is Red\'s teammate');
  const teamsGreen = fromPieces([...KINGS, [7, 8, ROOK, 3]], { mode: 'teams' });
  assert.ok(inCheck(teamsGreen, 0), 'Green is an enemy in Teams');
});

test('teammates cannot capture each other, opponents can', () => {
  const pieces = [...KINGS, [7, 3, ROOK, 0], [7, 6, KNIGHT, 2]];
  assert.ok(dests(fromPieces(pieces, { mode: 'ffa' }), [7, 3]).includes('h7'));
  assert.ok(!dests(fromPieces(pieces, { mode: 'teams' }), [7, 3]).includes('h7'));
});

test('a pinned piece may not move; live kings are never capturable', () => {
  const pinned = fromPieces([...KINGS, [7, 3, KNIGHT, 0], [7, 10, ROOK, 3]]);
  assert.deepEqual(dests(pinned, [7, 3]), []);
  assert.ok(dests(pinned, [7, 0]).length > 0);
  const k = fromPieces([[7, 0, KING, 0], [7, 9, KING, 1], [6, 13, KING, 2], [13, 7, KING, 3], [7, 5, ROOK, 0]]);
  assert.ok(inCheck(k, 1));
  assert.ok(!dests(k, [7, 5]).includes('h10'), 'the rook attacks the Blue king but cannot take it');
  assert.ok(dests(k, [7, 5]).includes('h9'));
});

const MATE = [[7, 0, KING, 0], [0, 3, KING, 1], [7, 13, KING, 2], [13, 7, KING, 3], [5, 3, ROOK, 0], [5, 10, ROOK, 0]];

test('FFA checkmate: +20 to the player who delivered it, the mated player is out, play skips them', () => {
  const g = fromPieces(MATE, { mode: 'ffa' });
  const ev = play(g, [5, 10], [5, 4]);
  assert.deepEqual(ev.eliminated, [{ player: 1, reason: 'checkmate', by: 0 }]);
  assert.equal(g.score[0], 20);
  assert.ok(g.eliminated[1] && !g.result);
  assert.equal(g.turn, 2);                    // Yellow is next; Blue is skipped
  play(g, [7, 13], [7, 12]);
  assert.equal(g.turn, 3);
  play(g, [13, 7], [13, 8]);
  assert.equal(g.turn, 0, 'Blue is skipped on the way back to Red');
  assert.ok(!inCheck(g, 1), 'a mated player\'s king is dead');
});

test('Teams checkmate ends the game for the checkmating team', () => {
  const g = fromPieces(MATE, { mode: 'teams' });
  const ev = play(g, [5, 10], [5, 4]);
  assert.ok(ev.over);
  assert.equal(g.result.type, 'win-team');
  assert.equal(g.result.winnerTeam, 0);
  assert.equal(g.result.loser, 1);
  assert.match(describeResult(g), /Red \+ Yellow win by checkmate of Blue/);
});

const STALE = [[7, 0, KING, 0], [0, 3, KING, 1], [7, 13, KING, 2], [13, 7, KING, 3], [2, 8, QUEEN, 0]];

test('stalemate: the stalemated player scores 20 and is out in FFA; it is a draw in Teams', () => {
  const ffa = fromPieces(STALE, { mode: 'ffa' });
  const ev = play(ffa, [2, 8], [2, 4]);
  assert.ok(!inCheck(ffa, 1));
  assert.deepEqual(ev.eliminated, [{ player: 1, reason: 'stalemate' }]);
  assert.equal(ffa.score[1], 20);
  assert.ok(ffa.eliminated[1] && !ffa.result);
  const teams = fromPieces(STALE, { mode: 'teams' });
  play(teams, [2, 8], [2, 4]);
  assert.deepEqual([teams.result.type, teams.result.reason], ['draw', 'stalemate']);
});

test('FFA ends when three players are eliminated; the highest score wins', () => {
  const g = fromPieces(MATE, { mode: 'ffa' });
  play(g, [5, 10], [5, 4]);
  g.eliminated[2] = true; g.eliminated[3] = true; // pretend two more went out
  g.turn = 0;
  play(g, [7, 0], [7, 1]);
  assert.equal(g.result.type, 'ffa');
  assert.equal(g.result.reason, 'elimination');
  assert.deepEqual(g.result.winners, [0]);
});

test('capture values: pawn 1, knight 3, bishop 5, rook 5, queen 9, promoted queen 1, dead pieces 0', () => {
  const g = fromPieces([...KINGS, [7, 3, ROOK, 0]]);
  const val = (type, owner = 1, promoted = false) => captureValue(g, makePiece(type, owner, promoted));
  assert.deepEqual([val(PAWN), val(KNIGHT), val(3), val(ROOK), val(QUEEN), val(QUEEN, 1, true)], [1, 3, 5, 5, 9, 1]);
  g.eliminated[1] = true;
  assert.equal(val(QUEEN), 0);
  const cap = fromPieces([...KINGS, [7, 3, ROOK, 0], [7, 6, KNIGHT, 1]]);
  play(cap, [7, 3], [7, 6]);
  assert.equal(cap.score[0], 3);
});

test('pawn promotion: the 8th rank in FFA, the 11th in Teams, always to a queen', () => {
  const promo = (mode, p, from, to) => {
    const g = fromPieces([...KINGS, [...from, PAWN, p]], { mode, turn: p });
    const m = findMove(g, sq(...from), sq(...to));
    return m === null ? null : { flags: moveFlags(m), g, m };
  };
  assert.ok(promo('ffa', 0, [4, 6], [4, 7]).flags & FLAG_PROMOTION);
  assert.ok(promo('ffa', 1, [6, 5], [7, 5]).flags & FLAG_PROMOTION);
  assert.ok(promo('ffa', 2, [5, 7], [5, 6]).flags & FLAG_PROMOTION);
  assert.ok(promo('ffa', 3, [7, 5], [6, 5]).flags & FLAG_PROMOTION);
  assert.ok(!(promo('teams', 0, [4, 6], [4, 7]).flags & FLAG_PROMOTION), '8th rank is not a promotion in Teams');
  assert.ok(promo('teams', 0, [4, 9], [4, 10]).flags & FLAG_PROMOTION);
  assert.ok(promo('teams', 2, [5, 4], [5, 3]).flags & FLAG_PROMOTION);
  const { g, m } = promo('ffa', 0, [4, 6], [4, 7]);
  playMove(g, m);
  const v = g.board[sq(4, 7)];
  assert.equal(pieceType(v), QUEEN);
  assert.equal(captureValue(g, v), 1, 'a promoted queen is worth a pawn when captured');
});

test('promotion choice: FFA promotes to a queen automatically, Teams offers Q/R/B/N, FFA can opt in to choosing', () => {
  const pieces = [...KINGS, [4, 6, PAWN, 0]];
  const promos = (state) => legalMoves(state).filter((m) => moveFlags(m) & FLAG_PROMOTION).map(promotionPiece).sort();
  assert.deepEqual(promos(fromPieces(pieces, { mode: 'ffa' })), [QUEEN], 'FFA: one automatic queen move');
  assert.deepEqual(promos(fromPieces([...KINGS, [4, 9, PAWN, 0]], { mode: 'teams' })), [KNIGHT, BISHOP, ROOK, QUEEN].sort(), 'Teams: all four pieces');
  assert.deepEqual(promos(fromPieces(pieces, { mode: 'ffa', choosePromotion: true })), [KNIGHT, BISHOP, ROOK, QUEEN].sort(), 'FFA with the choose option');
  // underpromotion: the chosen piece appears, flagged as promoted, notated and worth a pawn when captured
  const g = fromPieces([...KINGS, [4, 9, PAWN, 0]], { mode: 'teams' });
  const ev = playMove(g, findMove(g, sq(4, 9), sq(4, 10), KNIGHT));
  assert.equal(pieceType(g.board[sq(4, 10)]), KNIGHT);
  assert.ok(isPromoted(g.board[sq(4, 10)]));
  assert.match(ev.text, /=N$/);
  assert.equal(captureValue(g, g.board[sq(4, 10)]), 1);
  // the default findMove picks the queen
  assert.equal(promotionPiece(findMove(fromPieces([...KINGS, [4, 9, PAWN, 0]], { mode: 'teams' }), sq(4, 9), sq(4, 10))), QUEEN);
  // promotion by capture offers the same choices
  const cap = fromPieces([...KINGS, [4, 9, PAWN, 0], [5, 10, ROOK, 1]], { mode: 'teams' });
  assert.equal(legalMoves(cap).filter((m) => moveTo(m) === sq(5, 10)).length, 4);
  // a promoted piece moves on as a promoted piece
  const h = fromPieces([...KINGS, [4, 9, PAWN, 0]], { mode: 'teams' });
  playMove(h, findMove(h, sq(4, 9), sq(4, 10), ROOK));
  assert.ok(isPromoted(h.board[sq(4, 10)]) && pieceType(h.board[sq(4, 10)]) === ROOK);
  // serialize keeps the option
  assert.equal(deserialize(serialize(fromPieces(pieces, { choosePromotion: true }))).choosePromotion, true);
});

test('castling: both sides for every player in both setups, rook hops over; blocked by attacks, check, and lost rights', () => {
  for (const setup of ['standard', 'omatamix']) {
    for (let p = 0; p < 4; p++) {
      const g = newGame('ffa', { setup });
      const kk = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => pieceType(g.board[backSquare(p, k)]) === KING);
      for (let k = 1; k < 7; k++) if (k !== kk) g.board[backSquare(p, k)] = 0; // only the king and the two rooks remain
      g.turn = p;
      const castles = legalMoves(g, p).filter((m) => moveFlags(m) & (FLAG_CASTLE_K | FLAG_CASTLE_Q));
      assert.equal(castles.length, 2, `${setup}: player ${p} has both castling moves`);
      const kside = castles.find((m) => moveFlags(m) & FLAG_CASTLE_K);
      const qside = castles.find((m) => moveFlags(m) & FLAG_CASTLE_Q);
      assert.equal(moveTo(kside), backSquare(p, kk + 2), `${setup} ${p}: the king moves two squares toward the far rook`);
      assert.equal(moveTo(qside), backSquare(p, kk - 2));
      const h = cloneState(g);
      playMove(h, kside);
      assert.equal(pieceType(h.board[backSquare(p, kk + 2)]), KING);
      assert.equal(pieceType(h.board[backSquare(p, kk + 1)]), ROOK, 'the rook lands on the square the king crossed');
      assert.equal(h.board[backSquare(p, 7)], 0);
      assert.equal(h.board[backSquare(p, kk)], 0);
      assert.equal(h.castle & (3 << (2 * p)), 0, 'rights are gone after castling');
      const q = cloneState(g);
      playMove(q, qside);
      assert.equal(pieceType(q.board[backSquare(p, kk - 2)]), KING);
      assert.equal(pieceType(q.board[backSquare(p, kk - 1)]), ROOK);
      assert.equal(q.board[backSquare(p, 0)], 0);
    }
  }
  // standard Blue/Green kings stand on k=3, so their short side is the near rook: king k=1, rook k=2
  const blue = newGame();
  for (const k of [1, 2, 4, 5, 6]) blue.board[backSquare(1, k)] = 0;
  blue.turn = 1;
  assert.ok(legalMoves(blue, 1).some((m) => moveTo(m) === backSquare(1, 1) && moveFlags(m) & FLAG_CASTLE_Q));
  // Red: an enemy rook eyes the square the king must cross (i1)
  const attacked = newGame();
  for (const k of [1, 2, 3, 5, 6]) attacked.board[backSquare(0, k)] = 0;
  attacked.board[sq(8, 1)] = 0;
  attacked.board[sq(8, 5)] = makePiece(ROOK, 1);
  let flags = legalMoves(attacked, 0).map(moveFlags);
  assert.ok(!flags.some((f) => f & FLAG_CASTLE_K), 'cannot castle through an attacked square');
  assert.ok(flags.some((f) => f & FLAG_CASTLE_Q));
  // Red in check: no castling at all
  const inChk = newGame();
  for (const k of [1, 2, 3, 5, 6]) inChk.board[backSquare(0, k)] = 0;
  inChk.board[sq(7, 1)] = 0;
  inChk.board[sq(7, 5)] = makePiece(ROOK, 1);
  assert.ok(inCheck(inChk, 0));
  flags = legalMoves(inChk, 0).map(moveFlags);
  assert.ok(!flags.some((f) => f & (FLAG_CASTLE_K | FLAG_CASTLE_Q)));
  // moving the rook forfeits that side
  const moved = newGame();
  for (const k of [1, 2, 3, 5, 6]) moved.board[backSquare(0, k)] = 0;
  moved.board[sq(10, 1)] = 0;
  play(moved, [10, 0], [10, 3]);                       // Red rook out
  moved.turn = 0;
  assert.equal(moved.castle & 1, 0);
  assert.ok(!legalMoves(moved, 0).some((m) => moveFlags(m) & FLAG_CASTLE_K));
});

test('dead pieces neither attack nor score when captured', () => {
  const g = fromPieces([...KINGS, [7, 5, ROOK, 1], [7, 3, ROOK, 0]], { eliminated: [false, true, false, false] });
  assert.ok(!inCheck(g, 0), 'a dead rook gives no check');
  assert.ok(!attackedBy(g, sq(7, 0), 0));
  assert.ok(dests(g, [7, 3]).includes('h6'), 'a dead piece can be captured');
  play(g, [7, 3], [7, 5]);
  assert.equal(g.score[0], 0);
});

test('forking several kings: +1 / +5 for two (queen / other), +5 / +20 for three', () => {
  const setup = (type, three) => fromPieces([
    [7, 0, KING, 0], [2, 7, KING, 1], [7, 12, KING, 2], three ? [12, 7, KING, 3] : [13, 5, KING, 3], [7, 3, type, 0],
  ]);
  const gain = (type, three) => { const g = setup(type, three); play(g, [7, 3], [7, 7]); return g.score[0]; };
  assert.equal(gain(QUEEN, false), 1);
  assert.equal(gain(ROOK, false), 5);
  assert.equal(gain(QUEEN, true), 5);
  assert.equal(gain(ROOK, true), 20);
});

test('draws: insufficient material, 50 rounds without progress, threefold repetition', () => {
  const kingsOnly = fromPieces(KINGS, { mode: 'ffa' });
  play(kingsOnly, [7, 0], [7, 1]);
  assert.deepEqual([kingsOnly.result.type, kingsOnly.result.reason], ['ffa', 'insufficient-material']);
  assert.deepEqual(kingsOnly.score, [10, 10, 10, 10], 'each remaining player gets 10 in FFA');
  const teams = fromPieces(KINGS, { mode: 'teams' });
  play(teams, [7, 0], [7, 1]);
  assert.deepEqual([teams.result.type, teams.result.reason], ['draw', 'insufficient-material']);

  const slow = fromPieces([...KINGS, [4, 4, ROOK, 0]]);
  slow.halfmove = 199;
  play(slow, [7, 0], [7, 1]);
  assert.equal(slow.result.reason, 'fifty-move');

  const rep = fromPieces([...KINGS, [4, 4, ROOK, 0]]);
  const trips = [[[7, 0], [7, 1]], [[0, 6], [1, 6]], [[6, 13], [6, 12]], [[13, 7], [12, 7]]];
  for (let round = 0; round < 2 && !rep.result; round++) {
    for (const [a, b] of trips) play(rep, a, b);
    for (const [a, b] of trips) if (!rep.result) play(rep, b, a);
  }
  assert.equal(rep.result?.reason, 'repetition');
});

test('make/unmake restores the position exactly, for every legal move', () => {
  const rnd = mulberry32(11);
  const g = newGame();
  for (let ply = 0; ply < 60 && !g.result; ply++) {
    const moves = legalMoves(g);
    for (const m of moves) {
      const before = { board: g.board.slice(), castle: g.castle, kings: [...g.kingSq], half: g.halfmove, ply: g.ply };
      const u = makeMove(g, m);
      unmakeMove(g, u);
      assert.deepEqual([...g.board], [...before.board]);
      assert.deepEqual([g.castle, g.kingSq, g.halfmove, g.ply], [before.castle, before.kings, before.half, before.ply]);
    }
    playMove(g, moves[Math.floor(rnd() * moves.length)]);
  }
});

test('serialize / deserialize keep the position playable', () => {
  const g = newGame();
  for (let i = 0; i < 10; i++) playMove(g, legalMoves(g)[i % 5]);
  const h = deserialize(JSON.parse(JSON.stringify({ ...serialize(g), board: [...g.board] })));
  assert.deepEqual(legalMoves(h), legalMoves(g));
});

test('random playouts keep every invariant (FFA and Teams)', () => {
  for (let game = 0; game < 16; game++) {
    const rnd = mulberry32(1000 + game);
    const g = newGame(game % 2 ? 'teams' : 'ffa');
    let pieces = 64;
    for (let ply = 0; ply < 500 && !g.result; ply++) {
      const p = g.turn;
      assert.ok(!g.eliminated[p], 'the player to move is active');
      const moves = legalMoves(g);
      assert.ok(moves.length > 0, `player ${p} to move must have a legal move (game ${game}, ply ${ply})`);
      // prefer captures a third of the time so games actually change shape
      const caps = moves.filter((m) => g.board[moveTo(m)]);
      const pool = caps.length && rnd() < 0.33 ? caps : moves;
      playMove(g, pool[Math.floor(rnd() * pool.length)]);
      assert.ok(!g.eliminated[p] && !attackedBy(g, g.kingSq[p], p), 'a mover is never left in check by their own move');
      let n = 0;
      for (let i = 0; i < CELLS; i++) { const v = g.board[i]; if (v && v !== INVALID) n++; }
      assert.ok(n <= pieces, 'pieces never appear from nowhere');
      pieces = n;
      for (let q = 0; q < 4; q++) {
        if (g.eliminated[q]) continue;
        assert.equal(g.board[g.kingSq[q]], makePiece(KING, q), `live king of ${q} is where we think`);
      }
      // a live pawn can never stand on or beyond its promotion line: it would have promoted
      const line = g.mode === 'teams' ? [10, 10, 3, 3] : [7, 7, 6, 6];
      for (let i = 0; i < CELLS; i++) {
        const v = g.board[i];
        if (!v || v === INVALID || pieceType(v) !== PAWN || g.eliminated[pieceOwner(v)]) continue;
        const o = pieceOwner(v);
        const past = o === 0 ? yOf(i) >= line[0] : o === 1 ? xOf(i) >= line[1] : o === 2 ? yOf(i) <= line[2] : xOf(i) <= line[3];
        assert.ok(!past, `${g.mode}: pawn of ${o} on ${squareName(i)} should have promoted`);
      }
    }
    if (g.result) assert.ok(describeResult(g).length > 0);
  }
});
