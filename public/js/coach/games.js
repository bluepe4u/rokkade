// chess.com games: parsing, per-game summary, aggregation, repertoire fit and advice.
import { moveLabel } from './library.js';

export const DRAW_RESULTS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
const FAM = ['Italian Game', 'Ruy Lopez', 'Sicilian Defense', 'French Defense', 'Caro Kann Defense', 'Scandinavian Defense', 'Queens Gambit', 'Kings Gambit', 'London System', 'English Opening', 'Scotch Game', 'Vienna Game', 'Petrovs Defense', 'Philidor Defense', 'Pirc Defense', 'Modern Defense', 'Alekhines Defense', 'Alekhine Defense', 'Van t Kruijs Opening', 'Vant Kruijs Opening', 'Nimzowitsch Larsen Attack', 'Bishops Opening', 'Center Game', 'Danish Gambit', 'Four Knights Game', 'Three Knights Opening', 'Kings Pawn Opening', 'Queens Pawn Opening', 'Kings Indian Defense', 'Kings Indian Attack', 'Nimzo Indian Defense', 'Queens Indian Defense', 'Grunfeld Defense', 'Benoni Defense', 'Slav Defense', 'Dutch Defense', 'Reti Opening', 'Zukertort Opening', 'Bird Opening', 'Owen Defense', 'Englund Gambit', 'Nimzowitsch Defense', 'Horwitz Defense', 'Trompowsky Attack', 'Colle System', 'Indian Game', 'Giuoco Piano', 'Ponziani Opening', 'Elephant Gambit', 'Latvian Gambit', 'Mieses Opening', 'Polish Opening', 'Grob Opening', 'Van Geet Opening', 'Hungarian Opening', 'Saragossa Opening', 'Kadas Opening', 'Amar Opening', 'Barnes Opening', 'Ware Opening'];

export const nice = (s) => s.replace(/\bKings\b/g, "King's").replace(/\bQueens\b/g, "Queen's").replace(/\bBishops\b/g, "Bishop's")
  .replace(/\bPetrovs\b/g, "Petrov's").replace(/\bPhilidors\b/g, "Philidor's").replace(/\bAlekhines\b/g, "Alekhine's")
  .replace(/\bVan ?t Kruijs\b/g, "Van't Kruijs").replace(/\bCaro Kann\b/g, 'Caro-Kann').replace(/\bNimzo Indian\b/g, 'Nimzo-Indian');
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const pct = (v) => `${Math.round(v * 100)}%`;
export const signed = (v) => { const r = Math.round(v * 100); return r === 0 ? '0' : (r > 0 ? '+' : '−') + Math.abs(r); };
export const ownChoice = (fam, c) => fam !== 'Unknown' && (c === 'b') === /Defense|Sicilian|French|Caro|Pirc|Modern|Slav|Grunfeld|Benoni|Dutch|Indian/.test(fam) && !/Attack/.test(fam);

export function groupBy(list, f) {
  const m = new Map();
  for (const x of list) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); }
  return m;
}

