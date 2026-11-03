// Clock analysis from the %clk tags in chess.com PGNs: how you spend your time, when you get into
// time trouble, and how thinking time relates to move quality (losses from the reviews).
import { agg } from './games.js';

/** "180+2" → {base: 180, inc: 2}; daily ("1/86400") → null. */
export function parseTC(tc) {
  const m = /^(\d+)(?:\+(\d+))?$/.exec(String(tc || ''));
  return m ? { base: +m[1], inc: +(m[2] || 0) } : null;
}

/** Your clock per move: [{ply, mv, spent, left}] (seconds). Empty when the PGN has no clocks. */
export function clockData(x) {
  const clk = [...(x.g?.pgn || '').matchAll(/%clk (\d+):(\d+):([\d.]+)/g)].map((m) => +m[1] * 3600 + +m[2] * 60 + +m[3]);
  if (clk.length < 4) return [];
  const tc = parseTC(x.g?.time_control);
  const inc = tc?.inc || 0;
  const out = [];
  let prev = tc?.base ?? null;
  for (let i = 0; i < clk.length; i++) {
    if ((i % 2 === 0) !== (x.col === 'w')) continue;
    const left = clk[i];
    const spent = prev == null ? null : Math.max(0, prev - left + inc);
    out.push({ ply: i, mv: Math.floor(i / 2) + 1, spent, left });
    prev = left;
  }
  return out;
}

const BUCKETS = [[0, 2, 'under 2 s'], [2, 5, '2–5 s'], [5, 15, '5–15 s'], [15, 45, '15–45 s'], [45, Infinity, 'over 45 s']];

/**
 * Report across games. idx: review index (per-ply losses in `l`); lib: library (to tell book moves).
 */
export function clockReport(games, idx = {}, lib = null) {
  const withClock = [];
  for (const x of games) {
    const d = clockData(x);
    if (d.length >= 3) withClock.push({ x, d });
  }
  if (withClock.length < 3) return null;
  const tcCount = new Map();
  for (const { x } of withClock) tcCount.set(x.tc, (tcCount.get(x.tc) || 0) + 1);
  const mainTc = [...tcCount].sort((a, b) => b[1] - a[1])[0][0];
  const main = withClock.filter(({ x }) => x.tc === mainTc);
  const phase = { Opening: [], Middlegame: [], Endgame: [] };
  const curve = Array.from({ length: 40 }, () => []);
  const buckets = BUCKETS.map(([lo, hi, label]) => ({ lo, hi, label, n: 0, loss: 0, blunders: 0 }));
  const trouble = [];
  const calm = [];
  let bookSpend = [];
  let firstBlunderLeft = [];
  for (const { x, d } of main) {
    const tc = parseTC(x.g?.time_control);
    const base = tc?.base || Math.max(...d.map((m) => m.left));
    const minLeft = Math.min(...d.map((m) => m.left));
    (minLeft < Math.max(10, base * 0.1) ? trouble : calm).push(x);
    const libPly = lib ? lib.walk(x.col, x.sans).ply : 0;
    const L = idx[x.id]?.l;
    let blundered = false;
    for (const m of d) {
      if (m.spent == null) continue;
      const ph = m.mv <= 10 ? 'Opening' : m.mv <= 30 ? 'Middlegame' : 'Endgame';
      phase[ph].push(m.spent);
      if (m.mv <= 40) curve[m.mv - 1].push(m.spent);
      if (m.ply < libPly) bookSpend.push(m.spent);
      if (L && L[m.ply] != null) {
        const b = buckets.find((q) => m.spent >= q.lo && m.spent < q.hi);
        b.n++;
        b.loss += L[m.ply];
        if (L[m.ply] >= 15) { b.blunders++; if (!blundered) { blundered = true; firstBlunderLeft.push(Math.min(1, m.left / base)); } }
      }
    }
  }
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const med = (a) => { if (!a.length) return null; const s = a.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  const losses = games.filter((x) => x.sc === 0);
  const timeouts = losses.filter((x) => (x.col === 'w' ? x.g?.white?.result : x.g?.black?.result) === 'timeout').length;
  const tcInfo = parseTC(main[0]?.x.g?.time_control);
  return {
    games: withClock.length, mainTc, mainGames: main.length, tc: tcInfo,
    phase: Object.fromEntries(Object.entries(phase).map(([k, v]) => [k, avg(v)])),
    curve: curve.map((v) => avg(v)),
    buckets: buckets.map((b) => ({ label: b.label, n: b.n, avgLoss: b.n ? b.loss / b.n : null, blunderRate: b.n ? b.blunders / b.n : null })),
    trouble: { n: trouble.length, share: trouble.length / Math.max(1, main.length), score: agg(trouble), calmScore: agg(calm) },
    timeouts, losses: losses.length,
    bookSpend: med(bookSpend),
    firstBlunderLeft: med(firstBlunderLeft),
  };
}

/** One-line conclusions from a report. */
export function clockAdvice(r) {
  if (!r) return [];
  const out = [];
  const q = r.buckets.filter((b) => b.n >= 20);
  const fast = q.find((b) => b.label === 'under 2 s');
  const slow = q.filter((b) => b.label !== 'under 2 s');
  const slowRate = slow.length ? slow.reduce((s, b) => s + b.blunders, 0) : 0;
  if (fast && slow.length) {
    const slowN = slow.reduce((s, b) => s + b.n, 0);
    const slowBl = slow.reduce((s, b) => s + (b.blunderRate || 0) * b.n, 0) / Math.max(1, slowN);
    if (fast.blunderRate > slowBl * 1.5 && fast.blunderRate > 0.03) out.push(`Moves played in under 2 seconds are blundered ${(fast.blunderRate / Math.max(slowBl, 0.001)).toFixed(1)}× as often as slower ones. Take a breath before the quick ones.`);
  }
  void slowRate;
  if (r.trouble.share >= 0.25) out.push(`You get into time trouble in ${Math.round(r.trouble.share * 100)}% of your ${r.mainTc} games, and score ${Math.round(r.trouble.score.sc * 100)}% in them against ${Math.round(r.trouble.calmScore.sc * 100)}% otherwise.`);
  if (r.losses >= 8 && r.timeouts / r.losses >= 0.15) out.push(`${r.timeouts} of your ${r.losses} losses were on time.`);
  if (r.bookSpend != null && r.bookSpend >= 3) out.push(`You spend a median ${r.bookSpend.toFixed(1)} s on moves that are in your library. Play those quickly and bank the time.`);
  if (r.firstBlunderLeft != null && r.firstBlunderLeft < 0.25) out.push(`Your first blunder usually comes with only ${Math.round(r.firstBlunderLeft * 100)}% of your time left.`);
  const op = r.phase.Opening;
  const mid = r.phase.Middlegame;
  if (op != null && mid != null && op > mid) out.push(`You think longer per move in the opening (${op.toFixed(1)} s) than in the middlegame (${mid.toFixed(1)} s).`);
  return out;
}
