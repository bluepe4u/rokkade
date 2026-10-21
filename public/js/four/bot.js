// Bots for four-player chess. Stockfish and Maia-2 only know two-player chess, so these are
// small purpose-built searchers.
//
//  level 1 "Beginner"  random legal moves, usually grabbing a capture when one exists
//  level 2 "Casual"    one ply: takes the best-looking immediate position, blind to recaptures
//  level 3 "Club"      alpha-beta, about 3 plies + capture search, under a time limit
//  level 4 "Strong"    deeper iterative deepening, longer time limit, less randomness
//
// The search is "paranoid": from the bot's seat everyone who is not on its side (in FFA that is
// all three others, in Teams the other team) tries to minimise the bot's evaluation, while its
// teammate cooperates. Position values are always from the bot's point of view.
import {
  CELLS, INVALID, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  pseudoMoves, makeMove, unmakeMove, attackedBy, legalMoves, nextActive,
  moveFrom, moveTo, moveFlags, FLAG_PROMOTION, TEAM, promotionPiece,
  captureValue, moveText, isFriend, pieceType, pieceOwner,
} from './rules.js';

export const LEVEL_NAMES = ['', 'Beginner', 'Casual', 'Club', 'Strong'];

const VALUE = [0, 100, 300, 320, 500, 900, 0];
const MATE = 100000;
const INF = 1e9;

const LEVELS = {
  2: { depth: 1, qdepth: 0, temp: 40, margin: 250, timeMs: 0 },
  3: { depth: 3, qdepth: 3, temp: 18, margin: 60, timeMs: 900 },
  4: { depth: 7, qdepth: 6, temp: 5, margin: 25, timeMs: 2800 },
};

// ───────────────────────── evaluation ─────────────────────────
const CENTRE = 6.5;
function placement(type, owner, x, y) {
  const dist = Math.max(Math.abs(x - CENTRE), Math.abs(y - CENTRE));
  if (type === KNIGHT || type === BISHOP) return 26 - 7 * dist;
  if (type === QUEEN) return 8 - 2 * dist;
  if (type === ROOK) return 0;
  // steps from the owner's own back rank
  const steps = owner === 0 ? y : owner === 1 ? x : owner === 2 ? 13 - y : 13 - x;
  if (type === PAWN) return 5 * Math.max(0, steps - 1) + (steps >= 6 ? 15 * (steps - 5) : 0) + 4 * (3 - Math.min(3, Math.abs(((owner & 1) ? y : x) - CENTRE)));
  if (type === KING) return -14 * steps; // keep the king at home
  return 0;
}

/** Static evaluation from `root`'s point of view (positive = good for the root's side). */
export function evaluate(state, root) {
  const b = state.board;
  const sum = [0, 0, 0, 0];
  for (let i = 0; i < CELLS; i++) {
    const v = b[i];
    if (!v || v === INVALID) continue;
    const o = (v >> 3) & 3;
    if (state.eliminated[o]) continue;
    const t = v & 7;
    sum[o] += VALUE[t] + placement(t, o, i % 14, (i / 14) | 0);
  }
  if (state.mode === 'teams') {
    let mine = 0;
    let theirs = 0;
    for (let o = 0; o < 4; o++) { if (TEAM[o] === TEAM[root]) mine += sum[o]; else theirs += sum[o]; }
    return mine - theirs;
  }
  let others = 0;
  let live = 0;
  for (let o = 0; o < 4; o++) { if (o !== root && !state.eliminated[o]) { others += sum[o]; live++; } }
  return sum[root] - (live ? others / live : 0);
}

// ───────────────────────── search ─────────────────────────
function victimValue(state, v) {
  if (!v) return 0;
  if (state.eliminated[(v >> 3) & 3]) return 0;
  return VALUE[v & 7];
}

function orderMoves(state, moves) {
  const b = state.board;
  const scored = moves.map((m) => {
    const victim = victimValue(state, b[moveTo(m)]);
    const attacker = VALUE[b[moveFrom(m)] & 7];
    let s = victim ? 10 * victim - attacker / 10 : 0;
    if (moveFlags(m) & FLAG_PROMOTION) s += promotionPiece(m) === QUEEN ? 900 : 300;
    return [s, m];
  });
  scored.sort((a, c) => c[0] - a[0]);
  return scored.map((x) => x[1]);
}

function terminal(state, ctx, mover, ply) {
  const inChk = attackedBy(state, state.kingSq[mover], mover);
  if (state.mode === 'teams') {
    if (!inChk) return 0;
    return ctx.friendly[mover] ? -(MATE - ply) : MATE - ply;
  }
  if (inChk) return mover === ctx.root ? -(MATE - ply) : 150;
  return mover === ctx.root ? -300 : 100;
}

