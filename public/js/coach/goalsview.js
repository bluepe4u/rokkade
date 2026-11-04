// Today: goals (with projections) and the weekly summary.
import { $, $$, esc } from './ui.js';
import { GOAL_TYPES, goalProgress, weekSummary } from './goals.js';
import { dayKey, addDays } from './progress.js';
import { pct, plural } from './games.js';

const fmtDate = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
const fmtVal = (type, v) => (v == null ? '–' : type === 'accuracy' ? v.toFixed(1) : String(Math.round(v)));

function ctx(C) { return { games: C.games, idx: C.reviewIdx, accOf: (x) => C.accOf(x.id, x.col), prog: C.prog }; }

function goalCard(C, g, i) {
  const r = goalProgress(g, ctx(C));
  const t = GOAL_TYPES[g.type];
  let proj;
  if (r.done) proj = '<span class="gl-ok">Reached. Set the next one.</span>';
  else if (r.eta) proj = `At your current pace: <b>${fmtDate(r.eta)}</b>${r.by ? (r.onTrack ? ' · <span class="gl-ok">on track</span>' : ' · <span class="gl-bad">behind</span>') : ''}`;
  else if (r.perDay != null && r.perDay !== 0) proj = '<span class="gl-bad">Moving the wrong way lately.</span>';
  else proj = 'Not enough recent data for a projection yet.';
  return `<div class="gl rise"><div class="gl-head"><b>${esc(t.label)}${g.type === 'rating' ? ` · ${esc(g.tc)}` : ''}</b><button class="gl-x" data-del="${i}" title="Remove goal" aria-label="Remove goal">✕</button></div>
    <div class="gl-nums"><span class="gl-cur">${fmtVal(g.type, r.current)}${t.unit}</span><span class="note">→ ${fmtVal(g.type, g.target)}${t.unit}${r.by ? ` by ${fmtDate(r.by)}` : ''}</span></div>
    <div class="gl-bar"><i style="--w:${Math.round(r.pct * 100)}%"></i></div>
    <p class="note" style="margin:6px 0 0">${proj}</p></div>`;
}

export function goalsHTML(C) {
  const goals = C.prog.goals || [];
  const tcs = [...new Set(C.games.map((x) => x.tc))];
  return `<section class="panel-card rise goals"><div class="row"><h2 class="h3" style="margin:0">Your goals</h2><span class="spacer"></span><button class="btn sm" id="glAdd">+ Add a goal</button></div>
    ${goals.length ? `<div class="gl-list">${goals.map((g, i) => goalCard(C, g, i)).join('')}</div>` : '<p class="note">Set a target, for example a rating by a date, and Rokade projects when you will reach it at your current pace.</p>'}
    <form class="gl-form" id="glForm" hidden>
      <select class="select" id="glType">${Object.entries(GOAL_TYPES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
      <select class="select" id="glTc">${(tcs.length ? tcs : ['blitz']).map((t) => `<option>${esc(t)}</option>`).join('')}</select>
      <input class="input" id="glTarget" type="number" placeholder="Target" required style="width:110px;border-radius:999px">
      <input class="input" id="glBy" type="date" value="${addDays(dayKey(), 90)}" style="width:auto;border-radius:999px">
      <button class="btn cta sm" type="submit">Save goal</button>
    </form></section>`;
}

export function bindGoals(root, C) {
  const add = $('#glAdd', root);
  const form = $('#glForm', root);
  if (!add) return;
  const typeSel = $('#glType', root);
  const tcSel = $('#glTc', root);
  const sync = () => { tcSel.hidden = typeSel.value !== 'rating'; };
  typeSel.onchange = sync;
  sync();
  add.onclick = () => { form.hidden = !form.hidden; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const g = { id: Date.now().toString(36), type: typeSel.value, tc: typeSel.value === 'rating' ? tcSel.value : null, target: +$('#glTarget', root).value, by: $('#glBy', root).value || null };
    if (!g.target) return;
    const now = goalProgress({ ...g, start: null }, ctx(C)).current;
    g.start = { v: now ?? 0, day: dayKey() };
    await C.setGoals([...(C.prog.goals || []), g]);
  };
  $$('[data-del]', root).forEach((b) => { b.onclick = async () => { const goals = (C.prog.goals || []).slice(); goals.splice(+b.dataset.del, 1); await C.setGoals(goals); }; });
  requestAnimationFrame(() => $$('.gl-bar i', root).forEach((i) => i.classList.add('in')));
}

export function weekHTML(C) {
  const w = weekSummary(ctx(C));
  const n = w.now;
  const p = w.prev;
  const delta = (a, b, f = (v) => v) => (a == null || b == null ? '' : `<small class="${a >= b ? 'up' : 'down'}">${a >= b ? '▲' : '▼'} ${f(Math.abs(a - b))}</small>`);
  const act = (o) => o.drill + o.puzzle + o.study + o.review + o.train + o.insight;
  const row = (label, a, b, f = (v) => v, d = true) => `<div class="wk-row"><span>${label}</span><b>${a == null ? '–' : f(a)}</b>${d ? delta(a, b, f) : ''}<span class="note">${b == null ? '–' : f(b)}</span></div>`;
  return `<section class="panel-card rise week"><div class="row"><h2 class="h3" style="margin:0">This week</h2><span class="spacer"></span><span class="note">vs last week</span></div>
    <div class="wkg">
      ${row('Days practised', n.active, p.active)}
      ${row('Exercises done', act(n.practice), act(p.practice))}
      ${row('Games played', n.games, p.games)}
      ${row('Score', n.games ? n.score.sc : null, p.games ? p.score.sc : null, (v) => pct(v))}
      ${row('Accuracy', n.accuracy, p.accuracy, (v) => v.toFixed(1))}
      ${row('Lines learned', n.learned, p.learned)}
      ${n.ratingChange ? `<div class="wk-row"><span>Rating (${esc(n.ratingChange.tc)})</span><b>${n.ratingChange.to}</b><small class="${n.ratingChange.delta >= 0 ? 'up' : 'down'}">${n.ratingChange.delta >= 0 ? '▲' : '▼'} ${Math.abs(n.ratingChange.delta)}</small><span class="note">from ${n.ratingChange.from}</span></div>` : ''}
    </div>
    ${n.best ? `<a class="wk-best" href="#review/${encodeURIComponent(n.best.id)}">Best game this week: beat ${esc(n.best.opp)} with ${C.accOf(n.best.id, n.best.col)}% accuracy →</a>` : ''}
    <p class="note" style="margin:8px 0 0">${n.practice.puzzle ? `${plural(n.practice.puzzle, 'puzzle')} · ` : ''}${n.practice.drill ? `${plural(n.practice.drill, 'drill')} · ` : ''}${n.practice.train ? `${plural(n.practice.train, 'training exercise')} · ` : ''}${n.practice.study ? `${plural(n.practice.study, 'position')} studied` : ''}</p></section>`;
}
