// Human explanations for a reviewed move. Instead of "−31 points of win chance", say what happens:
// "Nd5 forks your king and queen, and you lose the queen", "Bxf7+ would have won a rook",
// "this throws away a winning position". Also finds the moments worth celebrating and the game's
// highlights (chess.com-style: brilliant and great moves, punished mistakes, won material, mates).
import { Chess } from '../../vendor/chess.js';

export const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** How a side stands, in words, from its win chance (0-100). */
export function standing(w) {
  if (w >= 90) return { k: 'winning', text: 'winning' };
  if (w >= 70) return { k: 'better', text: 'clearly better' };
  if (w >= 57) return { k: 'edge', text: 'slightly better' };
  if (w > 43) return { k: 'equal', text: 'about equal' };
  if (w > 30) return { k: 'worse', text: 'slightly worse' };
  if (w > 10) return { k: 'bad', text: 'clearly worse' };
  return { k: 'lost', text: 'losing' };
}
const RANK = { lost: 0, bad: 1, worse: 2, equal: 3, edge: 4, better: 5, winning: 6 };

/** One sentence for how a move changed the game for the side that played it. */
export function swingText(before, after) {
  const a = standing(before).k;
  const b = standing(after).k;
  if (a === b) return null;
  if (a === 'winning' && RANK[b] <= RANK.equal) return b === 'equal' ? 'This throws away a winning position: the game is level again.' : 'This throws away a winning position.';
  if (a === 'winning') return 'You were winning, and this lets a lot of it slip.';
  if (RANK[a] >= RANK.edge && RANK[b] <= RANK.worse) return 'Your advantage is gone, and now you are the one who is worse.';
  if (RANK[a] >= RANK.edge && b === 'equal') return 'Your advantage is gone.';
  if (a === 'equal' && b === 'lost') return 'From a level game straight to a losing one.';
  if (a === 'equal' && RANK[b] < RANK.equal) return `From a level game to ${standing(after).text}.`;
  if (RANK[a] < RANK.equal && b === 'lost') return 'A difficult position becomes a lost one.';
  if (RANK[b] > RANK[a]) return `Now you are ${standing(after).text}.`;
  if (RANK[b] >= RANK.edge) return `Your advantage shrinks: you are now only ${standing(after).text}.`;
  return `Now you are ${standing(after).text}.`;
}

function counts(c) {
  const o = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of c.board()) for (const p of row) if (p && p.type !== 'k') o[p.color][p.type]++;
  return o;
}

/**
 * Play `sans` from `fen` and see what material changes hands for `col`, measured at the last quiet
 * point (not right after a capture that is about to be recaptured).
 * → {lost: {type: n}, won: {type: n}, net (pawns), mate: 'for'|'against'|null, plies}
 */
export function materialOutcome(fen, sans, col, max = 8) {
  const c = new Chess(fen);
  const start = counts(c);
  const op = col === 'w' ? 'b' : 'w';
  let snap = start;
  let plies = 0;
  let mate = null;
  const moves = [];
  for (const s of (sans || []).slice(0, max)) {
    let m;
    try { m = c.move(s); } catch { break; }
    moves.push(m);
    plies++;
    if (c.isCheckmate()) { mate = m.color === col ? 'for' : 'against'; snap = counts(c); break; }
  }
  if (!mate) {
    // Walk back to the last position where the next move in the line is not a capture.
    const h = new Chess(fen);
    snap = start;
    for (let k = 0; k < moves.length; k++) {
      h.move(moves[k].san);
      const next = moves[k + 1];
      if (!next || !next.captured) snap = counts(h);
    }
  }
  const lost = {};
  const won = {};
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    // Same pieces traded both ways cancel out ("a bishop", not "a bishop and a pawn for a pawn").
    const d = (start[col][t] - snap[col][t]) - (start[op][t] - snap[op][t]);
    if (d > 0) lost[t] = d;
    if (d < 0) won[t] = -d;
  }
  const v = (o) => Object.entries(o).reduce((s, [t, n]) => s + VAL[t] * n, 0);
  return { lost, won, net: v(won) - v(lost), mate, plies, moves };
}

const list = (o) => {
  const items = [];
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    const n = o[t] || 0;
    if (!n) continue;
    items.push(n === 1 ? `a ${PIECE[t]}` : `${n === 2 ? 'two' : n} ${PIECE[t]}s`);
  }
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
};
const single = (o) => { const e = Object.entries(o); return e.length === 1 && e[0][1] === 1 ? e[0][0] : null; };

