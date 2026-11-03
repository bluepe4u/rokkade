// Accuracy calibration: chess.com reports its own accuracy per player on most games. We fit a
// mapping from our accuracy to theirs (quadratic when there is enough data, linear otherwise),
// so the numbers in Outpost read like the ones players know.

/** Pairs of (our raw accuracy, chess.com accuracy) from reviewed games that have both. */
export function calibrationPairs(games, idx) {
  const out = [];
  for (const x of games) {
    const r = idx[x.id];
    const cc = x.g?.accuracies;
    if (!r || !cc) continue;
    if (typeof cc.white === 'number' && typeof r.w === 'number') out.push({ raw: r.w, ref: cc.white });
    if (typeof cc.black === 'number' && typeof r.b === 'number') out.push({ raw: r.b, ref: cc.black });
  }
  return out;
}

function solve(A, y) {
  // normal equations (A^T A) x = A^T y, tiny systems only
  const n = A[0].length;
  const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => A.reduce((s, r) => s + r[i] * r[j], 0)));
  const v = Array.from({ length: n }, (_, i) => A.reduce((s, r, k) => s + r[i] * y[k], 0));
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    [v[i], v[p]] = [v[p], v[i]];
    if (Math.abs(M[i][i]) < 1e-9) return null;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = M[k][i] / M[i][i];
      for (let j = i; j < n; j++) M[k][j] -= f * M[i][j];
      v[k] -= f * v[i];
    }
  }
  return v.map((vi, i) => vi / M[i][i]);
}

const clamp = (v) => Math.max(0, Math.min(100, v));
export function applyCalibration(raw, cal) {
  if (raw == null || !cal) return raw;
  return +clamp(cal.a + cal.b * raw + (cal.c || 0) * raw * raw).toFixed(1);
}

/** Fit; null below 8 pairs. Quadratic only when it beats linear by a margin (avoids overfitting). */
export function fitCalibration(pairs) {
  if (pairs.length < 8) return null;
  const y = pairs.map((p) => p.ref);
  const mae = (cal) => pairs.reduce((s, p) => s + Math.abs(applyCalibration(p.raw, cal) - p.ref), 0) / pairs.length;
  const lin = solve(pairs.map((p) => [1, p.raw]), y);
  if (!lin) return null;
  let best = { kind: 'linear', a: lin[0], b: lin[1], c: 0 };
  let bestMae = mae(best);
  if (pairs.length >= 25) {
    const q = solve(pairs.map((p) => [1, p.raw, p.raw * p.raw]), y);
    if (q) {
      const cand = { kind: 'quadratic', a: q[0], b: q[1], c: q[2] };
      const m = mae(cand);
      if (m < bestMae - 0.3) { best = cand; bestMae = m; }
    }
  }
  const maeRaw = pairs.reduce((s, p) => s + Math.abs(p.raw - p.ref), 0) / pairs.length;
  return { ...best, n: pairs.length, maeRaw: +maeRaw.toFixed(2), maeFit: +bestMae.toFixed(2) };
}
