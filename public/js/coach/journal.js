// The game journal: after each game, the player records *why* things went wrong (a line of text,
// tags, mood) next to what the engine found. Most tags are suggested from the data (clock, review,
// the games before), so a journal entry takes seconds. Stats then join the player's own tags with
// engine numbers: "41% of your losses had time trouble", "you score 34% in the game after a loss".
import { clockData, parseTC } from './clock.js';
import { motif } from './puzzles.js';

export const TAGS = {
  time: { label: 'Time trouble' },
  fast: { label: 'Played too fast' },
  tactic: { label: 'Missed tactic' },
  calc: { label: 'Miscalculated' },
  opening: { label: 'Opening trouble' },
  endgame: { label: 'Endgame technique' },
  convert: { label: "Couldn't convert" },
  tilt: { label: 'Tilted' },
  tired: { label: 'Tired' },
};
export const MOODS = { focused: 'Focused', okay: 'Okay', tired: 'Tired', frustrated: 'Frustrated' };
export const tagLabel = (t) => TAGS[t]?.label || t;

export const journalDoc = (user) => `journal-${String(user || 'me').toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
export const emptyJournal = () => ({ v: 1, e: {} });

/** Merge two journal documents: the newer edit of each entry wins. */
export function mergeJournal(a, b) {
  const out = emptyJournal();
  for (const src of [a, b]) for (const [id, en] of Object.entries(src?.e || {})) {
    if (!out.e[id] || (en.at || 0) >= (out.e[id].at || 0)) out.e[id] = en;
  }
  return out;
}

/** True once the player saved something for this game (a note, a tag or a mood). */
export const isJournaled = (en) => !!en && (!!en.note || (en.tags || []).length > 0 || !!en.mood || !!en.skip);

const DAY = 86400;
/** Games in the same sitting: the next one ended within 60 minutes of the previous one. */
const SESSION_GAP = 60 * 60;

/** The game before x in the same sitting (any time control), or null. */
export function prevInSession(games, x) {
  const i = games.indexOf(x);
  const p = i > 0 ? games[i - 1] : null;
  return p && x.t - p.t <= SESSION_GAP + 30 * 60 ? p : null;
}

/** Losses in a row ending with x (0 when x is not a loss), within a day. */
export function lossStreak(games, x) {
  let i = games.indexOf(x);
  let n = 0;
  while (i >= 0 && games[i].sc === 0 && x.t - games[i].t < DAY) { n++; i--; }
  return n;
}

/** The player's rating before this game (previous game in the same time class). */
export function ratingBefore(games, x) {
  const i = games.indexOf(x);
  for (let k = i - 1; k >= 0; k--) if (games[k].tc === x.tc && games[k].myR) return games[k].myR;
  return null;
}

/**
 * The critical moment of a reviewed game for the player: the biggest blunder, else the biggest
 * missed punishment. an: the game's Insights record. → {ply, mv, san, best, drop, fen, phase, clk, kind}
 */
export function criticalMoment(an) {
  if (!an) return null;
  const bl = (an.bl || []).slice().sort((a, b) => b.drop - a.drop)[0];
  if (bl) return { ...bl, kind: 'blunder' };
  const m = (an.missed || []).slice().sort((a, b) => b.drop - a.drop)[0];
  if (m) return { ...m, phase: m.mv <= 10 ? 'Opening' : 'Middlegame', kind: 'missed' };
  return null;
}

/**
 * Tags suggested from the data, each with the reason: [{tag, why}].
 * ctx: {games (all, oldest first), an (Insights records), idx (review index)}
 */
export function autoTags(x, { games = [], an = {}, idx = {} } = {}) {
  const out = [];
  const add = (tag, why) => { if (!out.some((t) => t.tag === tag)) out.push({ tag, why }); };
  const rec = an[x.id];
  const crit = criticalMoment(rec);
  const d = clockData(x);
  const tc = parseTC(x.g?.time_control);
  const base = tc?.base || (d.length ? Math.max(...d.map((m) => m.left)) : null);
  const low = base ? Math.max(10, base * 0.1) : 10;
  const myResult = x.col === 'w' ? x.g?.white?.result : x.g?.black?.result;
  if (myResult === 'timeout') add('time', 'You lost on time.');
  if (d.length && base) {
    const atCrit = crit ? d.find((m) => m.ply === crit.ply) : null;
    if (atCrit && atCrit.left < low) add('time', `${Math.round(atCrit.left)} s left at move ${crit.mv}.`);
    else if (x.sc !== 1) {
      const minLeft = Math.min(...d.map((m) => m.left));
      if (minLeft < low && x.sc === 0) add('time', `Your clock dropped to ${Math.round(minLeft)} s.`);
    }
    if (atCrit && atCrit.spent != null && atCrit.spent < 2 && atCrit.left >= low && base >= 120) add('fast', `${Math.round(atCrit.spent * 10) / 10 || '<1'} s spent on move ${crit.mv}.`);
  }
  if (rec) {
    // Only clear chances count: small missed edges are in almost every club game.
    const missed = (rec.missed || []).filter((m) => m.drop >= 25).sort((a, b) => b.drop - a.drop)[0];
    if (missed) add('tactic', `After ${missed.opp}, ${missed.best} won ${missed.drop} points of win chance.`);
    else if (crit?.best) {
      const th = motif(crit.fen, crit.best);
      if (['Double attack', 'Win material', 'Mate'].includes(th)) add('tactic', `${crit.best} was a ${th.toLowerCase()}.`);
    }
    if (crit && crit.mv <= 12) add('opening', `Your biggest mistake came on move ${crit.mv}.`);
    if (crit && crit.phase === 'Endgame') add('endgame', `Your biggest mistake came in the endgame (move ${crit.mv}).`);
  }
  const s = idx[x.id]?.s;
  if (s && x.sc !== 1) {
    const mine = s.map((w) => (x.col === 'w' ? w : 100 - w));
    if (Math.max(...mine.slice(4)) >= 85) add('convert', `You reached ${Math.round(Math.max(...mine.slice(4)))}% win chance and did not win.`);
  }
  const streakN = lossStreak(games, x);
  if (streakN >= 2) add('tilt', `${streakN === 2 ? '2nd' : streakN === 3 ? '3rd' : `${streakN}th`} loss in a row.`);
  return out;
}

/** The tags that count for a game: the player's own when journaled, otherwise the suggested ones. */
export function tagsOf(x, journal, ctx) {
  const en = journal?.e?.[x.id];
  if (en && isJournaled(en) && !en.skip) return { tags: en.tags || [], confirmed: true };
  return { tags: autoTags(x, ctx).map((t) => t.tag), confirmed: false };
}

const score = (L) => (L.length ? L.reduce((s, x) => s + x.sc, 0) / L.length : null);

/**
 * Stats by tag over the last `limit` games: for each tag, how many games and losses carry it,
 * the score with and without it, and blunders per game with and without it.
 * → [{tag, n, confirmed, losses, lossShare, score, scoreWithout, bpg, bpgWithout}] (most frequent in losses first)
 */
export function tagStats(games, journal, ctx, { limit = 200 } = {}) {
  const L = games.slice(-limit);
  const tagged = L.map((x) => ({ x, ...tagsOf(x, journal, ctx) }));
  const losses = L.filter((x) => x.sc === 0).length;
  const bl = (x) => ctx.an?.[x.id]?.bl?.length;
  const bpg = (A) => { const v = A.map(({ x }) => bl(x)).filter((n) => n != null); return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null; };
  const all = new Set(tagged.flatMap((t) => t.tags));
  return [...all].map((tag) => {
    const w = tagged.filter((t) => t.tags.includes(tag));
    const wo = tagged.filter((t) => !t.tags.includes(tag));
    const lw = w.filter((t) => t.x.sc === 0).length;
    return {
      tag, n: w.length, confirmed: w.filter((t) => t.confirmed).length, losses: lw, totalLosses: losses,
      lossShare: losses ? lw / losses : 0, score: score(w.map((t) => t.x)), scoreWithout: score(wo.map((t) => t.x)),
      bpg: bpg(w), bpgWithout: bpg(wo),
    };
  }).sort((a, b) => b.losses - a.losses || b.n - a.n);
}

/**
 * How results depend on the game before, from the games alone (no journaling needed):
 * score in the next game of the same sitting after a loss / after a win / after 2+ losses, and as the first game.
 */
export function afterResult(games) {
  const buckets = { afterLoss: [], afterWin: [], afterTwoLosses: [], fresh: [] };
  games.forEach((x, i) => {
    const p = prevInSession(games, x);
    if (!p) { buckets.fresh.push(x); return; }
    if (p.sc === 0) buckets.afterLoss.push(x);
    if (p.sc === 1) buckets.afterWin.push(x);
    if (p.sc === 0 && i >= 2 && games[i - 2].sc === 0 && p.t - games[i - 2].t <= SESSION_GAP + 30 * 60) buckets.afterTwoLosses.push(x);
  });
  return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, { n: v.length, score: score(v) }]));
}

/** Recent games still waiting for a journal entry (newest first). */
export function journalInbox(games, journal, { days = 7, now = Date.now() / 1000, limit = 20 } = {}) {
  return games.filter((x) => now - x.t < days * DAY && !isJournaled(journal?.e?.[x.id])).reverse().slice(0, limit);
}
