// Outpost (coach.html): section router, account bar, Discoveries inbox, Games and Plan.
import { coach } from './service.js';
import { setActive, GROUP_OF } from '../shell.js';
import { renderToday } from './today.js';
import { renderPuzzles, puzzleSessionActive } from './puzzleview.js';
import { renderProgress } from './progressview.js';
import { renderTraining } from './trainingview.js';
import { renderTime } from './timeview.js';
import { renderPrep } from './prepview.js';
import { renderJournal, journalBusy, planCardHTML, bindPlanCard, planHistoryHTML } from './journalview.js';
import { journalInbox } from './journal.js';
import { puzzleQueue } from './puzzles.js';
import { $, $$, esc, miniBoard, countUp, ring, toast, since, when, stagger } from './ui.js';
import { fenOf } from './discoveries.js';
import { moveLabel, sanLine, positionAfter } from './library.js';
import { filterGames, agg, fit, recommendations, groupBy, pct, signed, plural } from './games.js';
import { insightStats } from './analysis.js';
import { ls, store } from './store.js';
import { renderLibrary } from './trainer.js';
import { renderReview, renderInsights, interactiveQueue } from './review.js';
import { openStory } from './story.js';
import { buildGuide } from './guide.js';
import { filtersHTML as fHTML, bindFilters as fBind } from './filters.js';
const filtersHTML = () => fHTML(S, C.games);
const bindFilters = (root, redraw) => fBind(S, root, redraw);

const C = coach();
const view = $('#view');
const SECTIONS = ['today', 'discoveries', 'library', 'puzzles', 'training', 'games', 'review', 'journal', 'insights', 'time', 'progress', 'prepare', 'plan', 'guide'];
export const S = {
  f: { tc: 'all', col: 'all', per: 'all', rated: 'all', ...ls.get('coach-f', {}) },
  disc: { side: 'all', show: 'todo', ...ls.get('sfet.coach.discFilter', {}) },
  get an() { return C.an; },
  syncing: false,
  syncMsg: '',
  syncErr: '',
};
export const coachState = S;

// ───────────────────────── chrome ─────────────────────────
function moveInk() {
  const cur = $('#subnav a[aria-current="page"]');
  const ink = $('.subnav-ink');
  if (!cur || !ink) return;
  ink.style.width = `${cur.offsetWidth}px`;
  ink.style.transform = `translateX(${cur.offsetLeft}px)`;
}
addEventListener('resize', moveInk);
// Tabs change width when a badge appears or fonts load: keep the highlight on the current tab.
if ('ResizeObserver' in window) {
  const ro = new ResizeObserver(() => moveInk());
  $$('#subnav a').forEach((a) => ro.observe(a));
}
document.fonts?.ready.then(() => moveInk());

const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
function renderAccount() {
  const el = $('#account');
  if (!C.user) { el.innerHTML = `<a class="btn sm" href="#games">Connect chess.com</a>`; return; }
  const last = Number(ls.get('sfet.lastSync', 0));
  el.innerHTML = `<span class="who"><i>${esc(C.user[0].toUpperCase())}</i>${esc(C.user)}</span>
    <button class="btn sm" id="accSync" ${S.syncing ? 'disabled' : ''} title="${C.autoSyncMinutes() ? `Updates automatically every ${C.autoSyncMinutes() >= 60 ? `${C.autoSyncMinutes() / 60} h` : `${C.autoSyncMinutes()} min`}` : 'Automatic updates are off'}">${S.syncing ? '<span class="ring spin sm"></span>Syncing…' : `↻ ${last ? ago(last) : 'Sync'}`}</button>`;
  $('#accSync').onclick = () => sync(C.user);
}
setInterval(() => { if (!S.syncing) renderAccount(); }, 60000);