/** "a knight", "a rook for a bishop" (the exchange), "a queen for a rook and a pawn". From the gainer's or loser's view. */
export function tradeText(o, verb = 'lose') {
  const give = verb === 'lose' ? o.lost : o.won;
  const get = verb === 'lose' ? o.won : o.lost;
  const g1 = single(give);
  const t1 = single(get);
  if (g1 === 'r' && (t1 === 'n' || t1 === 'b')) return 'the exchange (a rook for a minor piece)';
  if (!Object.keys(get).length) return list(give);
  return `${list(give)} for ${list(get)}`;
}

/** Pieces of value ≥ 3 (and the king) that the piece on `sq` attacks: a fork when ≥ 2. */
function attackedBy(c, sq) {
  const p = c.get(sq);
  if (!p) return [];
  const op = p.color === 'w' ? 'b' : 'w';
  const out = [];
  for (const row of c.board()) for (const q of row) {
    if (!q || q.color !== op) continue;
    if (q.type !== 'k' && VAL[q.type] < 3) continue;
    if (VAL[q.type] <= VAL[p.type] && q.type !== 'k' && c.attackers(q.square, op).length && p.type !== 'p') continue; // defended and not worth more
    if (c.attackers(q.square, p.color).includes(sq)) out.push(q);
  }
  return out;
}

/** A short tactical label for a move played from fen: fork / check / capture, with the pieces named. */
export function tacticOf(fen, san) {
  const c = new Chess(fen);
  let m;
  try { m = c.move(san); } catch { return null; }
  if (c.isCheckmate()) return { kind: 'mate', text: `${san} is checkmate` };
  const hits = attackedBy(c, m.to);
  if (hits.length >= 2) {
    const names = hits.sort((a, b) => (b.type === 'k') - (a.type === 'k') || VAL[b.type] - VAL[a.type]).slice(0, 2).map((q) => PIECE[q.type]);
    return { kind: 'fork', text: `${san} attacks the ${names[0]} and the ${names[1]} at once`, names };
  }
  if (m.captured) return { kind: 'capture', text: `${san} takes the ${PIECE[m.captured]}` };
  if (m.san.includes('+')) return { kind: 'check', text: `${san} is check` };
  return null;
}

function undefended(fen, col) {
  const c = new Chess(fen);
  const op = col === 'w' ? 'b' : 'w';
  let best = null;
  for (const row of c.board()) for (const p of row) {
    if (!p || p.color !== col || p.type === 'k' || VAL[p.type] < 3) continue;
    if (c.attackers(p.square, op).length && !c.attackers(p.square, col).length && (!best || VAL[p.type] > VAL[best.type])) best = p;
  }
  return best;
}

const mover = (i) => (i % 2 === 0 ? 'w' : 'b');
const winFor = (R, k, col) => (col === 'w' ? R.ev[k].w : 100 - R.ev[k].w);
const youOr = (mine, a, b) => (mine ? a : b);

/**
 * Explain ply i of review R. fens: all positions. mineCol: the player's colour.
 * → {headline, text (array of sentences), tone: 'cheer'|'warn'|'neutral', gain: material outcome or null}
 */
