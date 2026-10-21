// Four-player chess (Red, Blue, Yellow, Green on a 14x14 board with the 3x3 corners removed),
// following the chess.com 4-player rules. Pure logic, no DOM.
//
// Coordinates: x = file 0..13 (a..n), y = rank 0..13 from the bottom (rank 1..14).
// Players sit at Red = bottom, Blue = left, Yellow = top, Green = right, and move in that
// (clockwise) order. Teams mode pairs Red+Yellow against Blue+Green.
//
// Rules implemented
//  - Pieces move as in chess; pawns advance toward the opposite side (Red up, Blue right,
//    Yellow down, Green left) and capture diagonally forward. Double step from the start row.
//  - Promotion on the 8th rank in FFA and the 11th rank in Teams. FFA promotes automatically to
//    a queen (chess.com's rated rule); Teams lets the player choose queen, rook, bishop or knight.
//    FFA can optionally let you choose as well (`choosePromotion`). Any promoted piece is worth
//    1 point when captured.
//  - Castling (king two squares toward either rook, the rook hops over). No en passant.
//  - Starting position: chess.com's Old Standard by default; the Omatamix setup is available (see SETUPS).
//  - A move may not leave your own king attacked by any enemy (everyone in FFA; the other
//    team in Teams). Live kings are never captured: checkmate is declared on the mated
//    player's own turn.
//  - Checkmate eliminates a player. Stalemate eliminates the stalemated player (+20 points)
//    in FFA and is a draw in Teams. An eliminated player's pieces become "dead": they stay
//    on the board as obstacles, no longer move or attack, and capturing them is worth nothing.
//  - FFA scoring: pawn 1, knight 3, bishop 5, rook 5, queen 9, checkmate +20, stalemate +20
//    (to the stalemated player), checking two kings with one move +1 (queen) / +5 (other),
//    three kings +5 / +20. The game ends when three players are eliminated or on a draw
//    (each remaining player then gets +10); the highest score wins.
//  - Teams: the first checkmate wins for that team; stalemate and draws end the game drawn.
//  - Draws: threefold repetition, 200 plies (50 full rounds) without a capture or pawn move,
//    or insufficient material.

export const SIZE = 14;
export const CELLS = SIZE * SIZE;
export const NAMES = ['Red', 'Blue', 'Yellow', 'Green'];
export const TEAM = [0, 1, 0, 1];
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const TYPE_LETTER = ['', '', 'N', 'B', 'R', 'Q', 'K'];
export const INVALID = 255;
const PROMOTED = 32;

export const FLAG_PROMOTION = 1;
export const FLAG_PROMO_SHIFT = 3; // the chosen piece type lives in flag bits 3-5
const PROMO_CHOICES = [QUEEN, ROOK, BISHOP, KNIGHT];
export const FLAG_CASTLE_K = 2;
export const FLAG_CASTLE_Q = 4;

export const DRAW_PLIES = 200;
const MATE_POINTS = 20;
const STALEMATE_POINTS = 20;
const DRAW_POINTS = 10;

// ───────────────────────── geometry ─────────────────────────
const inBoard = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE && !((x < 3 || x > 10) && (y < 3 || y > 10));
export const sq = (x, y) => y * SIZE + x;
export const xOf = (i) => i % SIZE;
export const yOf = (i) => (i / SIZE) | 0;
export const isValidSquare = (i) => i >= 0 && i < CELLS && inBoard(xOf(i), yOf(i));
export const squareName = (i) => String.fromCharCode(97 + xOf(i)) + (yOf(i) + 1);

const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT_OFFS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

const RAYS = []; // RAYS[idx] = 8 arrays of squares (4 rook directions, then 4 bishop directions)
const KNIGHT_TO = [];
const KING_TO = [];
for (let i = 0; i < CELLS; i++) {
  const x = xOf(i);
  const y = yOf(i);
  RAYS.push([]);
  KNIGHT_TO.push([]);
  KING_TO.push([]);
  if (!inBoard(x, y)) continue;
  for (const [dx, dy] of [...ROOK_DIRS, ...BISHOP_DIRS]) {
    const ray = [];
    for (let nx = x + dx, ny = y + dy; inBoard(nx, ny); nx += dx, ny += dy) ray.push(sq(nx, ny));
    RAYS[i].push(ray);
    if (ray.length) KING_TO[i].push(ray[0]);
  }
  for (const [dx, dy] of KNIGHT_OFFS) if (inBoard(x + dx, y + dy)) KNIGHT_TO[i].push(sq(x + dx, y + dy));
}

