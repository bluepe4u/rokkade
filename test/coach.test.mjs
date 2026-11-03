import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../public/vendor/chess.js';
import { Library, moveLabel, sanLine } from '../public/js/coach/library.js';
import { pgnSans, prepGames, agg, fit, opening, mostCommon } from '../public/js/coach/games.js';
import { classify, accuracyOf, bookPlies } from '../public/js/coach/analysis.js';
import { catchDiscoveries, mergeItem, mergeDocs, summarize, statusOf, analyseDiscovery, studiedLine, fenOf, discoveryId } from '../public/js/coach/discoveries.js';

const game = (id, col, sans, { sc = 0, t = 1000, opp = 'Opp', ex = 0.5 } = {}) => ({ id, col, sans, sc, t, opp, ex, opR: 1500, myR: 1500, tc: 'blitz', url: `u/${id}`, src: 'chess.com' });

test('library walk: in book, habit, gap and end', () => {
  const L = new Library();
  assert.equal(L.walk('w', ['e4', 'a6', 'd4']).type, 'gap');
  assert.deepEqual(L.walk('w', ['e4', 'a6']), { type: 'gap', ply: 1, node: L.nodeAfter('w', ['e4']), san: 'a6' });
  assert.equal(L.walk('w', ['d4']).type, 'habit');
  assert.equal(L.walk('w', ['e4', 'e5', 'Nf3']).type, 'end');
  assert.equal(moveLabel(0), '1.');
  assert.equal(moveLabel(3), '2...');
  assert.equal(sanLine(['e4', 'e5', 'Nf3']), '1.e4 e5 2.Nf3');
  assert.equal(sanLine(['e5', 'Nf3'], 1), '1...e5 2.Nf3');
});

test('library addLine extends the tree and is idempotent per position', () => {
  const L = new Library();
  const before = L.stats('w');
  const li = L.addLine('w', ['e4', 'a6', 'd4', 'b5'], 'test', 'plan', { from: 'discovery' });
  assert.equal(L.line('w', li).custom, true);
  assert.equal(L.walk('w', ['e4', 'a6', 'd4', 'b5', 'Nf3']).type, 'end');
  assert.equal(L.walk('w', ['e4', 'a6', 'Nf3']).type, 'habit');
  assert.ok(L.hasLine('w', ['e4', 'a6', 'd4', 'b5']));
  assert.equal(L.stats('w').nodes, before.nodes + 3);
  // A transposition reuses the existing node.
  const n = L.stats('w').nodes;
  L.addLine('w', ['e4', 'a6', 'd4', 'b5'], 'again', '');
  assert.equal(L.stats('w').nodes, n);
  // The original data module isn't mutated.
  assert.equal(new Library().stats('w').nodes, before.nodes);
});

test('pgn parsing and chess.com game summaries', () => {
  const pgn = '[Event "Live"]\n[White "Me"]\n\n1. e4 {[%clk 0:02:59.9]} 1... a6 {[%clk 0:02:58]} 2. d4 1-0';
  assert.deepEqual(pgnSans(pgn), ['e4', 'a6', 'd4']);
  const raw = [
    { uuid: 'a', rules: 'chess', pgn, end_time: 20, time_class: 'blitz', rated: true, eco: 'https://www.chess.com/openings/St-Georges-Defense-2.d4', white: { username: 'Me', rating: 1500, result: 'win' }, black: { username: 'X', rating: 1700, result: 'resigned' } },
    { uuid: 'b', rules: 'chess960', pgn, end_time: 10, white: { username: 'Me' }, black: { username: 'Y' } },
    { uuid: 'c', rules: 'chess', pgn: '1. d4 e5 1/2-1/2', end_time: 5, white: { username: 'Z', rating: 1500, result: 'agreed' }, black: { username: 'me', rating: 1500, result: 'agreed' } },
  ];
  const G = prepGames(raw, 'ME');
  assert.equal(G.length, 2);
  assert.equal(G[0].id, 'c');
  assert.equal(G[0].col, 'b');
  assert.equal(G[0].sc, 0.5);
  assert.equal(G[1].sc, 1);
  assert.ok(G[1].ex < 0.5);
  assert.equal(G[1].fam, 'St Georges');
  assert.equal(opening({ eco: 'https://www.chess.com/openings/Kings-Indian-Defense-Fianchetto-Variation' }).fam, "King's Indian Defense");
  const a = agg(G);
  assert.equal(a.n, 2);
  assert.equal(a.sc, 0.75);
});

