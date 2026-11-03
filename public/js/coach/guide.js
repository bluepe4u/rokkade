// Guide: a personal game plan built from the player's own data (games, Insights, library,
// Discoveries). Nothing player-specific is written in here: every section is chosen and worded
// from the numbers, and falls back to general advice for the rating band when data is missing.
import { agg, groupBy, fit, pct, signed, plural, ownChoice } from './games.js';
import { insightStats } from './analysis.js';
import { moveLabel } from './library.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TC_NAME = { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', daily: 'daily', classical: 'classical' };

export const BANDS = [
  { max: 800, key: 'new', name: 'Getting started', focus: 'keeping your pieces safe' },
  { max: 1200, key: 'improver', name: 'Improving player', focus: 'safety first, then simple tactics' },
  { max: 1600, key: 'club', name: 'Club player', focus: 'tactics and a clear plan after the opening' },
  { max: 2000, key: 'advanced', name: 'Strong club player', focus: 'calculation, plans and endgame technique' },
  { max: Infinity, key: 'expert', name: 'Expert', focus: 'depth of preparation and precise conversion' },
];
export const bandOf = (r) => (r == null ? null : BANDS.find((b) => r < b.max));

const myResult = (x) => (x.col === 'w' ? x.g?.white?.result : x.g?.black?.result) || '';
const oppResult = (x) => (x.col === 'w' ? x.g?.black?.result : x.g?.white?.result) || '';

/** Everything the guide needs, computed from the data. Safe with no games at all. */
export function playerProfile({ games = [], an = {}, lib = null, discoveries = [], now = Date.now() / 1000 } = {}) {
  const p = { n: games.length, games };
  if (!games.length) return { ...p, band: null, ES: null };
  const byTc = [...groupBy(games, (x) => x.tc)].map(([tc, L]) => {
    const recent = L.filter((x) => now - x.t < 90 * 86400);
    const before = L.filter((x) => x.t <= (recent[0]?.t ?? now) - 1).at(-1);
    return { tc, n: L.length, a: agg(L), rating: L.at(-1).myR, peak: Math.max(...L.map((x) => x.myR || 0)), change: before && recent.length ? L.at(-1).myR - before.myR : null };
  }).sort((a, b) => b.n - a.n);
  p.byTc = byTc;
  p.main = byTc[0];
  p.rating = p.main.rating;
  p.band = bandOf(p.rating);
  p.a = agg(games);
  p.form = agg(games.slice(-20));
  p.colour = { w: agg(games.filter((x) => x.col === 'w')), b: agg(games.filter((x) => x.col === 'b')) };
  p.first = games[0].t;
  p.last = games.at(-1).t;

  // How games end
  const losses = games.filter((x) => x.sc === 0);
  const wins = games.filter((x) => x.sc === 1);
  const count = (L, f) => L.filter(f).length;
  p.losses = {
    n: losses.length,
    mated: count(losses, (x) => myResult(x) === 'checkmated'),
    time: count(losses, (x) => myResult(x) === 'timeout'),
    resigned: count(losses, (x) => myResult(x) === 'resigned'),
    abandoned: count(losses, (x) => myResult(x) === 'abandoned'),
    early: count(losses, (x) => x.sans.length <= 50),
  };
  p.wins = { n: wins.length, mated: count(wins, (x) => oppResult(x) === 'checkmated'), time: count(wins, (x) => oppResult(x) === 'timeout') };
  p.length = { win: avg(wins.map((x) => x.sans.length / 2)), loss: avg(losses.map((x) => x.sans.length / 2)) };

  // After a loss vs after a win (games within 2 hours of the previous one)
  const afterLoss = [];
  const afterWin = [];
  for (let i = 1; i < games.length; i++) {
    if (games[i].t - games[i - 1].t > 7200) continue;
    if (games[i - 1].sc === 0) afterLoss.push(games[i]);
    else if (games[i - 1].sc === 1) afterWin.push(games[i]);
  }
  p.afterLoss = agg(afterLoss);
  p.afterWin = agg(afterWin);

  // Openings
  p.openings = {};
  for (const c of ['w', 'b']) {
    p.openings[c] = [...groupBy(games.filter((x) => x.col === c && x.fam !== 'Unknown'), (x) => x.fam)]
      .map(([fam, L]) => ({ fam, n: L.length, a: agg(L), own: ownChoice(fam, c) }))
      .sort((a, b) => b.n - a.n);
  }
  if (lib) {
    const F = fit(lib, games);
    p.fit = { depth: F.c.depth / Math.max(1, F.n) / 2, habits: F.hab.slice(0, 3), gaps: F.gap.length, habitGames: F.c.habit };
  }
  p.discoveries = {
    waiting: discoveries.filter((d) => d.status === 'ready' || d.status === 'new').length,
    studied: discoveries.filter((d) => d.status === 'studied').length,
    top: discoveries.find((d) => d.status === 'ready' || d.status === 'new') || null,
  };
  p.ES = insightStats(games, an);
  return p;
}