// pawn direction and capture offsets per player
const FWD = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const PAWN_CAPS = [[[-1, 1], [1, 1]], [[1, -1], [1, 1]], [[-1, -1], [1, -1]], [[-1, -1], [-1, 1]]];
// PAWN_SRC[q][idx]: squares from which a pawn of player q attacks idx
const PAWN_SRC = [0, 1, 2, 3].map((q) => Array.from({ length: CELLS }, (_, i) => {
  const out = [];
  if (!inBoard(xOf(i), yOf(i))) return out;
  for (const [dx, dy] of PAWN_CAPS[q]) if (inBoard(xOf(i) - dx, yOf(i) - dy)) out.push(sq(xOf(i) - dx, yOf(i) - dy));
  return out;
}));

const ORDER_QK = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];
const ORDER_KQ = [ROOK, KNIGHT, BISHOP, KING, QUEEN, BISHOP, KNIGHT, ROOK];
/**
 * Back-rank piece order per player, listed along backSquare(p, k) for k = 0..7.
 *  standard  chess.com's "Old Standard": all four kings on light squares and each king facing the
 *            opposing queen. Red K h1 / Q g1, Yellow K g14 / Q h14, Blue K a8 / Q a7, Green K n7 / Q n8.
 *  omatamix  the "Omatamix" setup: Blue and Green swap king and queen (their kings on dark squares),
 *            which makes the whole position symmetric under a quarter turn. Blue K a7 / Q a8, Green K n8 / Q n7.
 */
export const SETUPS = {
  standard: [ORDER_QK, ORDER_KQ, ORDER_QK, ORDER_KQ],
  omatamix: [ORDER_QK, ORDER_QK, ORDER_QK, ORDER_QK],
};
const KING_K = Object.fromEntries(Object.entries(SETUPS).map(([name, orders]) => [name, orders.map((o) => o.indexOf(KING))]));
/** k-th square (0..7) of player p's back rank (k runs along the rank in the player's own order, see SETUPS). */
export function backSquare(p, k) {
  switch (p) {
    case 0: return sq(3 + k, 0);
    case 1: return sq(0, 10 - k);
    case 2: return sq(10 - k, 13);
    default: return sq(13, 3 + k);
  }
}
function pawnSquare(p, k) {
  switch (p) {
    case 0: return sq(3 + k, 1);
    case 1: return sq(1, 10 - k);
    case 2: return sq(10 - k, 12);
    default: return sq(12, 3 + k);
  }
}
const onStartRow = (p, x, y) => (p === 0 ? y === 1 : p === 1 ? x === 1 : p === 2 ? y === 12 : x === 12);
/** Promotion rank: the 8th rank in FFA, the 11th in Teams (counted from each player's own side). */
function promotionLine(p, mode) {
  const n = mode === 'teams' ? 11 : 8;
  return p === 0 ? n - 1 : p === 1 ? n - 1 : p === 2 ? 13 - (n - 1) : 13 - (n - 1);
}
const isPromotionSquare = (p, mode, x, y) => {
  const line = promotionLine(p, mode);
  return p === 0 || p === 2 ? y === line : x === line;
};

/** Castling per setup, player and side (0: toward the rook on k=7, 1: toward the rook on k=0): the king
 *  moves two squares toward the rook and the rook hops to the square the king crossed. */
function castleDefs(setup) {
  return [0, 1, 2, 3].map((p) => {
    const kk = KING_K[setup][p];
    const at = (k) => backSquare(p, k);
    const span = (from, to) => { const out = []; for (let k = from; k <= to; k++) out.push(at(k)); return out; };
    return [
      { kingTo: at(kk + 2), rookFrom: at(7), rookTo: at(kk + 1), empty: span(kk + 1, 6), safe: [at(kk), at(kk + 1), at(kk + 2)] },
      { kingTo: at(kk - 2), rookFrom: at(0), rookTo: at(kk - 1), empty: span(1, kk - 1), safe: [at(kk), at(kk - 1), at(kk - 2)] },
    ];
  });
}
const CASTLE = { standard: castleDefs('standard'), omatamix: castleDefs('omatamix') };

