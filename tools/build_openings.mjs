// Build public/models/openings.json, the opening names Rokade shows (Library, games), from
// Lichess's chess-openings data set (public domain / CC0: github.com/lichess-org/chess-openings).
// Each named position is keyed by "board side castling", the same key the library tree uses.
//
// Usage: node tools/build_openings.mjs DIR_WITH_a-e.tsv
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from '../public/vendor/chess.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = process.argv[2];
const out = {};
let n = 0;
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const rows = fs.readFileSync(path.join(dir, `${f}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const c = new Chess();
    try {
      for (const tok of pgn.split(/\s+/)) if (tok && !/^\d+\.+$/.test(tok)) c.move(tok);
    } catch { console.error('skip', eco, name); continue; }
    const key = c.fen().split(' ').slice(0, 3).join(' ');
    // Several names can share a position (transpositions): keep the one reached in fewer moves.
    const plies = c.history().length;
    if (!out[key] || out[key][2] > plies) out[key] = [eco, name, plies];
    n++;
  }
}
const compact = Object.fromEntries(Object.entries(out).map(([k, [eco, name]]) => [k, [eco, name]]));
fs.writeFileSync(path.join(ROOT, 'public/models/openings.json'), JSON.stringify({ source: 'lichess-org/chess-openings (CC0)', names: compact }));
console.log(`${n} rows, ${Object.keys(compact).length} positions`);