function qsearch(state, ctx, mover, alpha, beta, qd) {
  const stand = evaluate(state, ctx.root);
  if (qd <= 0 || ctx.stop) return stand;
  const maximizing = ctx.friendly[mover];
  let best = stand;
  if (maximizing) { if (stand >= beta) return stand; if (stand > alpha) alpha = stand; }
  else { if (stand <= alpha) return stand; if (stand < beta) beta = stand; }
  const b = state.board;
  const caps = pseudoMoves(state, mover).filter((m) => victimValue(state, b[moveTo(m)]) > 0 || (moveFlags(m) & FLAG_PROMOTION));
  const nextP = ctx.next[mover];
  for (const m of orderMoves(state, caps)) {
    const u = makeMove(state, m);
    if (attackedBy(state, state.kingSq[mover], mover)) { unmakeMove(state, u); continue; }
    const v = qsearch(state, ctx, nextP, alpha, beta, qd - 1);
    unmakeMove(state, u);
    if (maximizing) { if (v > best) best = v; if (best > alpha) alpha = best; }
    else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}

function search(state, ctx, mover, depth, alpha, beta, ply) {
  if (ctx.stop) return 0;
  if (ctx.pvLen) ctx.pvLen[ply] = 0;
  if (depth <= 0) return qsearch(state, ctx, mover, alpha, beta, ctx.qdepth);
  if ((++ctx.nodes & 511) === 0 && ctx.deadline && performance.now() > ctx.deadline) { ctx.stop = true; return 0; }
  const maximizing = ctx.friendly[mover];
  const nextP = ctx.next[mover];
  let best = maximizing ? -INF : INF;
  let legal = 0;
  for (const m of orderMoves(state, pseudoMoves(state, mover))) {
    const u = makeMove(state, m);
    if (attackedBy(state, state.kingSq[mover], mover)) { unmakeMove(state, u); continue; }
    legal++;
    const v = search(state, ctx, nextP, depth - 1, alpha, beta, ply + 1);
    unmakeMove(state, u);
    if (ctx.stop) return 0;
    if (maximizing ? v > best : v < best) {
      best = v;
      if (ctx.pvLen) { // this move is now the node's best: its line is the move plus the child's line
        const here = ctx.pv[ply];
        const below = ctx.pv[ply + 1];
        here[0] = m;
        const len = ctx.pvLen[ply + 1];
        for (let i = 0; i < len; i++) here[i + 1] = below[i];
        ctx.pvLen[ply] = len + 1;
      }
    }
    if (maximizing) { if (best > alpha) alpha = best; } else if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return legal === 0 ? terminal(state, ctx, mover, ply) : best;
}

// ───────────────────────── choosing a move ─────────────────────────
function sample(scored, temp, margin, rng) {
  const best = scored[0].value;
  const pool = scored.filter((s) => s.value >= best - margin);
  const weights = pool.map((s) => Math.exp((s.value - best) / Math.max(temp, 1e-6)));
  let x = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i];
    if (x <= 0) return pool[i];
  }
  return pool[0];
}

/**
 * Pick a move for the player to move.
 * @returns {{move: number, value: number, depth: number, nodes: number}|null}
 */
export function chooseMove(state, level = 3, { rng = Math.random, timeMs } = {}) {
  const root = state.turn;
  const moves = legalMoves(state, root);
  if (!moves.length) return null;
  if (moves.length === 1) return { move: moves[0], value: 0, depth: 0, nodes: 0 };

  if (level <= 1) {
    const caps = moves.filter((m) => victimValue(state, state.board[moveTo(m)]) > 0);
    const pool = caps.length && rng() < 0.6 ? caps : moves;
    return { move: pool[Math.floor(rng() * pool.length)], value: 0, depth: 0, nodes: 0 };
  }

  const cfg = LEVELS[Math.min(4, level)];
  const next = [0, 1, 2, 3].map((p) => nextActive(state, p));
  const friendly = [0, 1, 2, 3].map((p) => p === root || (state.mode === 'teams' && TEAM[p] === TEAM[root]));
  const limit = timeMs ?? cfg.timeMs;
  const ctx = { root, next, friendly, qdepth: cfg.qdepth, nodes: 0, stop: false, deadline: limit ? performance.now() + limit : 0 };

  let ordered = orderMoves(state, moves);
  let result = ordered.map((m) => ({ move: m, value: 0 }));
  let reached = 0;
  for (let depth = 1; depth <= cfg.depth; depth++) {
    const scored = [];
    let best = -INF;
    for (const m of ordered) {
      const u = makeMove(state, m);
      const alpha = Math.max(best - cfg.margin, -INF);
      const v = search(state, ctx, next[root], depth - 1, alpha, INF, 1);
      unmakeMove(state, u);
      if (ctx.stop) break;
      scored.push({ move: m, value: v });
      if (v > best) best = v;
    }
    if (ctx.stop) break;
    scored.sort((a, c) => c.value - a.value);
    result = scored;
    reached = depth;
    ordered = scored.map((s) => s.move);
    if (best > MATE - 100) break; // a forced win was found
  }
  const picked = sample(result, cfg.temp, cfg.margin, rng);
  return { move: picked.move, value: picked.value, depth: reached, nodes: ctx.nodes };
}