// ───────────────────────── pieces ─────────────────────────
export const pieceType = (v) => v & 7;
export const pieceOwner = (v) => (v >> 3) & 3;
export const isPromoted = (v) => (v & PROMOTED) !== 0;
export const isPromotedQueen = (v) => (v & PROMOTED) !== 0 && (v & 7) === QUEEN;
export const makePiece = (type, owner, promoted = false) => type | (owner << 3) | (promoted ? PROMOTED : 0);

// ───────────────────────── state ─────────────────────────
export function newGame(mode = 'ffa', { choosePromotion = false, setup = 'standard' } = {}) {
  if (!SETUPS[setup]) throw new Error(`unknown setup ${setup}`);
  const board = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) board[i] = isValidSquare(i) ? 0 : INVALID;
  const kingSq = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) {
    for (let k = 0; k < 8; k++) {
      board[backSquare(p, k)] = makePiece(SETUPS[setup][p][k], p);
      board[pawnSquare(p, k)] = makePiece(PAWN, p);
    }
    kingSq[p] = backSquare(p, KING_K[setup][p]);
  }
  const state = {
    mode, board, turn: 0, eliminated: [false, false, false, false], score: [0, 0, 0, 0],
    castle: 0xff, kingSq, halfmove: 0, ply: 0, result: null, seen: new Map(), lastMove: null,
    choosePromotion: mode === 'teams' || choosePromotion, setup,
  };
  state.seen.set(positionKey(state), 1);
  return state;
}

/** Build a state from a list of [x, y, type, owner] (for tests and puzzles). */
export function fromPieces(list, { mode = 'ffa', turn = 0, castle = 0, eliminated = [false, false, false, false], choosePromotion = false, setup = 'standard' } = {}) {
  const board = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) board[i] = isValidSquare(i) ? 0 : INVALID;
  const kingSq = [-1, -1, -1, -1];
  for (const [x, y, type, owner, promoted] of list) {
    board[sq(x, y)] = makePiece(type, owner, !!promoted);
    if (type === KING) kingSq[owner] = sq(x, y);
  }
  const state = {
    mode, board, turn, eliminated: [...eliminated], score: [0, 0, 0, 0], castle, kingSq,
    halfmove: 0, ply: 0, result: null, seen: new Map(), lastMove: null,
    choosePromotion: mode === 'teams' || choosePromotion, setup,
  };
  state.seen.set(positionKey(state), 1);
  return state;
}

export function cloneState(s) {
  return {
    mode: s.mode, board: s.board.slice(), turn: s.turn, eliminated: [...s.eliminated], score: [...s.score],
    castle: s.castle, kingSq: [...s.kingSq], halfmove: s.halfmove, ply: s.ply,
    result: s.result ? { ...s.result } : null, seen: new Map(s.seen), lastMove: s.lastMove ? { ...s.lastMove } : null,
    choosePromotion: s.choosePromotion, setup: s.setup,
  };
}

/** Plain-object form for postMessage (the repetition table is not needed for search). */
export function serialize(s) {
  return {
    mode: s.mode, board: s.board, turn: s.turn, eliminated: s.eliminated, score: s.score,
    castle: s.castle, kingSq: s.kingSq, halfmove: s.halfmove, ply: s.ply, choosePromotion: s.choosePromotion, setup: s.setup,
  };
}
export function deserialize(o) {
  return {
    mode: o.mode, board: Uint8Array.from(o.board), turn: o.turn, eliminated: [...o.eliminated], score: [...o.score],
    castle: o.castle, kingSq: [...o.kingSq], halfmove: o.halfmove, ply: o.ply, result: null, seen: new Map(), lastMove: null,
    choosePromotion: !!o.choosePromotion, setup: o.setup || 'standard',
  };
}

export function positionKey(s) {
  let str = '';
  for (let i = 0; i < CELLS; i++) str += String.fromCharCode(s.board[i]);
  return `${str}|${s.turn}|${s.castle}|${s.eliminated.map((e) => (e ? 1 : 0)).join('')}`;
}

export const isEnemy = (state, a, b) => a !== b && (state.mode === 'ffa' || TEAM[a] !== TEAM[b]);
export const isFriend = (state, a, b) => a === b || (state.mode === 'teams' && TEAM[a] === TEAM[b]);
export const isDead = (state, v) => v !== 0 && v !== INVALID && state.eliminated[pieceOwner(v)];