function paintDue() {
  const b = $('#dueBadge');
  if (!b) return;
  const n = C.due().length;
  b.textContent = n ? String(n) : '';
  b.hidden = !n;
  const pb = $('#pzBadge');
  if (pb) { const m = puzzleQueue(C.puzzles(), C.prog).length; pb.textContent = m ? String(m) : ''; pb.hidden = !m; }
  const jb = $('#jBadge');
  if (jb) { const m = journalInbox(C.games, C.journal, { days: 3 }).length; jb.textContent = m ? String(m) : ''; jb.hidden = !m; }
}

function renderBg() {
  paintDue();
  const el = $('#bgStatus');
  const p = C.progress;
  if (p && p.kind === 'review') {
    const rp = C.reviewProgress();
    el.innerHTML = `<span class="bg-pill">${ring(p.i / p.n)}<span>${p.deep ? `Deeper review · ${rp.deep + 1} of ${rp.total}` : `Reviewing games · ${rp.done + 1} of ${rp.total}`}</span></span>`;
    el.querySelector('.ring').classList.add('spin');
  } else if (p && p.stage !== 'done') {
    const it = C.get(p.id);
    const label = it ? it.label : '';
    const d = p.stage === 'main' ? `depth ${p.depth || 0}/${C.depth.main}` : p.stage === 'reply' ? `your ${p.san}` : `engine line`;
    el.innerHTML = `<span class="bg-pill">${ring(p.stage === 'main' ? (p.depth || 0) / C.depth.main : p.stage === 'reply' ? 0.85 : 0.95)}<span>Analysing ${esc(label)} · ${esc(d)}</span></span>`;
    el.querySelector('.ring').classList.add('spin');
  } else {
    const waiting = C.list().filter((s) => s.status === 'new').length;
    const rp = C.reviewProgress();
    el.innerHTML = waiting ? `<span class="engine-dot"></span><span>${plural(waiting, 'position')} queued</span>`
      : rp.total && rp.done < rp.total ? `<span class="engine-dot"></span><span>${rp.done} of ${rp.total} games reviewed</span>`
        : `<span class="engine-dot" data-state="ok"></span><span>Everything analysed</span>`;
  }
}

// ───────────────────────── routing ─────────────────────────
function parseHash() {
  const [sec, ...rest] = location.hash.slice(1).split('/');
  return { sec: SECTIONS.includes(sec) ? sec : null, arg: rest.map(decodeURIComponent) };
}

