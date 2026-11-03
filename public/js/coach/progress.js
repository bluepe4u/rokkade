// Practice tracking for "get better consistently": a daily activity log (streak, goal, calendar)
// and spaced repetition for library lines. Stored as the "progress" document.
//   {v: 1, goal: 3, days: {"2026-11-03": {drill: 2, study: 1, review: 1, game: 1, insight: 0, seen: [...]}},
//    srs: {"w|e4 e5 Nf3": {due: "2026-11-06", iv: 3, reps: 2, lapses: 0, first: "2026-11-02", at: 1730600000000}}}

export const DOC = 'progress';
export const INTERVALS = [1, 3, 7, 16, 35, 75, 150];
export const KINDS = ['drill', 'study', 'review', 'game', 'insight', 'puzzle', 'train'];
export const NEW_PER_DAY = 2;

const pad = (n) => String(n).padStart(2, '0');
/** Local calendar day as yyyy-mm-dd. */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n)); };
export const lineKey = (side, san) => `${side}|${san.join(' ')}`;
/** Library-line keys start with the side; puzzles (pz|), endgames (eg|) and calculation (calc|) don't. */
export const isLineKey = (k) => k.startsWith('w|') || k.startsWith('b|');

export const emptyProgress = () => ({ v: 1, goal: 3, days: {}, srs: {}, goals: [], goalsAt: 0 });

/** Record one activity for today (deduplicated by `id` within the day). Returns true if counted. */
export function logActivity(doc, kind, { id = null, today = dayKey() } = {}) {
  const d = (doc.days[today] ||= {});
  if (id) {
    d.seen ||= [];
    const k = `${kind}:${id}`;
    if (d.seen.includes(k)) return false;
    d.seen.push(k);
  }
  d[kind] = (d[kind] || 0) + 1;
  return true;
}

export const dayTotal = (d) => (d ? KINDS.reduce((s, k) => s + (d[k] || 0), 0) : 0);

/**
 * Consecutive active days ending today (or yesterday, if today has nothing yet).
 * `extra` is a Set of day keys with outside activity (chess.com games).
 */
export function streak(doc, extra = new Set(), today = dayKey()) {
  const active = (k) => dayTotal(doc.days[k]) > 0 || extra.has(k);
  let k = active(today) ? today : addDays(today, -1);
  let n = 0;
  while (active(k)) { n++; k = addDays(k, -1); }
  return n;
}

/** Spaced repetition update after drilling a line: clean → longer interval, mistakes → tomorrow. */
export function reviewLine(doc, key, clean, today = dayKey(), now = Date.now()) {
  const old = doc.srs[key];
  const reps = clean ? (old?.reps || 0) + 1 : 0;
  const iv = clean ? INTERVALS[Math.min(reps - 1, INTERVALS.length - 1)] : 1;
  doc.srs[key] = { due: addDays(today, iv), iv, reps, lapses: (old?.lapses || 0) + (clean ? 0 : 1), first: old?.first || today, at: now };
  return doc.srs[key];
}

/**
 * Lines to drill today: lines whose review is due, then new lines (lines added from your games
 * first, then the library in chapter order), at most NEW_PER_DAY new ones per day.
 */
export function dueLines(doc, lib, today = dayKey()) {
  const due = [];
  const fresh = [];
  const introducedToday = Object.entries(doc.srs).filter(([k, e]) => isLineKey(k) && e.first === today).length;
  for (const side of ['w', 'b']) {
    for (const { li, line } of lib.lines(side)) {
      if (line.w) continue;
      const key = lineKey(side, line.san);
      const e = doc.srs[key];
      if (e) { if (e.due <= today) due.push({ side, li, line, key, due: e.due, isNew: false }); }
      else fresh.push({ side, li, line, key, isNew: true, custom: !!line.custom });
    }
  }
  due.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  fresh.sort((a, b) => (b.custom - a.custom) || ((b.line.date || 0) - (a.line.date || 0)));
  return [...due, ...fresh.slice(0, Math.max(0, NEW_PER_DAY - introducedToday))];
}

/** Lines learned: in spaced repetition with at least one clean drill. */
export const learnedCount = (doc) => Object.entries(doc.srs).filter(([k, e]) => isLineKey(k) && e.reps > 0).length;
export const puzzleKey = (id) => `pz|${id}`;

export function mergeProgress(a, b) {
  const out = emptyProgress();
  out.goal = b?.goal || a?.goal || 3;
  const g = (b?.goalsAt || 0) >= (a?.goalsAt || 0) ? b : a;
  out.goals = g?.goals || a?.goals || [];
  out.goalsAt = Math.max(a?.goalsAt || 0, b?.goalsAt || 0);
  for (const src of [a, b]) {
    for (const [k, d] of Object.entries(src?.days || {})) {
      const o = (out.days[k] ||= {});
      for (const kind of KINDS) o[kind] = Math.max(o[kind] || 0, d[kind] || 0);
      if (d.seen) o.seen = [...new Set([...(o.seen || []), ...d.seen])];
    }
    for (const [k, e] of Object.entries(src?.srs || {})) {
      if (!out.srs[k] || (e.at || 0) >= (out.srs[k].at || 0)) out.srs[k] = e;
    }
  }
  return out;
}