/** May player p capture the piece v? Dead pieces yes (worth nothing); live kings never. */
function canCapture(state, p, v) {
  const o = pieceOwner(v);
  if (o === p) return false;
  if (state.eliminated[o]) return true;
  if (pieceType(v) === KING) return false;
  return state.mode === 'ffa' || TEAM[o] !== TEAM[p];
}

// ───────────────────────── attacks ─────────────────────────
/** Is square idx attacked by a live enemy of player p? */
export function attackedBy(state, idx, p) {
  const b = state.board;
  const elim = state.eliminated;
  const ffa = state.mode === 'ffa';
  const enemy = (o) => o !== p && !elim[o] && (ffa || TEAM[o] !== TEAM[p]);
  for (const t of KNIGHT_TO[idx]) {
    const v = b[t];
    if (v && (v & 7) === KNIGHT && enemy((v >> 3) & 3)) return true;
  }
  const rays = RAYS[idx];
  for (let d = 0; d < 8; d++) {
    const ray = rays[d];
    const straight = d < 4;
    for (let i = 0; i < ray.length; i++) {
      const v = b[ray[i]];
      if (!v) continue;
      if (enemy((v >> 3) & 3)) {
        const t = v & 7;
        if (t === QUEEN || t === (straight ? ROOK : BISHOP) || (i === 0 && t === KING)) return true;
      }
      break;
    }
  }
  for (let q = 0; q < 4; q++) {
    if (!enemy(q)) continue;
    for (const s of PAWN_SRC[q][idx]) {
      const v = b[s];
      if (v && (v & 7) === PAWN && ((v >> 3) & 3) === q) return true;
    }
  }
  return false;
}

/** Players (other than p) with a live piece attacking idx; used to credit checkmates. */
export function attackersOf(state, idx, p) {
  const b = state.board;
  const found = new Set();
  const enemy = (o) => isEnemy(state, p, o) && !state.eliminated[o];
  for (const t of KNIGHT_TO[idx]) {
    const v = b[t];
    if (v && pieceType(v) === KNIGHT && enemy(pieceOwner(v))) found.add(pieceOwner(v));
  }
  for (let d = 0; d < 8; d++) {
    const ray = RAYS[idx][d];
    for (let i = 0; i < ray.length; i++) {
      const v = b[ray[i]];
      if (!v) continue;
      const t = pieceType(v);
      if (enemy(pieceOwner(v)) && (t === QUEEN || t === (d < 4 ? ROOK : BISHOP) || (i === 0 && t === KING))) found.add(pieceOwner(v));
      break;
    }
  }
  for (let q = 0; q < 4; q++) {
    if (!enemy(q)) continue;
    for (const s of PAWN_SRC[q][idx]) {
      const v = b[s];
      if (v && pieceType(v) === PAWN && pieceOwner(v) === q) found.add(q);
    }
  }
  return [...found];
}

export const inCheck = (state, p) => !state.eliminated[p] && state.kingSq[p] >= 0 && attackedBy(state, state.kingSq[p], p);

/** Does the piece standing on `from` attack `target` (ignoring whose piece it is)? */
function pieceAttacks(state, from, target) {
  const v = state.board[from];
  const t = pieceType(v);
  if (t === KNIGHT) return KNIGHT_TO[from].includes(target);
  if (t === KING) return KING_TO[from].includes(target);
  if (t === PAWN) return PAWN_SRC[pieceOwner(v)][target].includes(from);
  for (let d = t === BISHOP ? 4 : 0; d < (t === ROOK ? 4 : 8); d++) {
    for (const s of RAYS[from][d]) {
      if (s === target) return true;
      if (state.board[s]) break;
    }
  }
  return false;
}

// ───────────────────────── moves ─────────────────────────
export const moveFrom = (m) => m & 255;
export const moveTo = (m) => (m >> 8) & 255;
export const moveFlags = (m) => m >> 16;
const mv = (from, to, flags = 0) => from | (to << 8) | (flags << 16);

export const promotionPiece = (m) => (((m >> 16) >> FLAG_PROMO_SHIFT) & 7) || QUEEN;

function pushPawnMove(out, state, from, to, promoting) {
  if (!promoting) { out.push(mv(from, to)); return; }
  for (const t of state.choosePromotion ? PROMO_CHOICES : [QUEEN]) out.push(mv(from, to, FLAG_PROMOTION | (t << FLAG_PROMO_SHIFT)));
}

