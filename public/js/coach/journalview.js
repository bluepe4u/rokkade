// Journal screen (Analyse → Journal), the journal card (also used from Review), and the plan card
// (Plan and Today). The card asks one question, with the engine's finding and the suggested tags
// already filled in, so a journal entry is "read, correct, save".
import { $, $$, esc, miniBoard, stagger, countUp, toast, since } from './ui.js';
import { TAGS, MOODS, tagLabel, autoTags, criticalMoment, lossStreak, ratingBefore, journalInbox, isJournaled, tagStats, afterResult } from './journal.js';
import { METRICS, TEMPLATES, TASK_LABEL, newPlan, activePlan, evaluatePlan, verdictText, fmtMetric, suggestMetric, metricValues } from './plans.js';
import { parseTC, clockData } from './clock.js';
import { Chess } from '../../vendor/chess.js';
import { dayKey } from './progress.js';
import { pct, plural } from './games.js';

export function journalCtx(C) {
  return { games: C.games, an: C.an, idx: C.reviewIdx, prog: C.prog, accOf: (x) => C.accOf(x.id, x.col), accFromLosses: (l, col) => C.accFromLosses(l, col) };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const tcText = (x) => { const t = parseTC(x.g?.time_control); return t ? `${Math.round(t.base / 60) || `${t.base}s`}+${t.inc}` : ''; };
const ordinal = (n) => (n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

function arrowsFor(fen, played, best) {
  const out = [];
  try { const m = new Chess(fen).move(played); out.push({ from: m.from, to: m.to, color: '#c0563b' }); } catch { /* not legal here */ }
  try { if (best && best !== played) { const m = new Chess(fen).move(best); out.push({ from: m.from, to: m.to, color: '#3f7a52' }); } } catch { /* ignore */ }
  return out;
}

// ───────────────────────── the journal card ─────────────────────────
export function journalCardHTML(C, x) {
  const ctx = journalCtx(C);
  const en = C.journal.e[x.id];
  const has = isJournaled(en) && !en.skip;
  const sugg = autoTags(x, ctx);
  const chosen = new Set(has ? en.tags || [] : sugg.map((t) => t.tag));
  const custom = has ? (en.tags || []).filter((t) => !TAGS[t]) : [];
  const crit = criticalMoment(C.an[x.id]);
  const before = ratingBefore(C.games, x);
  const streakN = lossStreak(C.games, x);
  const d = clockData(x);
  const atCrit = crit ? d.find((m) => m.ply === crit.ply) : null;
  const res = x.sc === 1 ? 'win' : x.sc === 0.5 ? 'draw' : 'loss';
  const why = Object.fromEntries(sugg.map((t) => [t.tag, t.why]));
  const ctxLine = [
    atCrit ? `<span>⏱ ${Math.round(atCrit.left)} s left at the critical move</span>` : '',
    streakN >= 2 ? `<span>↘ ${ordinal(streakN)} loss in a row</span>` : '',
  ].filter(Boolean).join('<span class="dot-sep">·</span>');
  return `<section class="jcard rise" data-jid="${esc(x.id)}">
    <header class="jc-head">
      <span class="jc-av ${res}">${res === 'win' ? 'W' : res === 'draw' ? 'D' : 'L'}</span>
      <div><b>vs. ${esc(x.opp)}</b><small>${esc(cap(x.tc))} ${esc(tcText(x))} · ${esc(x.src || 'chess.com')}${before ? ` · ${before} → ${x.myR}` : x.myR ? ` · ${x.myR}` : ''} · ${since(x.t)}</small></div>
      <a class="btn ghost sm" href="#review/${encodeURIComponent(x.id)}" title="Open the full review">Review →</a>
    </header>
    ${crit ? `<div class="jc-moment">
      <div class="jc-mini">${miniBoard(crit.fen, x.col, { arrows: arrowsFor(crit.fen, crit.san, crit.best) })}</div>
      <div><span class="eyebrow">Critical moment · move ${crit.mv}</span>
      <p>${crit.kind === 'missed' ? `After ${esc(crit.opp)} you played <b class="mono">${esc(crit.san)}</b> and let it go. <b class="mono">${esc(crit.best)}</b> won ${crit.drop} points of win chance.` : `You played <b class="mono">${esc(crit.san)}</b> and lost ${crit.drop} points of win chance.${crit.best ? ` <b class="mono">${esc(crit.best)}</b> was better.` : ''}`}</p>
      <span class="legend"><span><i style="background:#c0563b"></i>Played</span>${crit.best ? '<span><i style="background:#3f7a52"></i>Better</span>' : ''}</span></div>
    </div>` : `<div class="jc-moment empty"><span class="note">${C.an[x.id] ? 'No big mistakes in this game. What went well?' : 'The engine review of this game is still running. You can journal it now anyway.'}</span></div>`}
    <label class="jc-q" for="jn-${esc(x.id)}">What were you thinking?</label>
    <textarea class="input jc-note" id="jn-${esc(x.id)}" rows="2" placeholder="${crit ? 'e.g. I had 40 seconds, grabbed the pawn without checking their knight' : 'One line is enough'}">${esc(has ? en.note || '' : '')}</textarea>
    <div class="jc-tags" role="group" aria-label="Tags">
      ${Object.entries(TAGS).map(([k, t]) => `<button type="button" class="tchip${chosen.has(k) ? ' on' : ''}${why[k] ? ' auto' : ''}" data-tag="${k}" aria-pressed="${chosen.has(k)}" ${why[k] ? `title="Suggested: ${esc(why[k])}"` : ''}>${esc(t.label)}</button>`).join('')}
      ${custom.map((t) => `<button type="button" class="tchip on" data-tag="${esc(t)}" aria-pressed="true">${esc(t)}</button>`).join('')}
      <span class="tchip add"><input class="jc-new" placeholder="+ tag" maxlength="24" aria-label="Add your own tag"></span>
    </div>
    ${sugg.length ? `<p class="jc-why">${sugg.map((t) => `<span><b>${esc(tagLabel(t.tag))}:</b> ${esc(t.why)}</span>`).join('')}</p>` : ''}
    <div class="jc-mood" role="group" aria-label="Mood"><span class="note">Mood</span>${Object.entries(MOODS).map(([k, v]) => `<button type="button" class="mchip${has && en.mood === k ? ' on' : ''}" data-mood="${k}" aria-pressed="${has && en.mood === k}">${v}</button>`).join('')}</div>
    ${ctxLine ? `<p class="jc-ctx">${ctxLine}</p>` : ''}
    <div class="jc-actions"><button class="btn cta" data-save>${has ? 'Update' : 'Save'} <span class="arrow">→</span></button><button class="btn ghost" data-skip>${has ? 'Close' : 'Skip this game'}</button><span class="note jc-hint">Suggested tags are pre-selected: tap to correct them.</span></div>
  </section>`;
}

export function bindJournalCard(root, C, x, { onDone } = {}) {
  const card = $(`.jcard[data-jid="${CSS.escape(x.id)}"]`, root);
  if (!card) return;
  $$('.tchip[data-tag]', card).forEach((b) => { b.onclick = () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }; });
  $$('.mchip', card).forEach((b) => { b.onclick = () => { const on = !b.classList.contains('on'); $$('.mchip', card).forEach((o) => { o.classList.remove('on'); o.setAttribute('aria-pressed', 'false'); }); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }; });
  const inp = $('.jc-new', card);
  inp.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = inp.value.trim().toLowerCase();
    if (!v) return;
    const key = Object.entries(TAGS).find(([, t]) => t.label.toLowerCase() === v)?.[0] || v;
    let b = $(`.tchip[data-tag="${CSS.escape(key)}"]`, card);
    if (!b) {
      inp.parentElement.insertAdjacentHTML('beforebegin', `<button type="button" class="tchip on" data-tag="${esc(key)}" aria-pressed="true">${esc(v)}</button>`);
      b = inp.parentElement.previousElementSibling;
      b.onclick = () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); };
    } else { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); }
    inp.value = '';
  };
  const finish = (msg) => {
    card.classList.add('leaving');
    if (msg) toast(msg);
    setTimeout(() => onDone?.(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
  };
  $('[data-save]', card).onclick = async () => {
    const tags = $$('.tchip.on[data-tag]', card).map((b) => b.dataset.tag);
    const mood = $('.mchip.on', card)?.dataset.mood || null;
    const note = $('.jc-note', card).value.trim();
    await C.saveJournal(x.id, { note, tags, mood });
    finish('Saved to your journal');
  };
  $('[data-skip]', card).onclick = async () => {
    if (!isJournaled(C.journal.e[x.id])) await C.saveJournal(x.id, { skip: true });
    finish();
  };
}

// ───────────────────────── the plan card ─────────────────────────
const TASK_HREF = { puzzle: '#puzzles', drill: '#library/due', study: '#discoveries', train: '#training', journal: '#journal', review: '#review' };

function planSuggestions(C) {
  const ctx = journalCtx(C);
  const tags = tagStats(C.games, C.journal, ctx);
  const after = afterResult(C.games);
  const tr = metricValues('trouble', C.games.slice(-40), ctx);
  const clockShare = tr.length >= 10 ? tr.reduce((s, p) => s + p.v, 0) / tr.length : null;
  return suggestMetric({ tags, after, clockShare }).slice(0, 3);
}

export function planCardHTML(C, { compact = false } = {}) {
  const plan = activePlan(C.prog);
  if (!plan) {
    if (!C.games.length) return '';
    const sug = planSuggestions(C);
    return `<section class="panel-card rise plan-card none"><div class="row"><div><span class="eyebrow">Your plan</span><h2 class="h3" style="margin:2px 0 0">Pick one thing to fix for 4 weeks</h2></div></div>
      <p class="note">One focus, one number to move, a few minutes of practice a day. Rokade compares your games after you start with the games before, and only calls it a change when it is bigger than the noise.</p>
      <div class="plan-sugg">${sug.map((s, i) => `<button class="plan-opt${i === 0 ? ' top' : ''}" data-start="${s.metric}"><b>${esc(TEMPLATES[s.metric].title)}</b><small>${esc(s.why)}</small><span class="note">Measured by: ${esc(METRICS[s.metric].label.toLowerCase())}</span></button>`).join('')}</div></section>`;
  }
  const r = evaluatePlan(plan, journalCtx(C));
  const cls = { early: 'early', working: 'ok', worse: 'bad', flat: 'flat' }[r.verdict];
  const f = (v) => fmtMetric(plan.metric, v);
  return `<section class="panel-card rise plan-card ${cls}">
    <div class="row"><div><span class="eyebrow">Current plan · week ${r.week} of ${plan.weeks}${plan.tc ? ` · ${esc(plan.tc)}` : ''}</span><h2 class="h3" style="margin:2px 0 0">${esc(plan.title)}</h2></div><span class="spacer"></span>${compact ? '<a class="btn ghost sm" href="#plan">Details →</a>' : `<button class="btn ghost sm" data-end>${r.over ? 'Close plan' : 'End plan'}</button>`}</div>
    <p class="plan-rule">${esc(plan.rule)}</p>
    <div class="plan-bar" title="${r.days.done} of ${r.days.elapsed} days so far with every task done"><i style="--w:${Math.round((100 * r.days.elapsed) / r.days.total)}%"></i><i class="done" style="--w:${Math.round((100 * r.days.done) / r.days.total)}%"></i></div>
    <p class="note" style="margin:6px 0 10px">Day ${r.days.elapsed} of ${r.days.total} · ${r.days.done} ${r.days.done === 1 ? 'day' : 'days'} with every task done</p>
    <ul class="plan-tasks">${r.todayTasks.map((t) => `<li class="${t.ok ? 'ok' : ''}"><span class="ck" aria-hidden="true">${t.ok ? '✓' : ''}</span><a href="${TASK_HREF[t.kind] || '#today'}">${esc(TASK_LABEL[t.kind](t.n))}</a><span class="note">${t.kind === 'journal' ? (t.have ? 'done today' : '') : `${Math.min(t.have, t.n)}/${t.n} today`}</span></li>`).join('')}</ul>
    <div class="plan-metric">
      <div><span class="eyebrow">Before</span><b>${f(r.base.mean)}</b><small>${plural(r.base.n, 'game')}</small></div>
      <div class="arrow-sep">→</div>
      <div><span class="eyebrow">Since you started</span><b>${f(r.now.mean)}</b><small>${plural(r.now.n, 'game')}${r.need ? ` · ${r.need} more for a verdict` : ''}</small></div>
      <div class="pm-label"><span class="eyebrow">Measured</span><small>${esc(r.metric.label)}${r.metric.dir < 0 ? ' (lower is better)' : ''}</small></div>
    </div>
    <p class="plan-verdict">${esc(verdictText(plan, r))}</p>
  </section>`;
}

export function bindPlanCard(root, C) {
  $$('[data-start]', root).forEach((b) => {
    b.onclick = async () => {
      const metric = b.dataset.start;
      // A plan on the time control you play most, so the numbers compare like with like.
      const counts = new Map();
      for (const x of C.games.slice(-60)) counts.set(x.tc, (counts.get(x.tc) || 0) + 1);
      const tc = [...counts].sort((a, c) => c[1] - a[1])[0]?.[0] || null;
      await C.setPlans([...(C.prog.plans || []), newPlan(metric, { tc })]);
      toast(`Plan started: ${TEMPLATES[metric].title}`);
    };
  });
  const end = $('[data-end]', root);
  if (end) end.onclick = async () => {
    const plan = activePlan(C.prog);
    if (!plan) return;
    const r = evaluatePlan(plan, journalCtx(C));
    if (!r.over && !confirm('End this plan now? Its result is kept in your history.')) return;
    const plans = (C.prog.plans || []).map((p) => (p.id === plan.id ? { ...p, ended: { day: dayKey(), verdict: r.verdict, base: r.base.mean, now: r.now.mean, n: r.now.n, daysDone: r.days.done } } : p));
    await C.setPlans(plans);
  };
  requestAnimationFrame(() => $$('.plan-bar i', root).forEach((i) => i.classList.add('in')));
}

export function planHistoryHTML(C) {
  const past = (C.prog.plans || []).filter((p) => p.ended).reverse();
  if (!past.length) return '';
  const word = { working: 'Worked', worse: 'Got worse', flat: 'No clear change', early: 'Too few games to judge' };
  return `<section class="panel-card rise"><h2 class="h3" style="margin:0 0 8px">Past plans</h2><ul class="plan-past">${past.map((p) => `<li><b>${esc(p.title)}</b><span class="note">${esc(p.start)} → ${esc(p.ended.day)} · ${p.ended.daysDone} days on plan</span><span class="pv ${p.ended.verdict}">${word[p.ended.verdict]}</span><span class="note">${esc(METRICS[p.metric].short)} ${fmtMetric(p.metric, p.ended.base)} → ${fmtMetric(p.metric, p.ended.now)} (${plural(p.ended.n || 0, 'game')})</span></li>`).join('')}</ul></section>`;
}

// ───────────────────────── the Journal screen ─────────────────────────
const J = { tk: 0 };

export function renderJournal(view, C, arg = [], { quiet = false } = {}) {
  const tk = ++J.tk;
  if (!C.games.length) {
    view.innerHTML = `<section class="panel-card rise"><span class="eyebrow">Journal</span><h1 class="h1">Why did that happen?</h1><p class="lede">After each game, Rokade shows you the critical moment and asks one question. Your answers, joined with the engine's numbers, show where your games really go wrong.</p><a class="btn cta" href="#games">Import your games <span class="arrow">→</span></a></section>`;
    stagger(view);
    return;
  }
  const ctx = journalCtx(C);
  const inbox = journalInbox(C.games, C.journal);
  const target = arg[0] ? C.games.find((x) => x.id === arg[0]) : null;
  const focus = target || inbox[0] || null;
  const rest = inbox.filter((x) => x !== focus).slice(0, 8);
  const tags = tagStats(C.games, C.journal, ctx).filter((t) => t.losses > 0 || t.confirmed > 0).slice(0, 8);
  const after = afterResult(C.games.slice(-300));
  const entries = Object.entries(C.journal.e).filter(([, e]) => isJournaled(e) && !e.skip).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, 12);
  const byId = new Map(C.games.map((x) => [x.id, x]));
  const journaled = Object.values(C.journal.e).filter((e) => isJournaled(e) && !e.skip).length;
  const confirmedShare = journaled ? Math.round((100 * journaled) / Math.min(C.games.length, 200)) : 0;
  const tile = (label, b, cls = '') => `<div class="jt ${cls}"><span class="eyebrow">${label}</span><b>${b.n ? pct(b.score) : '–'}</b><small>${plural(b.n, 'game')}</small></div>`;
  view.innerHTML = `
    <section class="j-hero rise"><div><span class="eyebrow">Journal</span><h1 class="h1">${focus ? (inbox.length ? `${plural(inbox.length, 'game')} to journal` : 'Your journal') : 'All caught up'}</h1>
      <p class="lede">The engine shows <i>what</i> went wrong. Only you know <i>why</i>. Ten seconds per game: check the suggested tags, add a line, save.</p></div>
      <div class="j-count"><b data-count="${journaled}">${journaled}</b><span>${journaled === 1 ? 'game' : 'games'} journaled</span></div></section>
    <div class="j-grid">
      <div class="j-main">
        ${focus ? journalCardHTML(C, focus) : '<section class="panel-card rise"><b>Nothing waiting.</b> <span class="note">New games from the last 7 days appear here after each sync.</span></section>'}
        ${rest.length ? `<section class="panel-card rise"><h2 class="h3" style="margin:0 0 8px">Also waiting</h2><div class="j-queue">${rest.map((x) => `<a class="jq ${x.sc === 1 ? 'win' : x.sc === 0.5 ? 'draw' : 'loss'}" href="#journal/${encodeURIComponent(x.id)}"><i></i><span class="jq-t"><b>${esc(x.opp)}</b><span class="note">${esc(x.tc)} · ${since(x.t)}</span></span></a>`).join('')}</div></section>` : ''}
        ${entries.length ? `<section class="panel-card rise"><h2 class="h3" style="margin:0 0 8px">Recent entries</h2><ul class="j-entries">${entries.map(([id, e]) => { const x = byId.get(id); if (!x) return ''; return `<li><a href="#journal/${encodeURIComponent(id)}"><span class="jq ${x.sc === 1 ? 'win' : x.sc === 0.5 ? 'draw' : 'loss'}"><i></i></span><b>${esc(x.opp)}</b><span class="note">${since(x.t)}</span></a><span class="j-tags">${(e.tags || []).map((t) => `<span class="tchip sm on">${esc(tagLabel(t))}</span>`).join('')}${e.mood ? `<span class="tchip sm">${esc(MOODS[e.mood] || e.mood)}</span>` : ''}</span>${e.note ? `<p>${esc(e.note)}</p>` : ''}</li>`; }).join('')}</ul></section>` : ''}
      </div>
      <aside class="j-side">
        <section class="panel-card rise"><h2 class="h3" style="margin:0">Where your losses come from</h2>
          <p class="note" style="margin:4px 0 10px">Your own tags where you journaled, otherwise the ones Rokade detected. ${journaled ? `${confirmedShare}% of recent games confirmed by you.` : 'Journal a few games to confirm them.'}</p>
          ${tags.length ? tags.map((t) => `<div class="jtag"><div class="row"><b>${esc(tagLabel(t.tag))}</b><span class="spacer"></span><span class="mono">${Math.round(t.lossShare * 100)}%</span></div>
            <div class="jbar"><i data-w="${Math.round(t.lossShare * 100)}"></i></div>
            <small class="note">${t.losses} of ${t.totalLosses} ${t.totalLosses === 1 ? 'loss' : 'losses'}${t.confirmed ? ` · ${t.confirmed} confirmed` : ' · detected'}${t.score != null && t.scoreWithout != null && t.n >= 5 ? ` · you score ${pct(t.score)} with it, ${pct(t.scoreWithout)} without` : ''}${t.bpg != null && t.bpgWithout != null && t.n >= 5 ? ` · ${t.bpg.toFixed(1)} blunders a game vs ${t.bpgWithout.toFixed(1)}` : ''}</small></div>`).join('') : '<p class="note">Tags appear as your games are reviewed.</p>'}
        </section>
        <section class="panel-card rise"><h2 class="h3" style="margin:0">After a result</h2><p class="note" style="margin:4px 0 10px">Your score in the next game of the same sitting.</p>
          <div class="jtiles">${tile('First game', after.fresh)}${tile('After a win', after.afterWin)}${tile('After a loss', after.afterLoss, after.afterLoss.n >= 8 && after.fresh.n >= 8 && after.fresh.score - after.afterLoss.score > 0.08 ? 'warn' : '')}${tile('After 2 losses', after.afterTwoLosses, after.afterTwoLosses.n >= 5 && after.fresh.score - after.afterTwoLosses.score > 0.1 ? 'warn' : '')}</div>
          ${after.afterLoss.n >= 8 && after.fresh.n >= 8 && after.fresh.score - after.afterLoss.score > 0.08 ? `<p class="note" style="margin:10px 0 0">You score ${Math.round((after.fresh.score - after.afterLoss.score) * 100)} points less right after a loss. A short break after a loss is the cheapest rating you will ever gain.</p>` : ''}
        </section>
        ${planCardHTML(C, { compact: true })}
      </aside>
    </div>`;
  if (focus) bindJournalCard(view, C, focus, { onDone: () => { if (tk !== J.tk) return; if (arg[0]) history.replaceState(null, '', '#journal'); renderJournal(view, C, []); } });
  bindPlanCard(view, C);
  if (!quiet) { stagger(view, 50); countUp(view); }
  requestAnimationFrame(() => $$('.jbar i', view).forEach((i) => { i.style.width = `${i.dataset.w}%`; }));
}

/** True while the player is typing in a journal card (live refreshes should wait). */
export const journalBusy = () => {
  const a = document.activeElement;
  return !!(a && a.closest?.('.jcard') && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT'));
};
