import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setOpenings, openingOf, nameAtKey, split } from '../public/js/coach/openings.js';

setOpenings(JSON.parse(fs.readFileSync(new URL('../public/models/openings.json', import.meta.url))).names);

test('lines are named after the deepest named position', () => {
  const o = openingOf('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7'.split(' '));
  assert.equal(o.eco, 'C57');
  assert.equal(o.family, 'Italian Game');
  assert.match(o.variation, /Fried Liver Attack/);
  assert.equal(openingOf('e4 c5'.split(' ')).name, 'Sicilian Defense');
  assert.equal(openingOf(['e4', 'c5', 'd4', 'cxd4', 'c3']).name, 'Sicilian Defense: Smith-Morra Gambit');
  assert.equal(openingOf([]), null);
});

test('transpositions get the same name; names split into family and variation', () => {
  const a = openingOf('d4 Nf6 c4 e6 Nc3 Bb4'.split(' '));
  const b = openingOf('c4 e6 Nc3 Nf6 d4 Bb4'.split(' '));
  assert.equal(a.name, b.name);
  assert.match(a.name, /Nimzo-Indian/);
  assert.deepEqual(split('B20', 'Sicilian Defense'), { eco: 'B20', name: 'Sicilian Defense', family: 'Sicilian Defense', variation: '' });
  assert.equal(nameAtKey('nonsense'), null);
});