export function pseudoMoves(state, p, out = []) {
  const b = state.board;
  for (let idx = 0; idx < CELLS; idx++) {
    const v = b[idx];
    if (!v || v === INVALID || ((v >> 3) & 3) !== p) continue;
    const t = v & 7;
    const x = xOf(idx);
    const y = yOf(idx);
    if (t === PAWN) {
      const [fx, fy] = FWD[p];
      const nx = x + fx;
      const ny = y + fy;
      if (inBoard(nx, ny) && !b[sq(nx, ny)]) {
        const promoting = isPromotionSquare(p, state.mode, nx, ny);
        pushPawnMove(out, state, idx, sq(nx, ny), promoting);
        if (!promoting && onStartRow(p, x, y)) {
          const mx = x + 2 * fx;
          const my = y + 2 * fy;
          if (inBoard(mx, my) && !b[sq(mx, my)]) out.push(mv(idx, sq(mx, my)));
        }
      }
      for (const [dx, dy] of PAWN_CAPS[p]) {
        const cx = x + dx;
        const cy = y + dy;
        if (!inBoard(cx, cy)) continue;
        const target = b[sq(cx, cy)];
        if (target && canCapture(state, p, target)) {
          pushPawnMove(out, state, idx, sq(cx, cy), isPromotionSquare(p, state.mode, cx, cy));
        }
      }
    } else if (t === KNIGHT || t === KING) {
      for (const to of t === KNIGHT ? KNIGHT_TO[idx] : KING_TO[idx]) {
        const target = b[to];
        if (!target || canCapture(state, p, target)) out.push(mv(idx, to));
      }
    } else {
      for (let d = t === BISHOP ? 4 : 0; d < (t === ROOK ? 4 : 8); d++) {
        for (const to of RAYS[idx][d]) {
          const target = b[to];
          if (!target) { out.push(mv(idx, to)); continue; }
          if (canCapture(state, p, target)) out.push(mv(idx, to));
          break;
        }
      }
    }
  }
  // castling
  const king = state.kingSq[p];
  if (king === backSquare(p, KING_K[state.setup][p]) && b[king] === makePiece(KING, p)) {
    for (let side = 0; side < 2; side++) {
      if (!(state.castle & (1 << (2 * p + side)))) continue;
      const c = CASTLE[state.setup][p][side];
      if (b[c.rookFrom] !== makePiece(ROOK, p)) continue;
      if (c.empty.some((s) => b[s])) continue;
      if (c.safe.some((s) => attackedBy(state, s, p))) continue;
      out.push(mv(king, c.kingTo, side === 0 ? FLAG_CASTLE_K : FLAG_CASTLE_Q));
    }
  }
  return out;
}

/** Apply a move to the board only (no turn change, scoring or elimination). */
export function makeMove(state, m) {
  const from = m & 255;
  const to = (m >> 8) & 255;
  const flags = m >> 16;
  const b = state.board;
  const piece = b[from];
  const captured = b[to];
  const p = (piece >> 3) & 3;
  const type = piece & 7;
  const undo = { m, piece, captured, castle: state.castle, halfmove: state.halfmove };
  if (flags & (FLAG_CASTLE_K | FLAG_CASTLE_Q)) {
    const c = CASTLE[state.setup][p][flags & FLAG_CASTLE_K ? 0 : 1];
    b[from] = 0;
    b[to] = piece;
    b[c.rookTo] = b[c.rookFrom];
    b[c.rookFrom] = 0;
  } else {
    b[from] = 0;
    b[to] = flags & FLAG_PROMOTION ? makePiece(((flags >> FLAG_PROMO_SHIFT) & 7) || QUEEN, p, true) : piece;
  }
  if (type === KING) {
    state.kingSq[p] = to;
    state.castle &= ~(3 << (2 * p));
  } else if (type === ROOK) {
    if (from === CASTLE[state.setup][p][1].rookFrom) state.castle &= ~(1 << (2 * p + 1));
    else if (from === CASTLE[state.setup][p][0].rookFrom) state.castle &= ~(1 << (2 * p));
  }
  if (captured && (captured & 7) === ROOK) {
    const o = (captured >> 3) & 3;
    if (to === CASTLE[state.setup][o][1].rookFrom) state.castle &= ~(1 << (2 * o + 1));
    else if (to === CASTLE[state.setup][o][0].rookFrom) state.castle &= ~(1 << (2 * o));
  }
  state.halfmove = type === PAWN || captured ? 0 : state.halfmove + 1;
  state.ply++;
  return undo;
}