export function explainMove(R, i, fens, mineCol, { opening = '' } = {}) {
  const k = R.cl[i];
  const san = R.san[i];
  const col = mover(i);
  const mine = col === mineCol;
  const e = R.ev[i];
  const n = R.ev[i + 1];
  const bf = winFor(R, i, col);
  const af = winFor(R, i + 1, col);
  const you = youOr(mine, 'you', 'they');
  const your = youOr(mine, 'your', 'their');
  const out = [];
  let tone = 'neutral';
  const after = new Chess(fens[i + 1]);
  const better = e.bs && e.bs !== san ? e.bs : null;

  if (after.isCheckmate()) return { headline: mine ? 'Checkmate!' : 'Checkmate', text: [mine ? 'You finish the game in style.' : 'The game ends here.'], tone: mine ? 'cheer' : 'warn' };

  // What the move itself (plus the best play after it) does to the material.
  const line = [san, ...(n.pv || [])];
  const res = materialOutcome(fens[i], line, col);

  if (k === 'book') return { headline: 'Book move', text: [`A known opening move${opening ? ` in the ${opening}` : ''}.`], tone: 'neutral' };
  if (k === 'forced') return { headline: 'Forced', text: ['The only legal move.'], tone: 'neutral' };

  if (k === 'brilliant') {
    const m = new Chess(fens[i]).move(san);
    out.push(`${mine ? 'You offer' : 'They offer'} ${your} ${PIECE[m.piece]}, and it works.`);
    if (res.net >= 2) out.push(`If it is taken, the line ends with ${you} winning ${tradeText(res, 'win')}.`);
    else if (res.mate === 'for') out.push('Taking it walks into mate.');
    else out.push(`The position stays ${standing(af).text} for ${mine ? 'you' : 'them'} even though the material is gone.`);
    if (mine) out.push('Moves like this are rare. Very few players would even consider it.');
    return { headline: mine ? 'Brilliant!' : 'A brilliant move', text: out, tone: mine ? 'cheer' : 'warn', gain: res };
  }
  if (k === 'great') {
    const alt = e.gap != null ? standing(Math.max(0, bf - e.gap)).text : null;
    out.push(alt ? `The only good move here: it keeps ${mine ? 'you' : 'them'} ${standing(af).text}, while anything else leaves ${mine ? 'you' : 'them'} ${alt}.` : 'The only good move here.');
    if (res.net >= 2) out.push(`It wins ${tradeText(res, 'win')}.`);
    else if (res.mate === 'for') out.push('It leads to a forced mate.');
    if (mine) out.push('A hard move to find. Well played.');
    return { headline: mine ? 'Great find!' : 'A great move', text: out, tone: mine ? 'cheer' : 'warn', gain: res };
  }

  const prevErr = i > 0 && R.loss[i - 1] >= 15;
  if (k === 'best' || k === 'excellent' || k === 'good') {
    if (prevErr && (k === 'best' || k === 'excellent') && af >= 55) {
      out.push(`${mine ? 'Your opponent' : 'You'} had just gone wrong, and ${mine ? 'you punish it' : 'they punish it'}.`);
      if (res.net >= 2) out.push(`${san} wins ${tradeText(res, 'win')}.`);
      else if (res.mate === 'for') out.push('It leads to mate.');
      return { headline: mine ? 'Punished!' : 'They punished it', text: out, tone: mine ? 'cheer' : 'warn', gain: res };
    }
    if (res.mate === 'for' && (e.m != null && e.m > 0)) {
      return { headline: mine ? 'Going for mate' : 'Mate is coming', text: [`${san} starts a forced mate in ${e.m}.`], tone: mine ? 'cheer' : 'warn', gain: res };
    }
    if (res.net >= 2 && k === 'best') {
      return { headline: mine ? 'Wins material' : 'They win material', text: [`${san} wins ${tradeText(res, 'win')}.`], tone: mine ? 'cheer' : 'warn', gain: res };
    }
    if (k === 'best') return { headline: 'Best move', text: [mine ? "The engine's top choice. Nothing to improve." : "Their best move."], tone: 'neutral' };
    return { headline: k === 'excellent' ? 'Excellent' : 'Good move', text: [`A solid move.${better ? ` ${better} was a little more precise.` : ''}`], tone: 'neutral' };
  }

  // ── errors (inaccuracy, mistake, blunder, miss)
  tone = mine ? 'warn' : 'cheer';
  const reply = n.bs;
  if (k === 'miss') {
    const could = materialOutcome(fens[i], e.pv || [], col);
    out.push(`${mine ? 'Your opponent' : 'You'} had just made a mistake, and this lets ${mine ? 'them' : 'you'} off the hook.`);
    if (better) out.push(could.mate === 'for' ? `${better} would have started a mate${e.m > 0 ? ` in ${e.m}` : ''}.` : could.net >= 1 ? `${better} would have won ${tradeText(could, 'win')}.` : `${better} kept ${mine ? 'you' : 'them'} ${standing(bf).text}.`);
    return { headline: mine ? 'Missed chance' : 'They missed it', text: out, tone, gain: res };
  }
  const sw = mine ? swingText(bf, af) : (standing(100 - af).k !== standing(100 - bf).k ? `This hands you the chance: you are now ${standing(100 - af).text}.` : null);
  if (n.m != null && n.m > 0) out.push(`This allows mate in ${n.m}${reply ? `, starting with ${reply}` : ''}.`);
  else if (res.net <= -1) {
    const t = reply ? tacticOf(fens[i + 1], reply) : null;
    const h = undefended(fens[i + 1], col);
    const what = tradeText(res, 'lose');
    const moved = new Chess(fens[i]).move(san);
    const rep = reply ? new Chess(fens[i + 1]).move(reply) : null;
    if (t?.kind === 'fork') out.push(`${t.text}, and ${you} lose ${what}.`);
    else if (rep && rep.to === moved.to && rep.captured) out.push(`${mine ? 'Your' : 'Their'} ${PIECE[moved.piece]} on ${moved.to} can simply be taken: after ${reply} ${you} lose ${what}.`);
    else if (h && reply && new Chess(fens[i + 1]).move(reply)?.to === h.square) out.push(`It leaves ${your} ${PIECE[h.type]} on ${h.square} undefended: after ${reply} ${you} lose ${what}.`);
    else out.push(`${reply ? `After ${reply}, ${you}` : `${mine ? 'You' : 'They'}`} lose ${what}.`);
  } else if (sw) out.push(sw);
  else out.push(mine ? 'It makes your position harder to play.' : 'It makes their position harder to play.');
  if (sw && out[0] !== sw && (k === 'blunder' || k === 'mistake') && !out[0].startsWith('This allows')) out.push(sw);
  if (better) {
    const could = materialOutcome(fens[i], e.pv || [], col);
    if (e.m != null && e.m > 0) out.push(`${better} had a forced mate in ${e.m}.`);
    else if (could.net >= 2) out.push(`${better} would have won ${tradeText(could, 'win')} instead.`);
    else out.push(`${better} was better${standing(bf).k !== standing(af).k ? ` and kept ${mine ? 'you' : 'them'} ${standing(bf).text}` : ''}.`);
  }
  if (!mine && (k === 'blunder' || k === 'mistake')) {
    const pun = materialOutcome(fens[i + 1], n.pv || [], col === 'w' ? 'b' : 'w');
    if (reply && pun.net >= 2) out.push(`Your chance: ${reply} wins ${tradeText(pun, 'win')}.`);
    else if (reply && n.m != null && n.m > 0) out.push(`Your chance: ${reply} starts a mate in ${n.m}.`);
  }
  const head = mine ? { blunder: 'Blunder', mistake: 'Mistake', inaccuracy: 'Inaccuracy' }[k] : { blunder: 'Their blunder', mistake: 'Their mistake', inaccuracy: 'Their inaccuracy' }[k];
  return { headline: head, text: out, tone, gain: res };
}