let lastSec = null;
export async function route() {
  let { sec, arg } = parseHash();
  if (sec === 'guide') { sec = 'plan'; history.replaceState(null, '', '#plan'); }
  if (!sec) { sec = 'today'; history.replaceState(null, '', '#today'); }
  const group = GROUP_OF[sec];
  setActive(group);
  const sub = $('#subnav');
  const hasSub = group === 'study' || group === 'analyse';
  sub.hidden = !hasSub;
  $$('#subnav a').forEach((a) => {
    a.hidden = a.dataset.group !== group;
    if (a.dataset.sec === sec) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${{ today: 'Today', discoveries: 'Discoveries', library: 'Library', puzzles: 'Puzzles', training: 'Training', time: 'Time', prepare: 'Prepare', progress: 'Progress', games: 'Games', review: 'Review', journal: 'Journal', insights: 'Insights', plan: 'Plan' }[sec]} · Outpost`;
  requestAnimationFrame(moveInk);
  if (sec === 'discoveries' && arg[0]) {
    if (lastSec !== 'discoveries') draw('discoveries', []);
    openStory(C, arg[0], { onClose: () => { history.replaceState(null, '', '#discoveries'); draw('discoveries', []); } });
    lastSec = sec;
    return;
  }
  draw(sec, arg);
  lastSec = sec;
}

function draw(sec, arg) {
  view.classList.remove('view-enter', 'quiet');
  void view.offsetWidth;
  view.classList.add('view-enter');
  if (sec === 'today') renderToday(view, C, S);
  else if (sec === 'discoveries') renderDiscoveries();
  else if (sec === 'library') renderLibrary(view, C, arg);
  else if (sec === 'puzzles') renderPuzzles(view, C, arg);
  else if (sec === 'progress') renderProgress(view, C);
  else if (sec === 'training') renderTraining(view, C, arg);
  else if (sec === 'time') renderTime(view, C);
  else if (sec === 'prepare') renderPrep(view, C, arg);
  else if (sec === 'games') renderGames();
  else if (sec === 'review') renderReview(view, C, S, arg);
  else if (sec === 'journal') renderJournal(view, C, arg);
  else if (sec === 'insights') renderInsights(view, C, S);
  else renderGuide();
  window.scrollTo({ top: 0 });
}
addEventListener('hashchange', route);
const current = () => parseHash().sec;

// ───────────────────────── sync ─────────────────────────
async function sync(user) {
  user = String(user || '').trim();
  if (!user) return;
  S.syncing = true;
  S.syncErr = '';
  S.syncMsg = 'Checking chess.com…';
  renderAccount();
  if (current() === 'games') renderGames();
  try {
    const r = await C.sync(user, (i, n) => {
      S.syncMsg = `Downloaded ${i} of ${n} months`;
      const b = $('#syncBar');
      if (b) b.style.width = `${(100 * i) / n}%`;
      const t = $('#syncMsg');
      if (t) t.textContent = S.syncMsg;
    });
    S.syncMsg = r.games ? `${r.games} games loaded.${r.discoveries ? ` ${plural(r.discoveries, 'new position')} caught for Discoveries.` : ''}` : 'No standard chess games found for this name.';
    if (r.discoveries) toast(`${plural(r.discoveries, 'new position')} caught from your games`);
  } catch (e) {
    S.syncErr = e.message;
    S.syncMsg = '';
  }
  S.syncing = false;
  renderAccount();
  const sec = current();
  if (sec === 'games' || sec === 'discoveries') draw(sec, []);
}

// ───────────────────────── Discoveries ─────────────────────────
function discCard(s) {
  const fen = fenOf(s);
  const pos = positionAfter([...s.path, s.move]);
  const lib = C.lib.describe(s.side, C.lib.nodeAfter(s.side, s.path));
  const eyebrow = s.opening || lib.chapter || (s.side === 'w' ? 'Your White openings' : 'Your Black openings');
  const a = s.a;
  const p = C.progress && C.progress.id === s.id ? C.progress : null;
  let foot;
  if (s.status === 'studied') foot = `<span class="state studied">✓ Studied · ${esc(s.studied.move)}</span>`;
  else if (s.status === 'dismissed') foot = `<span class="state studied">Dismissed</span>`;
  else if (s.status === 'ready') {
    const u = s.usual?.eval;
    foot = `<span class="state ready"><span class="dot"></span>Ready</span>${u ? `<span class="spacer"></span><span class="chipcl" style="background:var(--cl-${u.cls})">${u.cls === 'best' ? 'You found the best' : `Usually ${esc(s.usual.san)}`}</span>` : ''}`;
  } else {
    const prog = p ? (p.stage === 'main' ? (p.depth || 0) / C.depth.main : 0.9) : 0;
    foot = `<span class="state new" data-prog="${s.id}">${ring(prog)}${p ? `Analysing${p.stage === 'main' ? ` · depth ${p.depth || 0}` : '…'}` : 'Waiting for the engine'}</span>`;
  }
  return `<button class="disc rise ${s.status}" data-id="${s.id}" aria-label="${esc(`${s.label}, ${s.n} games`)}">
    <span class="side-tag ${s.side}" title="${s.side === 'w' ? 'You play White' : 'You play Black'}"></span>
    ${miniBoard(fen, s.side, { last: pos.move ? [pos.move.from, pos.move.to] : [] })}
    <span class="disc-body">
      <span class="eyebrow">${esc(eyebrow)}</span>
      <span class="disc-move">They played ${esc(s.label)}</span>
      <span class="disc-line">${esc(sanLine([...s.path, s.move]) || '')}</span>
      <span class="disc-meta"><b>${plural(s.n, 'game')}</b>${a.n ? ` · you scored <b>${pct(a.sc)}</b>` : ''} · last ${since(s.last)}</span>
      ${a.n ? `<span class="wdl" title="${a.w} won, ${a.d} drawn, ${a.l} lost"><i class="w" style="width:${(100 * a.w) / a.n}%"></i><i class="d" style="width:${(100 * a.d) / a.n}%"></i><i class="l" style="width:${(100 * a.l) / a.n}%"></i></span>` : ''}
      <span class="disc-foot">${foot}</span>
    </span>
  </button>`;
}

function renderDiscoveries(quiet = false) {
  view.classList.toggle('quiet', quiet);
  const all = C.list();
  const open = all.filter((s) => s.status === 'ready' || s.status === 'new');
  const ready = all.filter((s) => s.status === 'ready');
  const studied = all.filter((s) => s.status === 'studied');
  const games = new Set(all.flatMap((s) => s.games.map((g) => g.id))).size;
  if (!all.length) {
    view.innerHTML = `<div class="onboard">
      <section class="card rise"><span class="eyebrow">Discoveries</span>
        <h1 class="h1">Learn from the moves that surprise you.</h1>
        <p class="lede">When an opponent answers your opening with a move your library doesn't cover, the coach saves the position, analyses it deeply in the background, and turns it into a short lesson. When you finish it, the line is added to your library.</p>
        <ol class="steps"><li><b class="num">1</b><span><b>Import your chess.com games</b><br><span class="note">Public games only; saved in this app's data folder.</span></span></li>
        <li><b class="num">2</b><span><b>Or just play in the terminal</b><br><span class="note">Games you play on the Play tab are checked against your library as you go.</span></span></li>
        <li><b class="num">3</b><span><b>Study what's caught</b><br><span class="note">Your answers, the engine's view, the idea, then a quick practice.</span></span></li></ol>
      </section>
      <section class="card rise"><h2 class="h3">chess.com username</h2>
        <div class="row" style="margin-top:10px"><input class="input lg grow" id="obUser" placeholder="e.g. hikaru" autocomplete="off" spellcheck="false" value="${esc(C.user)}"><button class="btn cta lg" id="obGo">Import <span class="arrow">→</span></button></div>
        <p class="${S.syncErr ? 'err-text' : 'note'}" id="syncMsg">${esc(S.syncErr || S.syncMsg)}</p>
        <div class="progress" ${S.syncing ? '' : 'hidden'}><i id="syncBar"></i></div>
        <p class="note" style="margin-top:16px">Your library starts with ${C.lib.stats('w').lines} White and ${C.lib.stats('b').lines} Black lines. Browse it in <a class="link" href="#library">Library</a>.</p>
      </section></div>`;
    stagger(view);
    const go = () => sync($('#obUser').value);
    $('#obGo').onclick = go;
    $('#obUser').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    return;
  }
  const f = S.disc;
  const shown = all.filter((s) => (f.side === 'all' || s.side === f.side)
    && (f.show === 'todo' ? (s.status === 'ready' || s.status === 'new') : f.show === 'studied' ? s.status === 'studied' : f.show === 'dismissed' ? s.status === 'dismissed' : true));
  const first = ready[0] || open[0];
  const heroBoards = open.slice(0, 3).map((s) => miniBoard(fenOf(s), s.side)).join('');
  view.innerHTML = `
    <section class="hero rise">
      <div>
        <span class="eyebrow">Discoveries</span>
        <div class="big">${open.length ? `<em data-count="${open.length}">${open.length}</em> new ${open.length === 1 ? 'position' : 'positions'} from your games` : 'You are up to date'}</div>
        <p class="note" style="margin:0">${games ? `Caught from ${plural(games, 'game')}` : ''}${C.progress ? ' · analysing in the background' : ready.length ? ' · analysed and ready' : ''}</p>
        <div class="hero-stats">
          <div><b data-count="${ready.length}">${ready.length}</b><span>ready to study</span></div>
          <div><b data-count="${open.length - ready.length}">${open.length - ready.length}</b><span>being analysed</span></div>
          <div><b data-count="${studied.length}">${studied.length}</b><span>studied</span></div>
        </div>
        ${first ? `<div class="row" style="margin-top:18px"><a class="btn cta lg" href="#discoveries/${first.id}">${first.status === 'ready' ? 'Start studying' : 'Open the first one'} <span class="arrow">→</span></a></div>` : ''}
      </div>
      <div class="hero-boards">${heroBoards}</div>
    </section>
    <div class="filters">
      <div class="seg" id="fSide">${[['all', 'Both colours'], ['w', 'As White'], ['b', 'As Black']].map(([v, t]) => `<button data-v="${v}" aria-pressed="${f.side === v}">${t}</button>`).join('')}</div>
      <div class="seg" id="fShow">${[['todo', `To study (${open.length})`], ['studied', `Studied (${studied.length})`], ['all', 'All']].map(([v, t]) => `<button data-v="${v}" aria-pressed="${f.show === v}">${t}</button>`).join('')}</div>
    </div>
    ${shown.length ? `<div class="disc-grid">${shown.map(discCard).join('')}</div>` : `<div class="empty"><h2 class="h2">Nothing here</h2><p>${f.show === 'todo' ? 'Every caught position is studied. New ones appear after your next games.' : 'No positions match these filters.'}</p></div>`}`;
  stagger(view);
  if (!quiet) countUp(view);
  $('#fSide').onclick = (e) => { const v = e.target.dataset.v; if (v) { S.disc.side = v; ls.set('sfet.coach.discFilter', S.disc); renderDiscoveries(); } };
  $('#fShow').onclick = (e) => { const v = e.target.dataset.v; if (v) { S.disc.show = v; ls.set('sfet.coach.discFilter', S.disc); renderDiscoveries(); } };
  $$('.disc', view).forEach((b) => { b.onclick = () => { location.hash = `discoveries/${b.dataset.id}`; }; });
}

function updateProgressInPlace() {
  renderBg();
  if (current() !== 'discoveries' || !$('#story').hidden) return;
  const p = C.progress;
  $$('[data-prog]', view).forEach((el) => {
    const mine = p && p.id === el.dataset.prog && p.stage !== 'done';
    const prog = mine ? (p.stage === 'main' ? (p.depth || 0) / C.depth.main : 0.9) : 0;
    el.innerHTML = `${ring(prog)}${mine ? `Analysing${p.stage === 'main' ? ` · depth ${p.depth || 0}` : '…'}` : 'Waiting for the engine'}`;
  });
}

// ───────────────────────── Games ─────────────────────────


function ratingChart(L) {
  if (L.length < 5) return '';
  const c = [...groupBy(L, (x) => x.tc).values()].sort((a, b) => b.length - a.length)[0];
  const W = 640, H = 180, pl = 40, pr = 8, pt = 10, pb = 22;
  const ys = c.map((x) => x.myR);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const t0 = c[0].t, t1 = c[c.length - 1].t;
  const pad = Math.max(10, (y1 - y0) * 0.08);
  const lo = y0 - pad, hi = y1 + pad;
  const X = (t) => pl + (W - pl - pr) * (t1 > t0 ? (t - t0) / (t1 - t0) : 0);
  const Y = (v) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const step = Math.max(1, Math.floor(c.length / 400));
  const pts = c.filter((_, i) => i % step === 0 || i === c.length - 1).map((x) => `${X(x.t).toFixed(1)},${Y(x.myR).toFixed(1)}`).join(' ');
  const yr = (t) => new Date(t * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  return `<div class="chart-card rise"><span class="eyebrow">${esc(c[0].tc)} rating</span><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Rating from ${ys[0]} to ${ys[ys.length - 1]}">
    <line x1="${pl}" x2="${W - pr}" y1="${Y(y0)}" y2="${Y(y0)}" stroke="var(--border)"/><line x1="${pl}" x2="${W - pr}" y1="${Y(y1)}" y2="${Y(y1)}" stroke="var(--border)"/>
    <text x="2" y="${Y(y0) + 4}">${y0}</text><text x="2" y="${Y(y1) + 4}">${y1}</text>
    <polyline class="rating-line" pathLength="1000" style="--len:1000" points="${pts}"/>
    <text x="${pl}" y="${H - 4}">${yr(t0)}</text><text x="${W - pr}" y="${H - 4}" text-anchor="end">${yr(t1)}</text></svg></div>`;
}

function opRows(L) {
  const fams = [...groupBy(L, (x) => x.fam)].map(([k, v]) => ({ k, v, a: agg(v) })).sort((a, b) => b.a.n - a.a.n);
  return `<div class="op-table">${fams.map((f) => {
    const a = f.a;
    const tag = a.strong ? '<span class="tag g">Strong</span>' : a.weak ? '<span class="tag b">Weak</span>' : a.n < 15 ? '<span class="tag n">Few games</span>' : '';
    const vars = [...groupBy(f.v, (x) => x.name)].map(([k, v]) => ({ k, a: agg(v) })).sort((p, q) => q.a.n - p.a.n).slice(0, 8);
    return `<details class="op"><summary><span class="nm">${esc(f.k)}${tag}</span><span class="sc">${pct(a.sc)}</span><span class="wdl bar"><i class="w" style="width:${(100 * a.w) / a.n}%"></i><i class="d" style="width:${(100 * a.d) / a.n}%"></i><i class="l" style="width:${(100 * a.l) / a.n}%"></i></span><span class="meta">${plural(a.n, 'game')} · ${a.w}W ${a.d}D ${a.l}L · ${signed(a.diff)} vs expected</span></summary>${vars.map((v) => `<div class="vr"><span>${esc(v.k)}</span><span>${v.a.n} · ${pct(v.a.sc)}</span></div>`).join('')}</details>`;
  }).join('')}</div>`;
}

function renderGames() {
  const am = C.autoSyncMinutes();
  const head = `<span class="eyebrow">Analyse</span><h1 class="h1">Your chess.com games</h1>
    <div class="row" style="margin:12px 0 4px"><input class="input lg grow" style="max-width:420px" id="gUser" value="${esc(C.user)}" placeholder="chess.com username" autocomplete="off" spellcheck="false"><button class="btn cta lg" id="gSync" ${S.syncing ? 'disabled' : ''}>${C.games.length ? 'Update now' : 'Import'}</button>
      <label class="field-inline">Update automatically<select class="select" id="gAuto">${[[0, 'Off'], [15, 'Every 15 minutes'], [60, 'Every hour'], [360, 'Every 6 hours'], [1440, 'Once a day']].map(([v, t]) => `<option value="${v}" ${v === am ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <p class="${S.syncErr ? 'err-text' : 'note'}" id="syncMsg">${esc(S.syncErr || S.syncMsg)}</p><div class="progress" style="max-width:560px" ${S.syncing ? '' : 'hidden'}><i id="syncBar"></i></div>`;
  if (!C.games.length) {
    view.innerHTML = `${head}<p class="lede">Enter your username to download your public chess.com games. They are saved in this app's data folder, so later updates only fetch new months.</p>`;
    bindGameSync();
    return;
  }
  const L = filterGames(C.games, S.f);
  const F = fit(C.lib, L);
  const a = agg(L);
  const ES = insightStats(L, S.an);
  const R = recommendations(C.lib, L, F, ES);
  const opCol = S.opCol || 'w';
  const cur = L.filter((x) => x.col === opCol);
  view.innerHTML = `${head}${filtersHTML()}
    ${L.length ? `<div class="tiles">
      <div class="tile rise"><b data-count="${a.n}">${a.n}</b><span>games</span></div>
      <div class="tile rise"><b data-count="${Math.round(a.sc * 100)}" data-fmt="pct">${pct(a.sc)}</b><span>score · ${a.w}W ${a.d}D ${a.l}L</span></div>
      <div class="tile rise"><b>${signed(a.diff)}</b><span>vs rating expectation, per 100</span></div>
      <div class="tile rise"><b data-count="${(F.c.depth / Math.max(1, F.n) / 2).toFixed(1)}" data-fmt="dec">${(F.c.depth / Math.max(1, F.n) / 2).toFixed(1)}</b><span>moves in your library, on average</span></div></div>
    <h2 class="h2">What to do next</h2><div class="recs">${R.map((r, i) => `<div class="rec rise ${r.hi ? 'hi' : r.ok ? 'ok' : ''}"><h3 class="h3">${esc(r.h)}</h3><p>${esc(r.b)}</p>${r.act ? `<button class="btn sm" data-rec="${i}">${esc(r.act.t)}</button>` : ''}</div>`).join('')}</div>
    ${ratingChart(L)}
    <h2 class="h2">Your openings</h2>
    <div class="seg" id="opCol" style="margin-bottom:10px"><button data-v="w" aria-pressed="${opCol === 'w'}">As White (${L.filter((x) => x.col === 'w').length})</button><button data-v="b" aria-pressed="${opCol === 'b'}">As Black (${L.filter((x) => x.col === 'b').length})</button></div>
    ${cur.length ? opRows(cur) : '<p class="note">No games with this colour in the filter.</p>'}
    <p class="note">Opening names come from chess.com. "Strong" and "Weak" need at least 15 games and a difference outside the 95% margin.</p>
    <h2 class="h2">Against your library</h2>
    <p class="note">${F.c.habit} games left the library on your move, ${F.c.gap} on the opponent's, and ${F.c.end} reached the end of a line. Opponent moves the library doesn't cover are in <a class="link" href="#discoveries">Discoveries</a>.</p>
    <h3 class="h3" style="margin-top:16px">Habits: where you played something else</h3>
    <div class="pos-list" id="habits"></div>` : '<p class="note">No games match these filters.</p>'}`;
  stagger(view);
  countUp(view);
  bindGameSync();
  bindFilters(view, renderGames);
  const oc = $('#opCol');
  if (oc) oc.onclick = (e) => { const v = e.target.dataset.v; if (v) { S.opCol = v; renderGames(); } };
  $$('[data-rec]', view).forEach((b) => { b.onclick = async () => { b.disabled = true; await C.addCustom(R[+b.dataset.rec].act.line); toast('Added to your library'); renderGames(); }; });
  const hs = F.hab.slice(0, 6);
  const hb = $('#habits');
  if (!hb) return;
  hb.innerHTML = hs.map((g, i) => {
    const p = positionAfter(g.path);
    const bk = C.lib.book(g.col, g.node);
    let pm = null;
    try { pm = positionAfter([...g.path, g.san]).move; } catch { pm = null; }
    const arrows = [...bk.map((e) => ({ from: e.a, to: e.b, color: '#3f7a52' })), ...(pm ? [{ from: pm.from, to: pm.to, color: '#b4533a' }] : [])];
    return `<div class="pos rise">${miniBoard(p.fen, g.col, { arrows })}<div style="min-width:0"><h3 class="h3">You: ${esc(moveLabel(g.ply) + g.san)} · Library: ${esc(bk.map((e) => e.s).join(' or '))}</h3>
      <p class="note">${esc(sanLine(g.path)) || 'First move'}</p><p>${plural(g.L.length, 'game')}, ${pct(g.a.sc)} scored against ${pct(g.a.ex)} expected.</p>
      <div class="row"><a class="btn sm" href="#library/${g.col}/${encodeURIComponent(g.path.join(','))}/drill">Drill the library move</a><button class="btn sm" data-keep="${i}">Keep my move too</button></div></div></div>`;
  }).join('') || '<p class="note">None in this filter.</p>';
  stagger(hb);
  $$('[data-keep]', view).forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      const g = hs[+b.dataset.keep];
      await C.addCustom({ side: g.col, san: [...g.path, g.san], title: `${moveLabel(g.ply)}${g.san}`, plan: `Your own move, kept from ${plural(g.L.length, 'game')} at ${pct(g.a.sc)}. An alternative to the library move.` });
      toast('Kept in your library');
      renderGames();
    };
  });
}

function bindGameSync() {
  const au = $('#gAuto');
  if (au) au.onchange = () => { C.setAutoSync(+au.value); renderAccount(); toast(+au.value ? 'Games will update automatically while Outpost is open' : 'Automatic updates are off'); };
  const go = () => sync($('#gUser').value);
  $('#gSync').onclick = go;
  $('#gUser').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}

// ───────────────────────── Guide ─────────────────────────
function renderGuide() {
  const { html } = buildGuide({ user: C.user, games: C.games, an: S.an, lib: C.lib, discoveries: C.list() });
  view.innerHTML = `${planCardHTML(C)}<div class="guide">${html}</div>${planHistoryHTML(C)}`;
  bindPlanCard(view, C);
  stagger(view);
  countUp(view);
  requestAnimationFrame(() => $$('.hbar i', view).forEach((i) => { i.style.width = `${i.dataset.w}%`; }));
  $$('[data-fen]', view).forEach((x) => {
    const arrows = (x.dataset.ar || '').split(',').filter(Boolean).map((a) => { const [from, to] = a.split('-'); return { from, to, color: '#d9480f' }; });
    x.innerHTML = miniBoard(x.dataset.fen, 'w', { arrows });
  });
}

// ───────────────────────── start ─────────────────────────
// Screens that show live data re-render quietly when it changes (no entrance animation).
const LIVE = {
  today: () => renderToday(view, C, S, { quiet: true }),
  games: () => renderGames(),
  plan: () => renderGuide(),
  progress: () => renderProgress(view, C, { quiet: true }),
  time: () => renderTime(view, C, { quiet: true }),
  training: () => { if (!parseHash().arg[0]) renderTraining(view, C); },
  puzzles: () => { if (!parseHash().arg[0] && !puzzleSessionActive()) renderPuzzles(view, C); },
  insights: () => renderInsights(view, C, S, { quiet: true }),
  review: () => { if (!parseHash().arg[0]) renderReview(view, C, S, [], { quiet: true }); },
  journal: () => { if (!journalBusy()) renderJournal(view, C, parseHash().arg, { quiet: true }); },
};
let liveTimer = null;
function refreshLive(secs) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    const sec = current();
    if (!$('#story').hidden || !secs.includes(sec) || !LIVE[sec]) return;
    const y = window.scrollY;
    view.classList.add('quiet');
    LIVE[sec]();
    window.scrollTo({ top: y });
  }, 250);
}