function avg(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }

/** Ranked focus areas: {key, title, why, steps[], weight}. */
export function priorities(p) {
  const out = [];
  const ES = p.ES;
  const L = p.losses || { n: 0 };
  if (ES && ES.g >= 5) {
    const bpg = ES.bl / ES.g;
    if (bpg >= 0.5) {
      const phase = Object.entries(ES.ph).sort((a, b) => b[1] - a[1])[0][0].toLowerCase();
      out.push({ key: 'blunders', weight: 2 + bpg * 2, title: 'Stop giving material away', why: `${bpg.toFixed(1)} blunders per game across ${plural(ES.g, 'analysed game')}, most of them in the ${phase}${ES.firstMed ? `; the first one usually comes around move ${ES.firstMed}` : ''}.`, steps: ['Before every move, look at what your opponent\'s last move attacks and what it stopped defending.', 'Before you let go of the piece, check every capture and check your opponent could answer with.', `Work through your own blunders in Insights: ${plural(Math.min(8, ES.blunders.length), 'position')} are waiting there.`] });
    }
    if (ES.ms / ES.g >= 0.3) out.push({ key: 'punish', weight: 1 + (ES.ms / ES.g) * 2, title: 'Punish your opponents\' mistakes', why: `${ES.ms} times in ${plural(ES.g, 'game')} your opponent made a serious error and your reply let them off.`, steps: ['When your opponent\'s move surprises you, stop and look for what it allows before following your plan.', 'Look for captures and checks first: most punishments start with one.', 'Replay the "Punishments you missed" positions in Insights until you find the move.'] });
    if (ES.sac.length >= 3) {
      const sound = ES.sac.filter((s) => s.sound).length / ES.sac.length;
      if (sound < 0.5) out.push({ key: 'sacrifice', weight: 1.5 * (1 - sound) + 0.5, title: 'Calculate before giving material', why: `Only ${pct(sound)} of the ${ES.sac.length} times you gave up material did the position hold.`, steps: ['Give up material only when you can name what you get: an exposed king, a big lead in development, or a winning attack.', 'Calculate every forcing reply to the end, not only the one you hope for.', 'If a simpler move wins material safely, play it instead.'] });
    }
    const endShare = ES.bl ? ES.ph.Endgame / ES.bl : 0;
    if (endShare >= 0.25 && ES.ph.Endgame >= 3) out.push({ key: 'endgame', weight: 1 + endShare * 2, title: 'Sharpen your endgames', why: `${pct(endShare)} of your blunders happen in the endgame.`, steps: ['Learn the core positions: king and pawn against king, the opposition, and rook endgames with the rook behind the passed pawn.', 'In the endgame, activate your king early.', 'Count pawn races before you commit to them.'] });
    if (ES.clkN >= 8 && ES.low / ES.clkN >= 0.25) out.push({ key: 'clock', weight: 1.5 + (ES.low / ES.clkN) * 2, title: 'Manage your clock', why: `${pct(ES.low / ES.clkN)} of your blunders come with under a minute left.`, steps: ['Play the opening moves you know quickly and save time for the first critical moment.', 'Keep at least a fifth of your starting time for the last part of the game.'] });
  }
  if (L.n >= 8) {
    const timeShare = L.time / L.n;
    if (timeShare >= 0.2 && !out.some((x) => x.key === 'clock')) out.push({ key: 'clock', weight: 1 + timeShare * 3, title: 'Manage your clock', why: `${pct(timeShare)} of your losses (${L.time} of ${L.n}) were on time.`, steps: ['Play the opening moves you know quickly and save time for the first critical moment.', 'When the position is simple, move faster; spend time only where the position is sharp.'] });
    const mateShare = L.mated / L.n;
    if (mateShare >= 0.35) out.push({ key: 'king', weight: 1 + mateShare * 2, title: 'Keep your king safe', why: `${pct(mateShare)} of your losses ended in checkmate.`, steps: ['Castle early and keep the pawns in front of your king where they are.', 'Before each move, ask which checks your opponent has and where their pieces point at your king.', 'Give your king an escape square (a "luft") when your back rank is weak.'] });
    const earlyShare = L.early / L.n;
    if (!ES && earlyShare >= 0.4) out.push({ key: 'blunders', weight: 1 + earlyShare * 2, title: 'Stop giving material away', why: `${pct(earlyShare)} of your losses are over within 25 moves, a sign of early material loss. Run Insights to check.`, steps: ['Before every move, check what your opponent\'s last move attacks.', 'Before you let go of the piece, check every capture and check your opponent could answer with.'] });
  }
  if (p.fit && p.n >= 10) {
    if (p.discoveries?.waiting >= 3 || p.fit.depth < 4) out.push({ key: 'opening', weight: 0.8 + Math.min(1.5, (p.discoveries?.waiting || 0) / 6), title: 'Close the holes in your opening library', why: `On average your games leave the library after ${p.fit.depth.toFixed(1)} moves${p.discoveries?.waiting ? `, and ${plural(p.discoveries.waiting, 'new position')} from your games ${p.discoveries.waiting === 1 ? 'is' : 'are'} waiting in Discoveries` : ''}.`, steps: ['Study the waiting discoveries: each one ends with the line added to your library.', 'Drill each new line once in Library, then again after it comes up in a game.'] });
    const h = p.fit.habits[0];
    if (h && h.L.length >= 3 && h.a.sc < h.a.ex) out.push({ key: 'habit', weight: 0.8, title: `Change a habit: ${moveLabel(h.ply)}${h.san}`, why: `You played it in ${plural(h.L.length, 'game')} where your library has another move, and scored ${pct(h.a.sc)} against ${pct(h.a.ex)} expected.`, steps: ['Drill the library move in Library (Games → Habits → Drill).', 'Or keep your move as an extra line if you prefer it.'] });
  }
  const cw = p.colour?.w;
  const cb = p.colour?.b;
  if (cw && cb && cw.n >= 15 && cb.n >= 15 && Math.abs(cw.diff - cb.diff) >= 0.08) {
    const weak = cw.diff < cb.diff ? 'w' : 'b';
    const name = weak === 'w' ? 'White' : 'Black';
    out.push({ key: 'colour', weight: 0.6 + Math.abs(cw.diff - cb.diff) * 4, title: `Lift your results as ${name}`, why: `You score ${pct(p.colour[weak].sc)} as ${name} (${signed(p.colour[weak].diff)} per 100 games against expectation), clearly below your other colour.`, steps: [`Look at your ${name} openings below and in Games; fix or replace the weakest one.`, `Review a few recent ${name} losses to see where they go wrong.`] });
  }
  if (p.afterLoss?.n >= 15 && p.afterWin?.n >= 15 && p.afterWin.sc - p.afterLoss.sc >= 0.1) {
    out.push({ key: 'tilt', weight: 0.8 + (p.afterWin.sc - p.afterLoss.sc) * 3, title: 'Take a break after a loss', why: `Straight after a loss you score ${pct(p.afterLoss.sc)}; straight after a win, ${pct(p.afterWin.sc)}.`, steps: ['After a loss, take a few minutes before the next game, or review the loss first.', 'After two losses in a row, stop for the session.'] });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

// General patterns, shown when the data points to them (and a default set otherwise).
const PATTERNS = {
  fork: { title: 'Double attack', fen: 'r3k3/pp3ppp/8/3N4/8/8/PPP2PPP/4K3 w - - 0 1', ar: 'd5-c7', text: 'One move attacks two things at once. Knights, queens and pawns do it most. Before each move, look for squares where one of your pieces would hit two targets, and check your opponent\'s chances to do the same.' },
  backrank: { title: 'Back-rank mate', fen: '3R2k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1', ar: '', text: 'A rook or queen on the last rank mates a king boxed in by its own pawns. Give your king an escape square in time, and look for this chance against a king that has none.' },
  defender: { title: 'Remove the defender', fen: 'r1b2rk1/ppq2ppp/5n2/6BQ/8/3B4/PPP2PPP/R4RK1 w - - 0 1', ar: 'g5-f6,h5-h7', text: 'If one piece guards two things, take or trade it and one of them falls. Ask of every enemy piece: what is it defending?' },
  punish: { title: 'Punish the loose move', fen: 'rnbqkb1r/pppp1ppp/5n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1', ar: 'h5-f7', text: 'After every opponent move, ask what it attacks and what it stopped defending. Many games are won simply by noticing an undefended piece or a weakened square like f7.' },
  sacrifice: { title: 'Sacrifice checklist', fen: 'r1bq1rk1/pp1n1ppB/2p1p3/3pP3/1b1P4/2N2N2/PPP2PPP/R2QK2R w KQ - 0 1', ar: 'f3-g5,d1-h5', text: 'Before giving material: is there a simpler win? Have you calculated every forced reply? What happens if it is declined? Do you have more attackers than they have defenders? If you can\'t answer the second question, don\'t do it.' },
  endgame: { title: 'Opposition', fen: '8/8/4k3/8/4K3/4P3/8/8 w - - 0 1', ar: '', text: 'In king and pawn endgames, kings facing each other with one square between them: the side not to move must give way. Win the opposition to escort your pawn; take it as the defender to hold the draw.' },
  king: { title: 'Pawn shield', fen: 'r1bq1rk1/ppp2ppp/2n2n2/3pp3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 1', ar: '', text: 'The three pawns in front of a castled king are its shelter. Move them only with a reason, and count attackers and defenders near your king before you open lines there.' },
  development: { title: 'Develop, castle, connect', fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 1', ar: 'e1-g1', text: 'In the first ten moves: bring out the minor pieces, castle, and connect the rooks. Move each piece once, don\'t chase pawns with the queen, and fight for the centre.' },
};
const PATTERN_FOR = { blunders: ['fork', 'defender'], punish: ['punish'], sacrifice: ['sacrifice'], endgame: ['endgame'], king: ['backrank', 'king'], opening: ['development'], clock: [], habit: ['development'], colour: [], tilt: [] };

/** Weekly training plan: minutes per activity, weighted by the priorities. */
export function trainingPlan(p, prio) {
  const band = p.band?.key || 'club';
  const total = { new: 180, improver: 240, club: 300, advanced: 360, expert: 420 }[band];
  const w = { 'Tactics puzzles': 3, 'Playing longer games': 2, 'Reviewing your games': 2, 'Openings (Discoveries + drills)': 1, Endgames: band === 'new' ? 0.5 : 1 };
  for (const x of prio.slice(0, 4)) {
    if (['blunders', 'punish', 'sacrifice', 'king'].includes(x.key)) w['Tactics puzzles'] += 1.5;
    if (x.key === 'endgame') w.Endgames += 2;
    if (x.key === 'opening' || x.key === 'habit') w['Openings (Discoveries + drills)'] += 1.5;
    if (x.key === 'clock' || x.key === 'tilt') w['Playing longer games'] += 1;
    if (x.key === 'colour') w['Reviewing your games'] += 1;
  }
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  return { total, items: Object.entries(w).map(([k, v]) => ({ k, min: Math.round((total * v) / sum / 5) * 5 })).sort((a, b) => b.min - a.min) };
}

const card = (inner, cls = '') => `<div class="gcard rise ${cls}">${inner}</div>`;
const bar = (label, v, max, txt) => `<div class="hbar"><span>${esc(label)}</span><div><i data-w="${max ? Math.max(2, (100 * v) / max) : 0}"></i></div><span>${txt}</span></div>`;

/** Build the guide's HTML from the data. */
export function buildGuide(ctx) {
  const p = playerProfile(ctx);
  const lib = ctx.lib;
  const prio = priorities(p);
  const plan = trainingPlan(p, prio);
  const h = [];
  const user = ctx.user ? esc(ctx.user) : null;

  // ── header
  if (!p.n) {
    h.push(`<span class="eyebrow">Guide</span><h1>Your game plan</h1><p class="lede">This guide is built from your own games. Import them in <a class="link" href="#games">Games</a> and it will show your strengths, what to fix first, a training plan and the patterns worth learning. Until then, here is a general plan.</p>`);
  } else {
    const b = p.band;
    h.push(`<span class="eyebrow">Guide${user ? ` · ${user}` : ''}</span><h1>Your game plan</h1>
      <p class="lede">Built from ${plural(p.n, 'game')}${p.ES ? ` (${p.ES.g} analysed by the engine)` : ''}, ${new Date(p.first * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} to ${new Date(p.last * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}. It updates as you import, analyse and study.</p>
      <div class="tiles">
        <div class="tile rise"><b data-count="${p.rating}">${p.rating}</b><span>${esc(TC_NAME[p.main.tc] || p.main.tc)} rating${p.main.change != null ? ` · ${p.main.change >= 0 ? '+' : '−'}${Math.abs(p.main.change)} in 90 days` : ''}</span></div>
        <div class="tile rise"><b>${esc(b.name)}</b><span>focus: ${esc(b.focus)}</span></div>
        <div class="tile rise"><b data-count="${Math.round(p.a.sc * 100)}" data-fmt="pct">${pct(p.a.sc)}</b><span>score · ${signed(p.a.diff)} vs rating expectation</span></div>
        <div class="tile rise"><b data-count="${Math.round(p.form.sc * 100)}" data-fmt="pct">${pct(p.form.sc)}</b><span>last ${p.form.n} games</span></div>
      </div>`);
  }

  // ── priorities
  if (p.n) {
    h.push('<h2>What to work on first</h2>');
    if (prio.length) {
      h.push(`<div class="prio">${prio.slice(0, 4).map((x, i) => card(`<div class="prio-n">${i + 1}</div><div><h3>${esc(x.title)}</h3><p class="note">${esc(x.why)}</p><ul>${x.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>`, 'prio-card')).join('')}</div>`);
    } else {
      h.push(card(`<h3>No clear weak spot yet</h3><p class="note">${p.ES ? 'Your games look balanced.' : 'Run the engine on at least 5 games in <a class="link" href="#insights">Insights</a> to find your mistakes.'} Keep playing longer games and reviewing them.</p>`));
    }
  }

  // ── how games end
  if (p.losses?.n >= 5) {
    const L = p.losses;
    const max = Math.max(L.mated, L.time, L.resigned, L.abandoned, 1);
    h.push(`<h2>How your games are lost</h2><div class="gcard rise">${bar('Checkmated', L.mated, max, L.mated)}${bar('Resigned', L.resigned, max, L.resigned)}${bar('On time', L.time, max, L.time)}${L.abandoned ? bar('Abandoned', L.abandoned, max, L.abandoned) : ''}
      <p class="note" style="margin-bottom:0">${L.n} ${L.n === 1 ? 'loss' : 'losses'} in total${p.length.loss ? `, lasting ${Math.round(p.length.loss)} moves on average (wins: ${Math.round(p.length.win)})` : ''}.${p.ES ? ` The engine finds your first blunder around move ${p.ES.firstMed ?? '–'}.` : ''}</p></div>`);
  }

  // ── time controls
  if (p.byTc?.length > 1) {
    const best = p.byTc.filter((t) => t.n >= 10).sort((a, b) => b.a.diff - a.a.diff)[0];
    h.push(`<h2>Time controls</h2><div class="gcard rise">${p.byTc.map((t) => bar(`${TC_NAME[t.tc] || t.tc}`, t.n, p.byTc[0].n, `${t.n} · ${pct(t.a.sc)}`)).join('')}
      ${best ? `<p class="note" style="margin-bottom:0">You do best in ${esc(best.tc)} (${signed(best.a.diff)} per 100 games against expectation).${p.ES && p.ES.bl / p.ES.g >= 1 && ['bullet', 'blitz'].includes(p.main.tc) ? ' Most of your games are fast; longer games give you time to check your moves and build better habits.' : ''}</p>` : ''}</div>`);
  }

  // ── openings
  h.push('<h2>Your openings</h2>');
  if (lib) {
    const first = lib.book('w', 0).map((e) => e.s);
    const vsE4 = lib.nodeAfter('b', ['e4']);
    const vsD4 = lib.nodeAfter('b', ['d4']);
    const rep = [
      `<li><b>White:</b> ${first.length ? `1.${esc(first.join(' or 1.'))}` : 'no lines yet'} · ${lib.stats('w').lines} lines</li>`,
      vsE4 >= 0 ? `<li><b>Black against 1.e4:</b> 1...${esc(lib.book('b', vsE4).map((e) => e.s).join(' or 1...'))}</li>` : '',
      vsD4 >= 0 ? `<li><b>Black against 1.d4:</b> 1...${esc(lib.book('b', vsD4).map((e) => e.s).join(' or 1...'))}</li>` : '',
      `<li><b>Black in total:</b> ${lib.stats('b').lines} lines${lib.stats('w').custom + lib.stats('b').custom ? `, ${lib.stats('w').custom + lib.stats('b').custom} added from your games` : ''}</li>`,
    ].join('');
    h.push(card(`<h3>Your library</h3><ul>${rep}</ul>${p.fit ? `<p class="note" style="margin-bottom:0">Your games stay in the library for ${p.fit.depth.toFixed(1)} moves on average. ${p.discoveries.waiting ? `<a class="link" href="#discoveries">${plural(p.discoveries.waiting, 'position')} waiting in Discoveries →</a>` : 'Nothing is waiting in Discoveries.'}</p>` : ''}`));
  }
  if (p.n) {
    for (const c of ['w', 'b']) {
      const ops = p.openings[c].slice(0, 5);
      if (!ops.length) continue;
      const strong = ops.filter((o) => o.a.strong);
      const weak = ops.filter((o) => o.a.weak);
      h.push(card(`<h3>What you actually play as ${c === 'w' ? 'White' : 'Black'}</h3>${ops.map((o) => bar(o.fam, o.n, ops[0].n, `${o.n} · ${pct(o.a.sc)}`)).join('')}
        <p class="note" style="margin-bottom:0">${strong.length ? `Working for you: ${strong.map((o) => `<b>${esc(o.fam)}</b> (${signed(o.a.diff)})`).join(', ')}. ` : ''}${weak.length ? `Costing you: ${weak.map((o) => `<b>${esc(o.fam)}</b> (${signed(o.a.diff)})`).join(', ')}${weak.some((o) => !o.own) ? '; the Discoveries from these games show your best answers' : '; consider fixing or replacing it'}. ` : ''}${!strong.length && !weak.length ? 'No opening stands out yet (that needs 15+ games and a clear difference).' : ''}</p>`));
    }
  }

  // ── thinking routine (general, with the band's emphasis)
  const safetyFirst = !p.band || ['new', 'improver'].includes(p.band.key);
  const steps = [
    ['What did their move change?', 'What does it attack, and what did it stop defending?'],
    ['What are the forcing moves?', 'Checks, captures and threats, for both sides, in that order.'],
    ['What is my plan?', 'Pick the move that improves your worst piece or furthers your plan.'],
    ['Is it safe?', 'Assume their best check or capture in reply. If a piece hangs, choose again.'],
  ];
  if (safetyFirst) steps.unshift(steps.splice(3, 1)[0]);
  h.push(`<h2>Every move: a four-question check</h2>${card(`<ol>${steps.map(([a, b]) => `<li><b>${a}</b> ${b}</li>`).join('')}</ol>${safetyFirst ? '<p class="note" style="margin-bottom:0">At your level, the safety question comes first: most games are decided by a piece left undefended.</p>' : ''}`)}`);

  // ── phases
  const ph = p.ES?.ph;
  const phTot = ph ? ph.Opening + ph.Middlegame + ph.Endgame : 0;
  const phNote = (k) => (phTot ? ` <span class="note">(${pct(ph[k] / phTot)} of your blunders)</span>` : '');
  h.push(`<h2>Phase by phase</h2>${card(`<ul>
    <li><b>Opening, moves 1–10${phNote('Opening')}.</b> Develop the minor pieces, castle, and fight for the centre. Play your library moves, and study the positions where opponents surprise you.</li>
    <li><b>Middlegame${phNote('Middlegame')}.</b> Find a plan from the pawn structure: attack where you have more space, open lines toward the enemy king, and trade pieces when you are ahead.</li>
    <li><b>Endgame${phNote('Endgame')}.</b> Activate your king, create a passed pawn, put rooks behind passed pawns, and count pawn races before you commit.</li></ul>`)}`);

  // ── patterns
  const keys = [...new Set(prio.slice(0, 4).flatMap((x) => PATTERN_FOR[x.key] || []))];
  const pats = (keys.length ? keys : safetyFirst ? ['fork', 'backrank', 'development'] : ['defender', 'fork', 'endgame']).slice(0, 4);
  h.push(`<h2>Patterns to learn</h2><p class="note">${keys.length ? 'Chosen from the mistakes in your games.' : 'A starting set for your level; it adapts once your games are analysed.'}</p><div class="patterns">${pats.map((k) => {
    const x = PATTERNS[k];
    return card(`<div class="gmini" data-fen="${x.fen}" data-ar="${x.ar}"></div><div><h3>${esc(x.title)}</h3><p style="margin:0">${esc(x.text)}</p></div>`, 'pattern');
  }).join('')}</div>`);

  // ── training plan
  h.push(`<h2>Your week</h2><p class="note">About ${Math.round(plan.total / 60)} hours, weighted toward your priorities. Adjust the total to your time; keep the proportions.</p>
    ${card(`${plan.items.map((x) => bar(x.k, x.min, plan.items[0].min, `${x.min} min`)).join('')}
    <ul style="margin-bottom:0"><li><b>Tactics:</b> slow and accurate beats fast. Calculate to the end before you move.</li>
    <li><b>Games:</b> ${p.main && ['bullet', 'blitz'].includes(p.main.tc) ? 'add some rapid games (15+10 if you can), ' : ''}use the four-question check on every move.</li>
    <li><b>Review:</b> find your own mistakes first, then check them in <a class="link" href="#review">Review</a>. Note the first serious error of each game.</li>
    <li><b>Openings:</b> study what's waiting in <a class="link" href="#discoveries">Discoveries</a>, then drill the new lines in <a class="link" href="#library">Library</a>.</li></ul>`)}`);

  if (p.n && !p.ES) h.push(`<p class="note">Analyse your games in <a class="link" href="#insights">Insights</a> to make this guide sharper: it then knows where your blunders happen and what you miss.</p>`);
  return { html: h.join('\n'), profile: p, priorities: prio, plan };
}