// ───────────────────────── key moments ─────────────────────────
export const MOMENT = {
  brilliant: { title: 'Brilliant!', icon: '!!', good: true },
  great: { title: 'Great find', icon: '!', good: true },
  mate: { title: 'Checkmate', icon: '#', good: true },
  punish: { title: 'Punished', icon: '⚔', good: true },
  win: { title: 'Won material', icon: '+', good: true },
  save: { title: 'Saved it', icon: '⛨', good: true },
  blunder: { title: 'Blunder', icon: '??', good: false },
  mistake: { title: 'Mistake', icon: '?', good: false },
  miss: { title: 'Missed chance', icon: '×', good: false },
  inaccuracy: { title: 'Inaccuracy', icon: '?!', good: false },
  theirs: { title: 'Their blunder', icon: '??', good: null },
};

/**
 * Highlights of a game for the player, chess.com-style: every brilliant and great move, mates,
 * punished mistakes, won material, saves from bad positions, and the errors that mattered.
 * → [{i, type, mine, w}] in game order (at most `max`).
 */
export function highlights(R, fens, col, { max = 16 } = {}) {
  const out = [];
  for (let i = 0; i < R.san.length; i++) {
    const mine = mover(i) === col;
    const k = R.cl[i];
    const bf = winFor(R, i, mover(i));
    const af = winFor(R, i + 1, mover(i));
    const chk = new Chess(fens[i + 1]).isCheckmate();
    if (!mine) {
      if (k === 'blunder' || (k === 'mistake' && R.loss[i] >= 12)) out.push({ i, type: 'theirs', mine: false, w: R.loss[i] * 0.7 });
      continue;
    }
    if (chk) { out.push({ i, type: 'mate', mine, w: 60 }); continue; }
    if (k === 'brilliant') { out.push({ i, type: 'brilliant', mine, w: 55 }); continue; }
    if (k === 'great') { out.push({ i, type: 'great', mine, w: 40 }); continue; }
    if (k === 'miss' && i >= 2 && R.cl[i - 2] === 'miss' && R.ev[i - 2].bs === R.ev[i].bs) continue; // the same chance missed again
    if (k === 'blunder' || k === 'mistake' || k === 'miss') { out.push({ i, type: k, mine, w: R.loss[i] + (k === 'blunder' ? 10 : 0) }); continue; }
    if (k === 'inaccuracy' && R.loss[i] >= 7) { out.push({ i, type: 'inaccuracy', mine, w: R.loss[i] * 0.6 }); continue; }
    if (k === 'book' || k === 'forced') continue;
    const good = k === 'best' || k === 'excellent';
    if (good && i > 0 && R.loss[i - 1] >= 15 && af >= 55) { out.push({ i, type: 'punish', mine, w: 22 + R.loss[i - 1] * 0.2 }); continue; }
    if (good && bf < 30 && af >= 40) { out.push({ i, type: 'save', mine, w: 20 }); continue; }
    if (k === 'best') {
      const res = materialOutcome(fens[i], [R.san[i], ...(R.ev[i + 1].pv || [])], mover(i));
      if (res.net >= 3) out.push({ i, type: 'win', mine, w: 14 + res.net });
    }
  }
  // Always keep the celebrations and the blunders; fill the rest by weight.
  const must = out.filter((m) => ['brilliant', 'great', 'mate', 'blunder'].includes(m.type));
  const rest = out.filter((m) => !must.includes(m)).sort((a, b) => b.w - a.w).slice(0, Math.max(0, max - must.length));
  return [...must, ...rest].sort((a, b) => a.i - b.i);
}