/** Opening family and full name from chess.com's eco URL. */
export function opening(g) {
  const slug = (g.eco || '').split('/openings/')[1] || '';
  if (!slug || slug.toLowerCase() === 'undefined') return { fam: 'Unknown', name: 'Unknown' };
  const full = decodeURIComponent(slug).replace(/\.\.\./g, '... ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const base = full.split(/\s\d+\./)[0].trim();
  const words = base.replace(/'/g, '');
  let fam = FAM.find((f) => words.startsWith(f));
  if (!fam) fam = words.split(' ').slice(0, 2).join(' ');
  return { fam: nice(fam), name: nice(full) };
}

/** SAN moves from a PGN (headers, comments, move numbers and result removed). */
export function pgnSans(pgn = '') {
  const i = pgn.indexOf('\n\n');
  let t = i < 0 ? pgn : pgn.slice(i + 2);
  t = t.replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\$\d+/g, ' ').replace(/\d+\.+/g, ' ')
    .replace(/\b(1-0|0-1|1\/2-1\/2)\s*$/, ' ').replace(/\*/g, ' ');
  return t.trim().split(/\s+/).filter(Boolean);
}

export const clocks = (pgn = '') => {
  const o = [];
  pgn.replace(/%clk (\d+):(\d+):([\d.]+)/g, (_, h, m, s) => { o.push(+h * 3600 + +m * 60 + +s); return ''; });
  return o;
};

/** Raw chess.com games → summaries for `user`, oldest first. Non-standard chess is dropped. */
export function prepGames(raw, user) {
  const me = String(user || '').toLowerCase();
  const out = [];
  for (const g of raw) {
    if (g.rules !== 'chess') continue;
    const isW = (g.white?.username || '').toLowerCase() === me;
    const isB = (g.black?.username || '').toLowerCase() === me;
    if (!isW && !isB) continue;
    const my = isW ? g.white : g.black;
    const op = isW ? g.black : g.white;
    const sc = my.result === 'win' ? 1 : DRAW_RESULTS.has(my.result) ? 0.5 : 0;
    const o = opening(g);
    out.push({
      g, id: g.uuid || g.url, col: isW ? 'w' : 'b', myR: my.rating, opR: op.rating, opp: op.username,
      sc, ex: 1 / (1 + 10 ** ((op.rating - my.rating) / 400)), fam: o.fam, name: o.name,
      t: g.end_time, tc: g.time_class, rated: g.rated, url: g.url, sans: pgnSans(g.pgn), src: 'chess.com',
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function filterGames(games, f, now = Date.now() / 1000) {
  const lim = { 3: 90, 12: 365, 24: 730 }[f.per];
  return games.filter((x) => (f.tc === 'all' || x.tc === f.tc) && (f.col === 'all' || x.col === f.col)
    && (f.rated === 'all' || x.rated) && (!lim || now - x.t < lim * 86400));
}

/** Score summary with a 95% margin on "score minus rating expectation". Games with sc == null are skipped. */
export function agg(list) {
  const L = list.filter((x) => x.sc != null);
  const n = L.length;
  let w = 0, d = 0, l = 0, sum = 0, ex = 0;
  const dv = [];
  for (const x of L) {
    if (x.sc === 1) w++; else if (x.sc === 0.5) d++; else l++;
    sum += x.sc;
    ex += x.ex ?? 0.5;
    dv.push(x.sc - (x.ex ?? 0.5));
  }
  const mean = n ? (sum - ex) / n : 0;
  const sd = n > 1 ? Math.sqrt(dv.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const ci = n > 1 ? (1.96 * sd) / Math.sqrt(n) : 1;
  return { n, w, d, l, sc: n ? sum / n : 0, ex: n ? ex / n : 0, diff: mean, ci, strong: n >= 15 && mean - ci > 0, weak: n >= 15 && mean + ci < 0 };
}

/** Where games leave the library: habits (your move) and gaps (their move), most frequent first. */
export function fit(lib, list) {
  const hab = new Map();
  const gap = new Map();
  const c = { habit: 0, gap: 0, end: 0, depth: 0 };
  for (const x of list) {
    const w = lib.walk(x.col, x.sans);
    c[w.type]++;
    c.depth += w.ply;
    if (w.type === 'end') continue;
    const key = `${x.col}|${w.node}|${w.san}`;
    const M = w.type === 'habit' ? hab : gap;
    let r = M.get(key);
    if (!r) { r = { col: x.col, node: w.node, san: w.san, ply: w.ply, path: x.sans.slice(0, w.ply), L: [] }; M.set(key, r); }
    r.L.push(x);
  }
  const rank = (M) => [...M.values()].map((r) => ({ ...r, a: agg(r.L) })).sort((a, b) => b.L.length - a.L.length);
  return { c, hab: rank(hab), gap: rank(gap), n: list.length };
}

/** Your most common sequence of moves within a group of games (stops when fewer than 3 games agree). */
export function mostCommon(list) {
  const out = [];
  let pool = list;
  for (let i = 0; i < 10; i++) {
    const M = groupBy(pool.filter((x) => x.sans[i]), (x) => x.sans[i]);
    let best = null, n = 0;
    for (const [k, v] of M) if (v.length > n) { best = k; n = v.length; }
    if (!best || n < 3) break;
    out.push(best);
    pool = M.get(best);
  }
  return out;
}

/** Advice cards: {h, b, hi?, ok?, act?: {t, line: {side, san, title, plan}}}. */
export function recommendations(lib, list, F, ES) {
  const out = [];
  const byC = groupBy(list, (x) => x.col);
  if (ES && ES.g >= 5) {
    const blg = ES.bl / ES.g;
    const phase = Object.entries(ES.ph).sort((a, b) => b[1] - a[1])[0][0].toLowerCase();
    out.push({ hi: 1, h: `Fix blunders first: ${blg.toFixed(1)} per game`, b: `Across ${ES.g} analysed games${ES.firstMed ? `, your first blunder usually comes around move ${ES.firstMed}` : ''}. Most happen in the ${phase}. Run the four-question check on every move, and work through your own blunders in Insights.` });
    if (ES.ms) out.push({ hi: 1, h: `You missed ${ES.ms} chances to punish a blunder`, b: `That is ${(ES.ms / ES.g).toFixed(1)} per game: the opponent made a serious mistake and your reply gave most of it back. After every opponent move, ask what it stopped defending.` });
    if (ES.sac.length >= 3) {
      const so = ES.sac.filter((s) => s.sound).length;
      out.push({ hi: so / ES.sac.length < 0.4, h: `Material you gave up: ${so} of ${ES.sac.length} held up`, b: 'Moves where you lost at least 2 points of material without winning it back within a move. The count includes plainly hung pieces, so check the list in Insights before calling them sacrifices.' });
    }
    if (ES.clkN >= 8 && ES.low / ES.clkN >= 0.25) out.push({ h: `${pct(ES.low / ES.clkN)} of your blunders come with under a minute left`, b: 'Clock trouble is costing you games. Play the library moves quickly to bank time for the first critical moment.' });
  } else {
    out.push({ h: 'Run the engine on your recent games', b: 'Blunder and missed-win advice appears once at least 5 games are analysed in Insights.' });
  }
  if (F.gap[0] && F.gap[0].L.length >= 3) {
    const g = F.gap[0];
    out.push({ h: `Most common hole in your library: ${moveLabel(g.ply)}${g.san}`, b: `Opponents played it in ${plural(g.L.length, 'game')}, and you scored ${pct(g.a.sc)}. It is waiting in Discoveries.` });
  }
  if (F.hab[0] && F.hab[0].L.length >= 3) {
    const g = F.hab[0];
    out.push({ h: `Habit to change: ${moveLabel(g.ply)}${g.san}`, b: `You played this in ${plural(g.L.length, 'game')} where the library plays ${lib.book(g.col, g.node).map((e) => e.s).join(' or ')}. Your score with it is ${pct(g.a.sc)}, against ${pct(g.a.ex)} expected from the ratings.` });
  }
  for (const c of ['w', 'b']) {
    const cl = byC.get(c);
    if (!cl || cl.length < 20) continue;
    const a = agg(cl);
    if (a.diff < -0.04 && a.diff + a.ci < 0) out.push({ h: `You are underperforming as ${c === 'w' ? 'White' : 'Black'}`, b: `You score ${pct(a.sc)} against ${pct(a.ex)} expected over ${a.n} games.` });
  }
  for (const c of ['w', 'b']) {
    const cl = byC.get(c);
    if (!cl) continue;
    const fams = [...groupBy(cl, (x) => x.fam)].map(([k, v]) => ({ k, v, a: agg(v) })).filter((f) => f.k !== 'Unknown');
    const cn = c === 'w' ? 'White' : 'Black';
    const mine = fams.filter((f) => f.a.strong && ownChoice(f.k, c) && !/^(Italian Game|Giuoco Piano|King's Indian Defense)/.test(f.k)).sort((a, b) => b.a.diff - a.a.diff);
    if (mine[0]) {
      const f = mine[0];
      const line = mostCommon(f.v);
      out.push({ ok: 1, h: `${f.k} works for you as ${cn}`, b: `You score ${signed(f.a.diff)} points per 100 games against rating expectation over ${plural(f.a.n, 'game')}. It is your own choice, so you could keep it alongside the library.`, act: line.length ? { t: 'Add its main line', line: { side: c, san: line, title: f.k, plan: `Your own main line, from ${plural(f.a.n, 'game')} at ${pct(f.a.sc)}.` } } : null });
    }
    const weak = fams.filter((f) => f.a.weak).sort((a, b) => a.a.diff - b.a.diff)[0];
    if (weak) out.push({ h: ownChoice(weak.k, c) ? `${weak.k} is costing you as ${cn}` : `You struggle against the ${weak.k} as ${cn}`, b: `You score ${signed(weak.a.diff)} points per 100 games against rating expectation over ${plural(weak.a.n, 'game')}.` });
  }
  return out;
}
