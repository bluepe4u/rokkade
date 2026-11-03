// Lichess opening statistics for the user's level. chess.com and Lichess ratings differ (Lichess
// runs higher, most at the low end), so the user's chess.com rating is converted first, per time
// control, then mapped to the explorer's rating bands.

// Approximate chess.com → Lichess rating anchors per time control (rounded from public
// comparison surveys; rough by nature, but far closer than treating the scales as equal).
export const CONVERSION = {
  bullet: [[400, 950], [800, 1250], [1000, 1400], [1200, 1550], [1500, 1750], [1800, 1950], [2100, 2150], [2500, 2450]],
  blitz: [[400, 1000], [800, 1300], [1000, 1450], [1200, 1600], [1500, 1800], [1800, 2000], [2100, 2200], [2500, 2500]],
  rapid: [[400, 1150], [800, 1450], [1000, 1600], [1200, 1700], [1500, 1850], [1800, 2000], [2100, 2200], [2400, 2400]],
};
CONVERSION.daily = CONVERSION.rapid;

/** chess.com rating in a time control → approximate Lichess rating. */
export function toLichess(rating, tc = 'blitz') {
  const T = CONVERSION[tc] || CONVERSION.blitz;
  if (rating <= T[0][0]) return Math.round(T[0][1] - (T[0][0] - rating) * 0.75);
  for (let i = 1; i < T.length; i++) {
    const [x0, y0] = T[i - 1];
    const [x1, y1] = T[i];
    if (rating <= x1) return Math.round(y0 + ((rating - x0) * (y1 - y0)) / (x1 - x0));
  }
  const [xa, ya] = T.at(-2);
  const [xb, yb] = T.at(-1);
  return Math.round(yb + ((rating - xb) * (yb - ya)) / (xb - xa));
}

export const BANDS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
/** The explorer's rating bands around a Lichess rating: the band it falls in and the one above. */
export function bandsFor(lichessRating) {
  let i = 0;
  while (i + 1 < BANDS.length && BANDS[i + 1] <= lichessRating) i++;
  return [BANDS[i], BANDS[Math.min(BANDS.length - 1, i + 1)]].filter((v, k, a) => a.indexOf(v) === k);
}

export const SPEEDS = { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid,classical', daily: 'classical,correspondence' };

const cache = new Map();
/**
 * Explorer statistics for a position at the user's level.
 * → {total, moves: [{san, uci, n, share, white, draws, black, score (for the side to move)}], bands, lichess} or {error}
 */
export async function explore(fen, { rating, tc = 'blitz' }) {
  const lichess = toLichess(rating, tc);
  const bands = bandsFor(lichess);
  const speeds = SPEEDS[tc] || 'blitz';
  const key = `${fen}|${bands}|${speeds}`;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const r = await fetch(`/api/lichess?fen=${encodeURIComponent(fen)}&ratings=${bands.join(',')}&speeds=${speeds}`, { cache: 'no-store' });
    const j = await r.json().catch(() => ({ error: 'bad response' }));
    if (!r.ok || j.error) { cache.delete(key); return { error: j.error || `HTTP ${r.status}`, lichess, bands }; }
    const stm = fen.split(' ')[1];
    const total = (j.white || 0) + (j.draws || 0) + (j.black || 0);
    const moves = (j.moves || []).map((m) => {
      const n = m.white + m.draws + m.black;
      const mine = stm === 'w' ? m.white : m.black;
      return { san: m.san, uci: m.uci, n, share: total ? n / total : 0, white: m.white, draws: m.draws, black: m.black, score: n ? (mine + m.draws / 2) / n : 0 };
    });
    return { total, moves, bands, lichess, speeds };
  })();
  cache.set(key, p);
  return p;
}

export async function tokenStatus() {
  try { return (await (await fetch('/api/lichess-status', { cache: 'no-store' })).json()).token; } catch { return false; }
}

export async function saveToken(token) {
  const r = await fetch('/api/lichess-token', { method: 'POST', body: JSON.stringify({ token }), headers: { 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not save the token');
  cache.clear();
}
