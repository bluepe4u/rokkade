// Opening library (the Chess Coach repertoire tree) and the operations on it.
//
// Tree format per side ('w' = you play White, 'b' = you play Black):
//   n:  nodes  {f: board FEN, k: "board side castling" key, t: [lines ending here], p: [lines passing], e: [edges]}
//   e:  edges  {s: SAN, a: from, b: to, n: child node, c: number of lines using it, w: true = "avoid" (a trap)}
//   l:  lines  {t: title, c: chapter title, p: plan text, w: warning line, st: ply to start study at, path, san, custom?}
//   ch: chapter groups [{t, c: [{id, t, l: [line indices]}]}]
import { Chess } from '../../vendor/chess.js';
import DATA from './repertoire-data.js';

export const SIDES = ['w', 'b'];
export const GAMES_GROUP = 'Other lines from your games';
const fen3 = (chess) => chess.fen().split(' ').slice(0, 3).join(' ');

/** "1." / "1..." prefix for ply index i (0 = White's first move). */
export const moveLabel = (i) => `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '...'}`;
export const sanLine = (list, from = 0) => list.map((s, j) => (j === 0 || (from + j) % 2 === 0 ? moveLabel(from + j) : '') + s).join(' ');

export class Library {
  constructor(data = DATA) {
    this.db = structuredClone(data);
    this.keys = {};
    for (const side of SIDES) this.keys[side] = new Map(this.db[side].n.map((n, i) => [n.k, i]));
  }

  side(side) { return this.db[side]; }
  node(side, idx) { return this.db[side].n[idx]; }
  line(side, li) { return this.db[side].l[li]; }

  /** Playable (non-"avoid") edges from a node. */
  book(side, idx) { return this.db[side].n[idx].e.filter((e) => !e.w); }

  /** Node reached by following `list` from the start, or -1 if it leaves the tree. */
  nodeAfter(side, list) {
    const d = this.db[side];
    let cur = 0;
    for (const san of list) {
      const e = d.n[cur].e.find((q) => q.s === san);
      if (!e) return -1;
      cur = e.n;
    }
    return cur;
  }

  /**
   * Follow a game's moves through the library for the side you played.
   *   habit: you played a move the library doesn't (ply = your move)
   *   gap:   the opponent played a move the library has no answer to (ply = their move)
   *   end:   the game reached the end of a line, or ended inside the library
   */
  walk(side, sans) {
    const d = this.db[side];
    let cur = 0;
    for (let i = 0; i < sans.length; i++) {
      const n = d.n[cur];
      const myTurn = (i % 2 === 0) === (side === 'w');
      const e = n.e.find((q) => q.s === sans[i]);
      if (e && !(e.w && myTurn)) { cur = e.n; continue; }
      if (!n.e.some((q) => !q.w)) return { type: 'end', ply: i, node: cur, san: sans[i] };
      return { type: myTurn ? 'habit' : 'gap', ply: i, node: cur, san: sans[i] };
    }
    return { type: 'end', ply: sans.length, node: cur, san: null };
  }

  /** Short description of where a node sits: the line(s) through it. */
  describe(side, idx) {
    const d = this.db[side];
    const n = d.n[idx];
    const ending = n.t.map((i) => d.l[i]);
    if (ending.length) return { title: ending[0].t, chapter: ending[0].c, plan: ending[0].p, lines: n.p.length, warn: ending.some((l) => l.w) };
    if (n.p.length === 1) { const l = d.l[n.p[0]]; return { title: l.t, chapter: l.c, plan: l.p, lines: 1, warn: l.w }; }
    const chapters = [...new Set(n.p.map((i) => d.l[i].c))];
    return { title: null, chapter: chapters[0] || null, chapters, plan: null, lines: n.p.length, warn: false };
  }

  #chapterFor(side, list) {
    const d = this.db[side];
    let cur = 0;
    let depth = 0;
    for (const san of list) {
      const e = d.n[cur].e.find((q) => q.s === san);
      if (!e) break;
      cur = e.n;
      depth++;
    }
    const base = d.n[cur].p.filter((i) => !d.l[i].custom);
    if (depth && base.length) {
      const titles = new Set(base.map((i) => d.l[i].c));
      if (titles.size === 1) {
        const t = [...titles][0];
        for (const g of d.ch) for (const c of g.c) if (c.t === t) return c;
      }
    }
    let g = d.ch.find((x) => x.t === GAMES_GROUP);
    if (!g) { g = { t: GAMES_GROUP, c: [{ id: `cu-${side}`, t: 'Lines from your games', l: [] }] }; d.ch.push(g); }
    return g.c[0];
  }

  /** Is this exact line already in the library (as a line ending at its last node)? */
  hasLine(side, list) {
    const idx = this.nodeAfter(side, list);
    return idx >= 0 && this.db[side].n[idx].t.some((li) => this.db[side].l[li].san.join(' ') === list.join(' '));
  }

  /** Insert a line (SAN list from the start position). Returns the new line index. */
  addLine(side, list, title, plan, extra = {}) {
    const d = this.db[side];
    const ch = this.#chapterFor(side, list);
    const li = d.l.length;
    const km = this.keys[side];
    const b = new Chess();
    let cur = 0;
    const path = [0];
    d.n[0].p.push(li);
    for (const san of list) {
      let e = d.n[cur].e.find((q) => q.s === san);
      const mv = b.move(san);
      if (!e) {
        const k = fen3(b);
        let nx = km.get(k);
        if (nx == null) {
          nx = d.n.length;
          d.n.push({ f: b.fen().split(' ')[0], k, t: [], p: [], e: [] });
          km.set(k, nx);
        }
        e = { s: mv.san, a: mv.from, b: mv.to, n: nx, c: 0, w: false };
        d.n[cur].e.push(e);
      } else {
        e.w = false;
      }
      e.c++;
      cur = e.n;
      path.push(cur);
      if (!d.n[cur].p.includes(li)) d.n[cur].p.push(li);
    }
    d.n[cur].t.push(li);
    d.l.push({ t: title, c: ch.t, p: plan, w: false, st: Math.max(0, list.length - 3), path, san: list.slice(), custom: true, ...extra });
    ch.l.push(li);
    return li;
  }

  /** Apply the saved custom lines (store document "custom"); bad entries are skipped. */
  applyCustom(custom) {
    for (const c of custom || []) {
      try { this.addLine(c.side, c.san, c.title, c.plan, { from: c.from || (c.auto ? 'auto' : 'manual'), date: c.date || null, disc: c.disc || null }); } catch (e) { console.warn('custom line skipped', c, e); }
    }
  }

  /** Lines of one side as [{li, line}] in chapter order. */
  lines(side) { return this.db[side].l.map((line, li) => ({ li, line })); }

  stats(side) {
    const l = this.db[side].l;
    return { lines: l.filter((x) => !x.w).length, custom: l.filter((x) => x.custom).length, nodes: this.db[side].n.length };
  }
}

/** Board FEN + last move after playing `list` from the start. */
export function positionAfter(list) {
  const c = new Chess();
  let mv = null;
  for (const s of list) mv = c.move(s);
  return { fen: c.fen(), move: mv, chess: c };
}