test('fit and mostCommon', () => {
  const L = new Library();
  const G = [game('1', 'w', ['e4', 'a6']), game('2', 'w', ['e4', 'a6', 'd4']), game('3', 'w', ['d4'])];
  const F = fit(L, G);
  assert.equal(F.gap[0].L.length, 2);
  assert.equal(F.hab[0].san, 'd4');
  assert.deepEqual(mostCommon([game('a', 'w', ['e4', 'e5']), game('b', 'w', ['e4', 'e5']), game('c', 'w', ['e4', 'c5'])]), ['e4']);
});

test('move classes and accuracy', () => {
  assert.equal(classify({ loss: 20 }), 'blunder');
  assert.equal(classify({ loss: 12 }), 'mistake');
  assert.equal(classify({ loss: 6 }), 'inaccuracy');
  assert.equal(classify({ loss: 0, best: true }), 'best');
  assert.equal(classify({ loss: 1 }), 'excellent');
  assert.equal(classify({ loss: 3 }), 'good');
  assert.equal(classify({ loss: 3, inBook: true }), 'book');
  assert.equal(classify({ loss: 12, prevLoss: 20 }), 'miss');
  assert.ok(accuracyOf([0, 0]) > 99);
  assert.ok(accuracyOf([30]) < 30);
  assert.equal(bookPlies({ g: { eco: 'https://www.chess.com/openings/Italian-Game-Two-Knights-Defense-4.Ng5' } }), 7);
});

test('discoveries: caught per position + move, merged across games', () => {
  const L = new Library();
  const G = [
    game('1', 'w', ['e4', 'a6', 'd4', 'b5'], { sc: 1, t: 100 }),
    game('2', 'w', ['e4', 'a6', 'Nf3'], { sc: 0, t: 200 }),
    game('3', 'w', ['e4', 'a6', 'd4'], { sc: 0.5, t: 300 }),
    game('4', 'w', ['d4', 'd5']), // habit, not a discovery
    game('5', 'b', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'h3']),
  ];
  const D = catchDiscoveries(L, G);
  const a6 = D.find((d) => d.move === 'a6');
  assert.ok(a6);
  assert.equal(a6.id, discoveryId('w', L.node('w', L.nodeAfter('w', ['e4'])).k, 'a6'));
  assert.equal(a6.games.length, 3);
  assert.equal(a6.firstSeen, 100);
  assert.deepEqual(a6.games.map((g) => g.reply), ['d4', 'Nf3', 'd4']);
  assert.ok(!D.some((d) => d.side === 'w' && d.move === 'd5'));
  const s = summarize(a6);
  assert.equal(s.status, 'new');
  assert.equal(s.usual.san, 'd4');
  assert.equal(s.usual.n, 2);
  assert.equal(s.usual.a.sc, 0.75);
  assert.equal(s.label, '1...a6');
  assert.match(fenOf(a6), / w KQkq/);
  // Nothing is caught past the 24-ply window.
  const long = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7', 'Kxf7', 'Qf3+', 'Ke6', 'Nc3'];
  assert.equal(catchDiscoveries(L, [game('x', 'w', long)], 4).length, 0);
});

