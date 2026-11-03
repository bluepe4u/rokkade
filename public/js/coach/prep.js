// Opponent preparation: from a chess.com player's recent public games, what they play with each
// colour, how they score, how their games end, and what to expect against your library.
import { prepGames, agg, groupBy } from './games.js';
import { moveLabel } from './library.js';
import { clockData, parseTC } from './clock.js';

const prefixGames = (L, pre) => L.filter((x) => x.sans.length > pre.length && pre.every((s, i) => x.sans[i] === s));

/** Their move choices after a SAN prefix, for games where they had `col`. */
export function choices(L, pre) {
  const G = prefixGames(L, pre);
  const M = groupBy(G, (x) => x.sans[pre.length]);
  return [...M].map(([san, gs]) => ({ san, n: gs.length, share: gs.length / G.length, a: agg(gs) })).sort((a, b) => b.n - a.n);
}

/**
 * What to expect when you play `side` against them: walk your library; on their turn follow their
 * most frequent reply, noting the alternatives and any reply your library doesn't cover.
 */
export function expectedLines(lib, side, theirGames, maxPly = 16) {
  const L = theirGames.filter((x) => x.col !== side); // they have the other colour
  const lines = [];
  const gaps = [];
  const walk = (pre, node, depth) => {
    if (depth >= maxPly || lines.length >= 6) { lines.push({ pre, n: prefixGames(L, pre).length }); return; }
    const myTurn = (pre.length % 2 === 0) === (side === 'w');
    const book = node >= 0 ? lib.book(side, node) : [];
    if (myTurn) {
      if (!book.length) { lines.push({ pre, n: prefixGames(L, pre).length, end: true }); return; }
      // pick your library move they have faced most (or the first one)
      const ranked = book.map((e) => ({ e, n: prefixGames(L, [...pre, e.s]).length })).sort((a, b) => b.n - a.n);
      const e = ranked[0].e;
      walk([...pre, e.s], e.n, depth + 1);
      return;
    }
    const ch = choices(L, pre);
    if (!ch.length) { lines.push({ pre, n: 0 }); return; }
    const covered = (san) => node >= 0 && lib.node(side, node).e.some((q) => q.s === san);
    for (const c of ch) if (!covered(c.san) && c.n >= 2 && c.share >= 0.15) gaps.push({ pre, san: c.san, n: c.n, share: c.share, a: c.a, label: `${moveLabel(pre.length)}${c.san}` });
    const top = ch[0];
    if (!covered(top.san)) { lines.push({ pre: [...pre, top.san], n: top.n, gap: true }); return; }
    const edge = lib.node(side, node).e.find((q) => q.s === top.san);
    walk([...pre, top.san], edge.n, depth + 1);
  };
  walk([], 0, 0);
  return { lines, gaps: gaps.sort((a, b) => b.n - a.n).slice(0, 6) };
}

/**
 * raw: chess.com games of the player (any months); name: their username; lib: your library;
 * myGames: your prepped games (for head-to-head).
 */
export function buildPrep(name, raw, { lib, myGames = [] } = {}) {
  const G = prepGames(raw, name);
  if (!G.length) return { name, n: 0 };
  const byCol = { w: G.filter((x) => x.col === 'w'), b: G.filter((x) => x.col === 'b') };
  const res = (x) => (x.col === 'w' ? x.g.white.result : x.g.black.result);
  const losses = G.filter((x) => x.sc === 0);
  const tcs = [...groupBy(G, (x) => x.tc)].map(([tc, L]) => ({ tc, n: L.length, a: agg(L), rating: L.at(-1).myR })).sort((a, b) => b.n - a.n);
  const fams = (L) => [...groupBy(L.filter((x) => x.fam !== 'Unknown'), (x) => x.fam)].map(([fam, gs]) => ({ fam, n: gs.length, a: agg(gs) })).sort((a, b) => b.n - a.n).slice(0, 6);
  // clock habits
  let trouble = 0;
  let withClk = 0;
  for (const x of G) {
    const d = clockData(x);
    if (d.length < 5) continue;
    withClk++;
    const base = parseTC(x.g.time_control)?.base || Math.max(...d.map((m) => m.left));
    if (Math.min(...d.map((m) => m.left)) < Math.max(10, base * 0.1)) trouble++;
  }
  const h2h = myGames.filter((x) => (x.opp || '').toLowerCase() === name.toLowerCase());
  return {
    name, n: G.length, a: agg(G), tcs,
    first: { t: G[0].t, last: G.at(-1).t },
    asWhite: { n: byCol.w.length, a: agg(byCol.w), first: choices(byCol.w, []), fams: fams(byCol.w) },
    asBlack: { n: byCol.b.length, a: agg(byCol.b), vsE4: choices(byCol.b, ['e4']), vsD4: choices(byCol.b, ['d4']), fams: fams(byCol.b) },
    ends: {
      losses: losses.length,
      mated: losses.filter((x) => res(x) === 'checkmated').length,
      time: losses.filter((x) => res(x) === 'timeout').length,
      resigned: losses.filter((x) => res(x) === 'resigned').length,
      early: losses.filter((x) => x.sans.length <= 50).length,
    },
    clock: withClk >= 5 ? { games: withClk, trouble: trouble / withClk } : null,
    you: lib ? { w: expectedLines(lib, 'w', G), b: expectedLines(lib, 'b', G) } : null,
    h2h: { n: h2h.length, a: agg(h2h), games: h2h.slice(-5).reverse() },
    games: G,
  };
}