// ───────────────────────── analysis: the best n moves ─────────────────────────
const PIECE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

/**
 * Replay a line without scoring, reporting each ply and how the material balance changes for the
 * player to move at the root (and, in Teams, their partner): what their side wins and loses.
 */
export function describeLine(state, line, me) {
  const undos = [];
  const steps = [];
  const gained = [];
  const lost = [];
  let gain = 0;
  let loss = 0;
  for (const m of line) {
    const from = moveFrom(m);
    const to = moveTo(m);
    const piece = state.board[from];
    const captured = state.board[to];
    const mover = pieceOwner(piece);
    steps.push({ player: mover, move: m, text: moveText(piece, from, to, captured, moveFlags(m)) });
    const value = captureValue(state, captured);
    if (captured && value > 0) {
      const victim = pieceOwner(captured);
      if (isFriend(state, me, mover) && !isFriend(state, me, victim)) { gain += value; gained.push({ owner: victim, type: pieceType(captured), value }); }
      else if (isFriend(state, me, victim) && !isFriend(state, me, mover)) { loss += value; lost.push({ owner: victim, type: pieceType(captured), value }); }
    }
    undos.push(makeMove(state, m));
  }
  while (undos.length) unmakeMove(state, undos.pop());
  return { steps, gain, loss, delta: gain - loss, gained, lost };
}

/** "Wins a knight", "Even trade", "Loses 5 points" ... */
export function describeMaterial({ gained, lost, delta }) {
  if (!gained.length && !lost.length) return 'No material change';
  if (delta === 0) return 'Even trade';
  const side = delta > 0 ? gained : lost;
  const verb = delta > 0 ? 'Wins' : 'Loses';
  const other = delta > 0 ? lost : gained;
  if (side.length === 1 && !other.length) return `${verb} a ${PIECE_NAMES[side[0].type]}`;
  const n = Math.abs(delta);
  return `${verb} ${n} point${n === 1 ? '' : 's'}`;
}

/**
 * The best `n` moves for the player to move, found by iterative deepening, each with its
 * evaluation (centipawn-like, from the mover's side's point of view) and principal variation.
 * Reports every completed depth through `onDepth`.
 * @returns {{lines: Array, depth: number, nodes: number}}
 */
export function analyse(state, { n = 3, timeMs = 2500, maxDepth = 8, qdepth = 5, onDepth } = {}) {
  const root = state.turn;
  const moves = legalMoves(state, root);
  const next = [0, 1, 2, 3].map((p) => nextActive(state, p));
  const friendly = [0, 1, 2, 3].map((p) => p === root || (state.mode === 'teams' && TEAM[p] === TEAM[root]));
  const ctx = {
    root, next, friendly, qdepth, nodes: 0, stop: false, deadline: timeMs ? performance.now() + timeMs : 0,
    pv: Array.from({ length: 48 }, () => new Array(48).fill(0)), pvLen: new Int32Array(48),
  };
  const decorate = (top) => top.map((t, i) => ({
    rank: i + 1, move: t.move, value: t.value, line: t.pv, ...describeLine(state, t.pv, root),
  }));

  let ordered = orderMoves(state, moves);
  let result = ordered.slice(0, n).map((m) => ({ move: m, value: 0, pv: [m] }));
  let reached = 0;
  for (let depth = 1; depth <= maxDepth && moves.length; depth++) {
    const top = [];
    for (const m of ordered) {
      const u = makeMove(state, m);
      ctx.pvLen[1] = 0;
      // only moves that beat the current n-th best need an exact score
      const alpha = top.length < n ? -INF : top[n - 1].value;
      const v = search(state, ctx, next[root], depth - 1, alpha, INF, 1);
      unmakeMove(state, u);
      if (ctx.stop) break;
      if (top.length < n || v > top[n - 1].value) {
        top.push({ move: m, value: v, pv: [m, ...ctx.pv[1].slice(0, ctx.pvLen[1])] });
        top.sort((a, c) => c.value - a.value);
        if (top.length > n) top.pop();
      }
    }
    if (ctx.stop) break;
    result = top;
    reached = depth;
    ordered = [...top.map((t) => t.move), ...ordered.filter((m) => !top.some((t) => t.move === m))];
    if (onDepth) onDepth({ depth, nodes: ctx.nodes, lines: decorate(top) });
    if (top.length && top[0].value > MATE - 100) break; // a forced win
  }
  return { lines: decorate(result), depth: reached, nodes: ctx.nodes };
}