test('discoveries: merge keeps deeper analysis and the latest status', () => {
  const base = { id: 'x', side: 'w', path: ['e4'], move: 'a6', ply: 1, games: [{ id: 'g1', t: 1, reply: null }], analysis: { depth: 20, at: 1 }, firstSeen: 5 };
  const inc = { id: 'x', side: 'w', path: ['e4'], move: 'a6', ply: 1, games: [{ id: 'g1', t: 1, reply: 'd4' }, { id: 'g2', t: 2, reply: 'Nf3' }], analysis: { depth: 12, at: 9 }, studied: { at: 3 }, firstSeen: 2 };
  const m = mergeItem(base, inc);
  assert.equal(m.games.length, 2);
  assert.equal(m.games[0].reply, 'd4');
  assert.equal(m.analysis.depth, 20);
  assert.equal(m.firstSeen, 2);
  assert.equal(statusOf(m), 'studied');
  const undone = mergeItem(m, { ...m, studied: { at: 4, undone: true } });
  assert.notEqual(statusOf(undone), 'studied');
  const doc = mergeDocs({ items: { x: base } }, { items: { y: { ...inc, id: 'y' } } });
  assert.deepEqual(Object.keys(doc.items).sort(), ['x', 'y']);
});

/** Fake engine: every position is +0.3 for the side to move except after Nf3 in the test line. */
class FakeQueue {
  constructor() { this.calls = []; }
  async go(fen, opt) {
    this.calls.push({ fen, ...opt });
    const c = new Chess(fen);
    const moves = c.moves({ verbose: true });
    const n = opt.multipv || 1;
    const lines = moves.slice(0, n).map((m, i) => ({ multipv: i + 1, depth: opt.depth, score: { cp: 60 - i * 40 }, pv: [m.from + m.to + (m.promotion || ''), ...this.#reply(fen, m)] }));
    // Position after the "bad" reply: opponent to move is much better.
    if (fen.includes('5N2') && opt.multipv == null) lines[0].score = { cp: 400 };
    return { lines, best: lines[0].pv[0], score: lines[0].score, pv: lines[0].pv, second: lines[1] || null, depth: opt.depth };
  }
  #reply(fen, m) {
    const c = new Chess(fen);
    c.move(m);
    const r = c.moves({ verbose: true })[0];
    if (!r) return [];
    c.move(r);
    const r2 = c.moves({ verbose: true })[0];
    return [r.from + r.to, ...(r2 ? [r2.from + r2.to] : [])];
  }
}

test('discoveries: deep analysis grades every reply and builds the study line', async () => {
  const L = new Library();
  const [it] = catchDiscoveries(L, [game('1', 'w', ['e4', 'a6', 'd4']), game('2', 'w', ['e4', 'a6', 'Nf3'])]);
  const q = new FakeQueue();
  const opt = { main: 10, mainTime: 0, reply: 8, replyTime: 0, idea: 6, ideaTime: 0 };
  const a = await analyseDiscovery(q, it, opt);
  assert.equal(a.lines.length, 4);
  assert.equal(q.calls[0].multipv, 4);
  assert.ok(a.lines[0].wp > a.lines[3].wp);
  assert.ok(a.replies.d4 && a.replies.Nf3);
  assert.ok(a.replies.Nf3.loss > 0, 'the move off the engine list loses win chance');
  assert.ok(a.idea.length >= 2);
  it.analysis = a;
  const s = summarize(it, 10);
  assert.equal(s.status, 'ready');
  const best = a.lines[0].san;
  const line = studiedLine(it, best);
  assert.deepEqual(line.slice(0, 3), ['e4', 'a6', best]);
  assert.equal(line.length % 2, 1, 'ends on your (White) move');
  const c = new Chess();
  for (const m of line) c.move(m); // legal
  L.addLine('w', line, 't', 'p');
  assert.equal(L.walk('w', [...line, 'h5']).type, 'end', 'past the end of a studied line is not a new hole');
  assert.equal(catchDiscoveries(L, [game('4', 'w', ['e4', 'a6', best])]).length, 0);
});