(async () => {
  view.innerHTML = '<p class="note">Loading…</p>';
  await C.ready;
  renderAccount();
  renderBg();
  C.addEventListener('progress', updateProgressInPlace);
  C.addEventListener('change', () => {
    renderBg();
    const sec = current();
    if (sec === 'discoveries' && $('#story').hidden) renderDiscoveries(true);
    refreshLive(['today', 'plan']);
  });
  C.addEventListener('reviewed', () => { renderBg(); refreshLive(['review', 'insights', 'today', 'plan', 'progress', 'puzzles', 'training', 'journal']); });
  C.addEventListener('practice', () => { paintDue(); refreshLive(['today', 'plan', 'journal']); });
  C.addEventListener('journal', () => { paintDue(); refreshLive(['today', 'plan']); });
  C.addEventListener('synced', (e) => {
    renderAccount();
    const { fresh, discoveries } = e.detail || {};
    if (fresh) toast(`${plural(fresh, 'new game')} from chess.com${discoveries ? ` · ${plural(discoveries, 'new position')} to study` : ''}`);
    refreshLive(['today', 'games', 'review', 'journal', 'insights', 'plan', 'puzzles', 'progress', 'time', 'training']);
  });
  route();
  if (C.user) {
    try {
      await C.loadGames();
      await C.ingest(C.games);
      refreshLive(['today', 'games', 'review', 'journal', 'insights', 'plan', 'puzzles', 'progress', 'time', 'training']);
    } catch (e) { console.warn(e); }
  }
  C.kick();
  C.startAutoSync();
  window.__coach = { C, S, interactiveQueue };
})();
export { when };