export function unmakeMove(state, undo) {
  const { m, piece, captured } = undo;
  const from = m & 255;
  const to = (m >> 8) & 255;
  const flags = m >> 16;
  const b = state.board;
  const p = (piece >> 3) & 3;
  if (flags & (FLAG_CASTLE_K | FLAG_CASTLE_Q)) {
    const c = CASTLE[state.setup][p][flags & FLAG_CASTLE_K ? 0 : 1];
    b[from] = piece;
    b[to] = 0;
    b[c.rookFrom] = b[c.rookTo];
    b[c.rookTo] = 0;
  } else {
    b[from] = piece;
    b[to] = captured;
  }
  if ((piece & 7) === KING) state.kingSq[p] = from;
  state.castle = undo.castle;
  state.halfmove = undo.halfmove;
  state.ply--;
}

/** Fully legal moves for player p (default: the player to move). */
export function legalMoves(state, p = state.turn) {
  if (state.eliminated[p]) return [];
  const out = [];
  for (const m of pseudoMoves(state, p)) {
    if (m >> 16 & (FLAG_CASTLE_K | FLAG_CASTLE_Q)) { out.push(m); continue; } // castling squares were verified
    const u = makeMove(state, m);
    const bad = attackedBy(state, state.kingSq[p], p);
    unmakeMove(state, u);
    if (!bad) out.push(m);
  }
  return out;
}

/** The legal move from -> to; for a promotion, the one choosing `promo` (default queen). */
export function findMove(state, from, to, promo = QUEEN) {
  return legalMoves(state).find((m) => moveFrom(m) === from && moveTo(m) === to
    && (!(moveFlags(m) & FLAG_PROMOTION) || promotionPiece(m) === promo)) ?? null;
}

// ───────────────────────── game flow ─────────────────────────
export function nextActive(state, from) {
  let q = from;
  for (let i = 0; i < 4; i++) {
    q = (q + 1) & 3;
    if (!state.eliminated[q]) return q;
  }
  return -1;
}
export const activePlayers = (state) => [0, 1, 2, 3].filter((p) => !state.eliminated[p]);

export function captureValue(state, v) {
  if (!v || v === INVALID || state.eliminated[pieceOwner(v)]) return 0;
  if (isPromoted(v)) return 1; // a promoted piece of any kind is worth a pawn
  switch (pieceType(v)) {
    case PAWN: return 1;
    case KNIGHT: return 3;
    case BISHOP: return 5;
    case ROOK: return 5;
    case QUEEN: return isPromoted(v) ? 1 : 9;
    default: return 0;
  }
}

export function moveText(piece, from, to, captured, flags) {
  if (flags & FLAG_CASTLE_K) return 'O-O';
  if (flags & FLAG_CASTLE_Q) return 'O-O-O';
  return `${TYPE_LETTER[pieceType(piece)]}${squareName(from)}${captured ? 'x' : '-'}${squareName(to)}${flags & FLAG_PROMOTION ? `=${TYPE_LETTER[((flags >> FLAG_PROMO_SHIFT) & 7) || QUEEN]}` : ''}`;
}

function insufficientMaterial(state) {
  let minors = 0;
  for (let i = 0; i < CELLS; i++) {
    const v = state.board[i];
    if (!v || v === INVALID || state.eliminated[pieceOwner(v)]) continue;
    const t = pieceType(v);
    if (t === KING) continue;
    if (t === KNIGHT || t === BISHOP) { if (++minors > 1) return false; } else return false;
  }
  return true;
}

function rankFFA(state) {
  const order = [0, 1, 2, 3].sort((a, b) => state.score[b] - state.score[a] || (state.eliminated[a] ? 1 : 0) - (state.eliminated[b] ? 1 : 0) || a - b);
  const top = state.score[order[0]];
  return { ranking: order, winners: order.filter((p) => state.score[p] === top) };
}

function finish(state, result) {
  state.result = state.mode === 'ffa' && result.type !== 'win-team' ? { ...result, ...rankFFA(state) } : result;
}

/**
 * Play a legal move for the player to move. Updates scores, eliminations, the turn and the
 * result. Returns an event record describing what happened (for the UI / move list).
 */
