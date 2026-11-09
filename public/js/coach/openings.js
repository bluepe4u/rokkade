// Opening names (ECO code + name) for positions, from Lichess's public-domain chess-openings data
// (public/models/openings.json, built by tools/build_openings.mjs). A line is named after the
// deepest named position it passes through, so transpositions are named correctly too.
import { Chess } from '../../vendor/chess.js';

let NAMES = null;
let loading = null;

/** Load the table once (about 450 KB). Resolves to true when names are available. */
export function loadOpenings(url = new URL('../../models/openings.json', import.meta.url)) {
  if (NAMES) return Promise.resolve(true);
  loading ||= fetch(url, { cache: 'force-cache' }).then((r) => (r.ok ? r.json() : null)).then((j) => { NAMES = j?.names || {}; return true; }).catch(() => { NAMES = {}; return false; });
  return loading;
}
/** For tests and tools: install a table directly. */
export function setOpenings(names) { NAMES = names; }
export const openingsReady = () => !!NAMES;

const key3 = (fen) => fen.split(' ').slice(0, 3).join(' ');

/** Name at one position key ("board side castling"), or null. */
export function nameAtKey(key) {
  const v = NAMES?.[key];
  return v ? split(v[0], v[1]) : null;
}

/** "Sicilian Defense: Smith-Morra Gambit, Accepted" → {eco, name, family, variation} */
export function split(eco, name) {
  const i = name.indexOf(':');
  return { eco, name, family: i < 0 ? name : name.slice(0, i), variation: i < 0 ? '' : name.slice(i + 1).trim() };
}

/**
 * The opening of a move list: the deepest named position along it (up to `max` plies), with the
 * ply it was reached at. → {eco, name, family, variation, ply} or null.
 */
export function openingOf(sans, max = 40) {
  if (!NAMES) return null;
  const c = new Chess();
  let best = null;
  for (let i = 0; i < Math.min(sans.length, max); i++) {
    try { c.move(sans[i]); } catch { break; }
    const v = NAMES[key3(c.fen())];
    if (v) best = { ...split(v[0], v[1]), ply: i + 1 };
  }
  return best;
}

/** Same, for a path of library node keys (already "board side castling"). */
export function openingOfKeys(keys) {
  if (!NAMES) return null;
  let best = null;
  keys.forEach((k, i) => { const v = NAMES[k]; if (v) best = { ...split(v[0], v[1]), ply: i }; });
  return best;
}