/** A few sentences that tell the story of the game for the player. */
export function gameStory(R, fens, col, { result, opp = 'your opponent', opening = '' } = {}) {
  const hl = highlights(R, fens, col, { max: 40 });
  const me = (k) => winFor(R, k, col);
  const n = R.ev.length - 1;
  const after12 = Math.min(n, 24);
  const parts = [];
  parts.push(`${opening ? `In the ${opening}` : 'Out of the opening'} you were ${standing(me(after12)).text}${after12 >= 20 ? ' by move 12' : ''}.`);
  // Biggest single swing in either direction.
  let turn = null;
  for (let i = 0; i < R.san.length; i++) { const d = Math.abs(me(i + 1) - me(i)); if (!turn || d > turn.d) turn = { i, d }; }
  if (turn && turn.d >= 20) {
    const mine = mover(turn.i) === col;
    const mv = `${Math.floor(turn.i / 2) + 1}${turn.i % 2 ? '…' : '.'}${R.san[turn.i]}`;
    parts.push(me(turn.i + 1) > me(turn.i) ? `The turning point was ${mv}${mine ? ', your move' : `, when ${opp} went wrong`}.` : `The game turned on ${mv}${mine ? ', your move' : ''}.`);
  }
  const good = hl.filter((m) => MOMENT[m.type].good === true);
  const cnt = (t) => hl.filter((m) => m.type === t).length;
  const praise = [];
  if (cnt('brilliant')) praise.push(`${cnt('brilliant')} brilliant ${cnt('brilliant') === 1 ? 'move' : 'moves'}`);
  if (cnt('great')) praise.push(`${cnt('great')} great ${cnt('great') === 1 ? 'find' : 'finds'}`);
  if (cnt('punish')) praise.push(`punished ${cnt('punish') === 1 ? 'a mistake' : `${cnt('punish')} mistakes`}`);
  if (cnt('save')) praise.push(`saved ${cnt('save') === 1 ? 'a bad position' : `${cnt('save')} bad positions`}`);
  if (praise.length) parts.push(`Highlights: ${praise.join(', ')}.`);
  const bl = cnt('blunder');
  if (bl) parts.push(`${bl === 1 ? 'One blunder' : `${bl} blunders`} to learn from.`);
  else if (result !== 'loss') parts.push('No blunders. That is how games are won.');
  return { text: parts.join(' '), highlights: hl, good: good.length };
}
