// Analyse → Progress: how you are doing in the positions you work on, before and after the work.
import { $, $$, esc, miniBoard, countUp, stagger, when } from './ui.js';
import { positionAfter } from './library.js';
import { trackedPositions } from './positions.js';
import { pct, plural } from './games.js';

const ST = {
  improving: { t: 'Improving', c: 'var(--success)' },
  slipping: { t: 'Slipping', c: 'var(--destructive)' },
  steady: { t: 'Steady', c: 'var(--muted-foreground)' },
  early: { t: 'Too early to tell', c: 'var(--muted-foreground)' },
};

function rollSVG(roll, startIdx) {
  if (roll.length < 2) return '<span class="spark-empty"></span>';
  const w = 220, h = 54;
  const pts = roll.map((v, i) => [(i * w) / (roll.length - 1), 4 + (h - 8) * (1 - v)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const sx = startIdx > 0 && startIdx < roll.length ? (startIdx * w) / (roll.length - 1) : null;
  return `<svg class="pp-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" class="mid"/>${sx != null ? `<rect x="${sx}" y="0" width="${w - sx}" height="${h}" class="work"/><line x1="${sx}" x2="${sx}" y1="0" y2="${h}" class="start"/>` : ''}<path d="${d}" pathLength="1"/></svg>`;
}

export function trackedFor(C) {
  return trackedPositions({ games: C.games, discoveries: C.list(), lib: C.lib, prog: C.prog, puzzles: C.puzzles() });
}

export function renderProgress(view, C, { quiet = false } = {}) {
  const list = trackedFor(C);
  if (!list.length) {
    view.innerHTML = `<span class="eyebrow">Analyse</span><h1 class="h1">Progress in your positions</h1><p class="lede">Once positions come up in at least two of your games (an opponent's surprise from Discoveries, or a place where you leave your library), this page shows how they go: your score before and after you started working on them, the drills and puzzles you did, and which way it is heading.</p>`;
    return;
  }
  const worked = list.filter((p) => p.worked);
  const up = list.filter((p) => p.status === 'improving').length;
  const down = list.filter((p) => p.status === 'slipping').length;
  view.innerHTML = `<span class="eyebrow">Analyse</span><h1 class="h1">Progress in your positions</h1>
    <p class="lede">The positions you meet most, and the ones you are working on. Each shows your score before and after you started (studying, drilling, puzzles), with a rolling 5-game score; the shaded part is since you started.</p>
    <div class="rv-summary rise"><div><b data-count="${worked.length}">${worked.length}</b><span>positions you are working on</span></div><div><b data-count="${up}" style="color:var(--success)">${up}</b><span>improving</span></div><div><b data-count="${down}" style="color:var(--destructive)">${down}</b><span>slipping</span></div></div>
    <div class="pp-list">${list.map((p) => {
      const pos = positionAfter(p.pre);
      const st = ST[p.status];
      const startIdx = p.startT ? p.games.slice().sort((a, b) => a.t - b.t).filter((g) => g.sc != null).findIndex((g) => g.t >= p.startT) : -1;
      return `<a class="pp rise" href="${p.href}">
        ${miniBoard(pos.fen, p.side, { last: pos.move ? [pos.move.from, pos.move.to] : [] })}
        <span class="pp-body">
          <span class="eyebrow">${p.kind === 'surprise' ? 'Opponent surprise' : 'Your habit'}${p.title ? ` · ${esc(p.title)}` : ''}</span>
          <b>${esc(p.kind === 'surprise' ? `They play ${p.label}` : p.title)}</b>
          <small class="mono">${esc(p.line)}</small>
          <span class="pp-work">${p.studied ? '<span class="wk">✓ Studied</span>' : ''}${p.work.drills ? `<span class="wk">${plural(p.work.drills, 'drill')}</span>` : ''}${p.work.puzzles ? `<span class="wk">${plural(p.work.puzzles, 'puzzle')}</span>` : ''}${!p.worked ? '<span class="wk none">Not worked on yet</span>' : ''}${p.days != null ? `<span class="note">since ${when(p.startT)}</span>` : ''}</span>
        </span>
        <span class="pp-score">
          <span class="pp-ba"><span><small>${p.startT ? 'before' : 'earlier'}</small><b>${p.before.n ? pct(p.before.sc) : '–'}</b><small>${p.before.n} g</small></span><span class="arrow-r">→</span><span><small>${p.startT ? 'since' : 'recent'}</small><b>${p.after.n ? pct(p.after.sc) : '–'}</b><small>${p.after.n} g</small></span></span>
          ${rollSVG(p.roll, startIdx)}
          <span class="pp-st" style="--c:${st.c}">${p.delta != null && p.before.n >= 2 && p.after.n >= 2 ? `${p.delta >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(p.delta * 100))} pts · ` : ''}${st.t}</span>
        </span>
      </a>`;
    }).join('')}</div>`;
  if (!quiet) { stagger(view, 40); countUp(view); }
  void $; void $$;
}
