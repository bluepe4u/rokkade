// Game filters (time control, colour, period, rated) shared by Games, Review and Insights.
import { $ } from './ui.js';
import { ls } from './store.js';

export function filtersHTML(S, games) {
  const f = S.f;
  const tcs = ['all', ...new Set(games.map((x) => x.tc))];
  const sel = (id, opts, v) => `<select class="select" id="${id}">${opts.map(([a, b]) => `<option value="${a}" ${a === v ? 'selected' : ''}>${b}</option>`).join('')}</select>`;
  return `<div class="filters">${sel('fTc', tcs.map((t) => [t, t === 'all' ? 'All time controls' : t[0].toUpperCase() + t.slice(1)]), f.tc)}${sel('fCol', [['all', 'Both colours'], ['w', 'White'], ['b', 'Black']], f.col)}${sel('fPer', [['all', 'All time'], ['24', '2 years'], ['12', '12 months'], ['3', '3 months']], f.per)}${sel('fRat', [['all', 'Rated and casual'], ['r', 'Rated only']], f.rated)}</div>`;
}

export function bindFilters(S, root, redraw) {
  [['fTc', 'tc'], ['fCol', 'col'], ['fPer', 'per'], ['fRat', 'rated']].forEach(([id, k]) => {
    const e = $(`#${id}`, root);
    if (e) e.onchange = () => { S.f[k] = e.value; ls.set('coach-f', S.f); redraw(); };
  });
}