export function playMove(state, m) {
  if (state.result) throw new Error('game is over');
  const p = state.turn;
  const from = moveFrom(m);
  const to = moveTo(m);
  const flags = moveFlags(m);
  const piece = state.board[from];
  const captured = state.board[to];
  const ev = {
    player: p, move: m, from, to, piece, captured, flags, delta: [0, 0, 0, 0], checks: [], eliminated: [], text: '', over: false,
  };
  ev.text = moveText(piece, from, to, captured, flags);
  const gain = captureValue(state, captured);
  makeMove(state, m);
  state.score[p] += gain;
  ev.delta[p] += gain;
  state.lastMove = { from, to, player: p };

  // forking several kings with one move (FFA only)
  if (state.mode === 'ffa') {
    const attacked = [0, 1, 2, 3].filter((q) => q !== p && !state.eliminated[q] && state.kingSq[q] >= 0 && pieceAttacks(state, to, state.kingSq[q]));
    if (attacked.length >= 2) {
      const queen = pieceType(state.board[to]) === QUEEN;
      const bonus = attacked.length === 2 ? (queen ? 1 : 5) : (queen ? 5 : 20);
      state.score[p] += bonus;
      ev.delta[p] += bonus;
    }
  }

  // hand the move on, resolving checkmates and stalemates for the players who come up
  let next = nextActive(state, p);
  for (;;) {
    if (activePlayers(state).length <= 1) { finish(state, { type: 'ffa', reason: 'elimination' }); break; }
    if (legalMoves(state, next).length) break;
    const mated = inCheck(state, next);
    if (state.mode === 'teams') {
      if (mated) finish(state, { type: 'win-team', reason: 'checkmate', winnerTeam: 1 - TEAM[next], loser: next, mater: p });
      else finish(state, { type: 'draw', reason: 'stalemate' });
      ev.eliminated.push({ player: next, reason: mated ? 'checkmate' : 'stalemate' });
      break;
    }
    if (mated) {
      const attackers = attackersOf(state, state.kingSq[next], next);
      let credit = -1;
      for (let q = (next + 3) & 3, i = 0; i < 3; q = (q + 3) & 3, i++) {
        if (attackers.includes(q)) { credit = q; break; }
      }
      if (credit >= 0) { state.score[credit] += MATE_POINTS; ev.delta[credit] += MATE_POINTS; }
      ev.eliminated.push({ player: next, reason: 'checkmate', by: credit });
    } else {
      state.score[next] += STALEMATE_POINTS;
      ev.delta[next] += STALEMATE_POINTS;
      ev.eliminated.push({ player: next, reason: 'stalemate' });
    }
    state.eliminated[next] = true;
    next = nextActive(state, next);
  }
  if (!state.result) state.turn = next;

  ev.checks = [0, 1, 2, 3].filter((q) => inCheck(state, q));

  if (!state.result) {
    const key = positionKey(state);
    const count = (state.seen.get(key) || 0) + 1;
    state.seen.set(key, count);
    let reason = null;
    if (count >= 3) reason = 'repetition';
    else if (state.halfmove >= DRAW_PLIES) reason = 'fifty-move';
    else if (insufficientMaterial(state)) reason = 'insufficient-material';
    if (reason) {
      if (state.mode === 'ffa') {
        for (const q of activePlayers(state)) state.score[q] += DRAW_POINTS;
        ev.drawPoints = DRAW_POINTS;
        finish(state, { type: 'ffa', reason });
      } else {
        finish(state, { type: 'draw', reason });
      }
    }
  }
  ev.over = !!state.result;
  return ev;
}

/** Human-readable one-line result. */
export function describeResult(state) {
  const r = state.result;
  if (!r) return '';
  const why = {
    elimination: 'three players eliminated', repetition: 'threefold repetition',
    'fifty-move': 'no capture or pawn move for 50 rounds', 'insufficient-material': 'insufficient material',
    stalemate: 'stalemate', checkmate: 'checkmate',
  }[r.reason] || r.reason;
  if (r.type === 'win-team') {
    return `${NAMES[r.winnerTeam]} + ${NAMES[r.winnerTeam + 2]} win by checkmate of ${NAMES[r.loser]}`;
  }
  if (r.type === 'draw') return `Draw (${why})`;
  const names = r.winners.map((p) => NAMES[p]).join(' & ');
  return `${names} ${r.winners.length > 1 ? 'tie for the win' : 'wins'} with ${state.score[r.winners[0]]} points (${why})`;
}
