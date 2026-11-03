// Analyse → Review (every game reviewed in the background, opened instantly) and Insights
// (patterns across all reviewed games).
import { Chess } from '../../vendor/chess.js';
import { Engine } from '../engine.js';
import { AnimBoard, sleep } from './animboard.js';
import { $, $$, esc, miniBoard, countUp, stagger, when } from './ui.js';
import {
  EngineQueue, reviewGame, reviewComment, insightStats, CLASSES, ERROR_CLASSES, bookPlies, fensOf, wp,
  reviewDocName, phaseAccuracy, pvToSan,
} from './analysis.js';
import { filterGames, plural, pct } from './games.js';
import { filtersHTML, bindFilters } from './filters.js';
import { store } from './store.js';
import { moveLabel, sanLine } from './library.js';
import { Maia } from '../maia.js';
import { evalText } from './analysis.js';

const ENGINE_URL = new URL('../../engine/stockfish-19-lite-single.js', import.meta.url).href;
let iq = null;
/** Engine for interactive work on this page (separate from the background analyser). */
export function interactiveQueue() {
  if (!iq) iq = new EngineQueue(new Engine(ENGINE_URL));
  return iq;
}

const RV = { tk: 0, show: 40, q: '', x: null, R: null, p: 0, retry: false, playing: false, view: null, C: null, S: null };
const chip = (k) => `<span class="sym" style="background:${CLASSES[k].color}">${CLASSES[k].sym}</span>`;
const accColor = (a) => (a >= 90 ? 'var(--cl-best)' : a >= 80 ? 'var(--cl-excellent)' : a >= 70 ? 'var(--cl-good)' : a >= 60 ? 'var(--cl-inaccuracy)' : a >= 50 ? 'var(--cl-mistake)' : 'var(--cl-blunder)');
const RESULT_TEXT = { checkmated: 'by checkmate', resigned: 'by resignation', timeout: 'on time', abandoned: 'by abandonment', stalemate: 'by stalemate', agreed: 'by agreement', repetition: 'by repetition', insufficient: 'insufficient material', '50move': '50-move rule', timevsinsufficient: 'time vs insufficient material' };

function accRing(acc, label, you) {
  const a = acc ?? 0;
  return `<div class="acc-ring ${you ? 'you' : ''}" style="--p:${a / 100};--c:${accColor(a)}"><svg viewBox="0 0 64 64"><circle class="ar-bg" cx="32" cy="32" r="27"/><circle class="ar-fg" cx="32" cy="32" r="27" pathLength="100"/></svg><b data-count="${a}" data-fmt="dec">${a.toFixed(1)}</b><span>${label}</span></div>`;
}

function sparkSVG(s, col, w = 120, h = 30) {
  if (!s || s.length < 2) return '<span class="spark-empty"></span>';
  const pts = s.map((v, i) => [(i * w) / (s.length - 1), h * (1 - (col === 'w' ? v : 100 - v) / 100)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return `<svg class="row-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}"/><path class="a" d="${d} L${w} ${h / 2} L0 ${h / 2} Z"/><path class="l" d="${d}"/></svg>`;
}

function periodOf(t) {
  const now = new Date();
  const d = new Date(t * 1000);
  const days = (now - d) / 864e5;
  if (days < 1 && d.getDate() === now.getDate()) return 'Today';
  if (days < 7) return 'This week';
  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) return 'Earlier this month';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// ───────────────────────── list ─────────────────────────
export async function renderReview(view, C, S, args = [], { quiet = false } = {}) {
  Object.assign(RV, { view, C, S });
  if (args[0]) {
    let x = C.games.find((g) => g.id === args[0]);
    if (!x && !C.games.length && C.user) { view.innerHTML = '<p class="note">Loading games…</p>'; await C.loadGames().catch(() => null); x = C.games.find((g) => g.id === args[0]); }
    if (x) { openGame(x, args[1] != null ? +args[1] : null); return; }
  }
  RV.x = null;
  RV.R = null;
  RV.tk++;
  if (!C.games.length) {
    view.innerHTML = `<span class="eyebrow">Analyse</span><h1 class="h1">Your games, reviewed</h1><p class="lede">Import your games in <a class="link" href="#games">Games</a>. Every game is then reviewed in the background, so each one opens instantly here.</p>`;
    return;
  }
  const idx = C.reviewIdx;
  const rp = C.reviewProgress();
  const q = RV.q.trim().toLowerCase();
  const L = filterGames(C.games, S.f).filter((x) => !q || `${x.opp} ${x.fam} ${x.name}`.toLowerCase().includes(q)).slice().reverse();
  const mine = C.games.filter((x) => idx[x.id]).slice(-20).map((x) => C.accOf(x.id, x.col));
  const avg = mine.length ? mine.reduce((a, b) => a + b, 0) / mine.length : null;
  const p = C.progress?.kind === 'review' ? C.progress : null;
  const groups = [];
  for (const x of L.slice(0, RV.show)) {
    const k = periodOf(x.t);
    if (!groups.length || groups.at(-1).k !== k) groups.push({ k, L: [] });
    groups.at(-1).L.push(x);
  }
  view.innerHTML = `<span class="eyebrow">Analyse</span><h1 class="h1">Your games, reviewed</h1>
    <div class="rv-summary rise">
      <div><b data-count="${rp.done}">${rp.done}</b><span>of ${rp.total} games reviewed</span><div class="progress"><i style="width:${(100 * rp.done) / Math.max(1, rp.total)}%"></i></div></div>
      <div><b ${avg != null ? `data-count="${avg.toFixed(1)}" data-fmt="dec"` : ''}>${avg != null ? avg.toFixed(1) : '–'}</b><span>your average accuracy, last ${mine.length || 20} games</span></div>
      <div class="rv-sum-note">${rp.done < rp.total ? `<span class="ring spin sm"></span> Reviewing in the background, newest first. Games open instantly once reviewed; others are reviewed when you open them.` : 'All games are reviewed. New games are reviewed as they arrive.'}</div>
    </div>
    <div class="filters">${filtersHTML(S, C.games).replace(/^<div class="filters">|<\/div>$/g, '')}<input class="input search" id="rvSearch" placeholder="Search opponent or opening" value="${esc(RV.q)}" autocomplete="off"></div>
    ${groups.map((g) => `<p class="eyebrow group-title">${esc(g.k)}</p><div class="game-list">${g.L.map((x) => {
      const r = idx[x.id];
      const res = x.sc === 1 ? 'win' : x.sc === 0.5 ? 'draw' : 'loss';
      const mc = r?.c?.[x.col] || {};
      const now = p && p.id === x.id;
      return `<button class="game-row rise ${res}" data-gid="${esc(x.id)}">
        <span class="res"></span>
        <span class="gr-main"><b>${esc(x.opp)} <small class="rt">${x.opR}</small></b><small><i class="side-dot ${x.col}"></i>${esc(x.fam)} · ${esc(x.tc)} · ${when(x.t)}</small></span>
        <span class="gr-spark">${r ? sparkSVG(r.s, x.col) : ''}</span>
        <span class="gr-err">${r ? `${mc.blunder ? `<span class="cnt" style="--c:var(--cl-blunder)">${mc.blunder}??</span>` : ''}${mc.mistake ? `<span class="cnt" style="--c:var(--cl-mistake)">${mc.mistake}?</span>` : ''}${(mc.brilliant || 0) + (mc.great || 0) ? `<span class="cnt" style="--c:var(--cl-great)">${(mc.brilliant || 0) + (mc.great || 0)}!</span>` : ''}` : ''}</span>
        <span class="gr-acc">${r ? `<span class="acc-pill" style="--c:${accColor(C.accOf(x.id, x.col))}">${C.accOf(x.id, x.col)}</span>` : now ? `<span class="queued"><span class="ring spin sm"></span>${Math.round((100 * p.i) / p.n)}%</span>` : '<span class="queued">In queue</span>'}</span>
      </button>`;
    }).join('')}</div>`).join('') || '<p class="note">No games match.</p>'}
    ${L.length > RV.show ? `<button class="btn" id="more" style="margin-top:12px;width:100%">Show more (${L.length - RV.show} left)</button>` : ''}`;
  if (!quiet) { stagger(view, 18); countUp(view); }
  bindFilters(S, view, () => renderReview(view, C, S));
  const se = $('#rvSearch');
  se.oninput = () => { RV.q = se.value; clearTimeout(se._t); se._t = setTimeout(() => { renderReview(view, C, S, [], { quiet: true }); const n = $('#rvSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 180); };
  const mo = $('#more');
  if (mo) mo.onclick = () => { RV.show += 60; renderReview(view, C, S, [], { quiet: true }); };
  $$('[data-gid]', view).forEach((b) => { b.onclick = () => { location.hash = `review/${encodeURIComponent(b.dataset.gid)}`; }; });
}

// ───────────────────────── one game ─────────────────────────
async function openGame(x, startP) {
  const { view, C } = RV;
  const tk = ++RV.tk;
  Object.assign(RV, { x, R: null, retry: false, playing: false, ex: null, book: RV.book?.name === x.opp ? RV.book : null });
  let R = await store.get(reviewDocName(x.id)).catch(() => null);
  if (!R) {
    view.innerHTML = `<a class="link back" href="#review">← All games</a><div class="rv-wait rise"><span class="ring spin"></span><div><h2 class="h3" style="margin:0">Reviewing this game…</h2><p class="note" id="rvp">Starting the engine</p></div></div><div class="progress" style="max-width:520px"><i id="rvb0"></i></div>`;
    C.pause(true); // the open game goes first
    let seen = 0;
    R = await reviewGame(interactiveQueue(), x.sans, {
      depth: 14,
      bookPlies: bookPlies(x, C.lib.walk(x.col, x.sans).ply),
      isCancelled: () => tk !== RV.tk,
      tick: () => {
        seen++;
        const b = $('#rvb0');
        const t = $('#rvp');
        if (b) b.style.width = `${(100 * seen) / (x.sans.length + 1)}%`;
        if (t) t.textContent = `Position ${seen} of ${x.sans.length + 1}`;
      },
    });
    C.pause(false);
    if (!R) return;
    await C.saveReview(x, R);
  }
  if (tk !== RV.tk) return;
  C.log('review', x.id);
  RV.R = R;
  const first = R.cl.findIndex((c, i) => ['blunder', 'miss', 'mistake'].includes(c) && (i % 2 === 0) === (x.col === 'w'));
  RV.p = startP != null && startP >= 0 ? startP : 0;
  drawGame();
  void first;
}

function graphSVG(R, col) {
  const W = 600, H = 120, n = R.ev.length - 1 || 1;
  const X = (i) => (i * W) / n;
  const Y = (w) => H * (1 - w / 100);
  const pts = R.ev.map((e, i) => [X(i), Y(e.w)]);
  // smooth path (Catmull-Rom → Bézier)
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const marks = R.cl.map((c, i) => (['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(c) ? `<circle class="gm ${(i % 2 === 0) === (col === 'w') ? 'you' : ''}" cx="${X(i + 1).toFixed(1)}" cy="${Y(R.ev[i + 1].w).toFixed(1)}" r="4.5" fill="${CLASSES[c].color}"/>` : '')).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Win chance through the game">
    <rect width="${W}" height="${H}" class="g-black"/><path class="g-white" d="${d} L${W} ${H} L0 ${H} Z"/><line class="g-mid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/>
    ${marks}<line id="rvcur" class="g-cur" y1="0" y2="${H}"/><circle id="rvdot" class="g-dot" r="5"/></svg><div class="g-tip" id="rvtip" hidden></div>`;
}

const HELP = {
  brilliant: 'A strong sacrifice: you gave up material and the position stayed good.',
  great: 'The only good move in the position. Well found.',
  best: "The engine's top choice.",
  excellent: 'Almost as good as the best move.',
  good: 'A reasonable move; something slightly better existed.',
  book: 'A known opening move.',
  forced: 'The only legal move.',
  inaccuracy: 'Not a disaster, but a better move was there.',
  mistake: 'This made your position noticeably worse.',
  miss: 'Your opponent had just gone wrong, and this let them off the hook.',
  blunder: 'A serious error that changes the evaluation a lot.',
};
const pl = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;

function keyMoments(R, col) {
  const out = [];
  R.cl.forEach((c, i) => {
    const mine = (i % 2 === 0) === (col === 'w');
    if (mine && ['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(c)) out.push({ i, c, mine: true });
    else if (!mine && c === 'blunder') out.push({ i, c, mine: false });
  });
  // keep the 8 biggest swings, in game order
  return out.map((m) => ({ ...m, w: m.mine ? (ERROR_CLASSES.includes(m.c) ? R.loss[m.i] : 20) : R.loss[m.i] }))
    .sort((a, b) => b.w - a.w).slice(0, 8).sort((a, b) => a.i - b.i);
}

function momentTitle(m) {
  if (!m.mine) return 'Their mistake';
  return { blunder: 'Your blunder', mistake: 'Your mistake', miss: 'A missed chance', brilliant: 'A brilliant move', great: 'A great find' }[m.c] || CLASSES[m.c].label;
}

function quality(cnt) {
  const good = (cnt.brilliant || 0) + (cnt.great || 0) + (cnt.best || 0) + (cnt.excellent || 0) + (cnt.good || 0) + (cnt.book || 0) + (cnt.forced || 0);
  const parts = [
    ['good', good, 'good move', 'var(--cl-best)'],
    ['inaccuracy', cnt.inaccuracy || 0, 'inaccuracy', 'var(--cl-inaccuracy)', 'inaccuracies'],
    ['mistake', (cnt.mistake || 0) + (cnt.miss || 0), 'mistake', 'var(--cl-mistake)'],
    ['blunder', cnt.blunder || 0, 'blunder', 'var(--cl-blunder)'],
  ];
  const total = parts.reduce((t, q) => t + q[1], 0) || 1;
  const txt = parts.filter((q) => q[1] || q[0] === 'good').map((q) => pl(q[1], q[2], q[4])).join(' · ');
  return `<div class="qbar" role="img" title="${txt}" aria-label="${txt}">${parts.map((q) => (q[1] ? `<i style="--w:${(100 * q[1]) / total}%;--c:${q[3]}"></i>` : '')).join('')}</div>
    <small class="qtxt">${parts.filter((q) => q[0] !== 'good' && q[1]).map((q) => `<span style="--c:${q[3]}"><i></i>${pl(q[1], q[2], q[4])}</span>`).join('') || '<span style="--c:var(--cl-best)"><i></i>no errors</span>'}</small>`;
}

function drawGame() {
  const { R, x, view } = RV;
  const g = x.g || {};
  const opp = x.col === 'w' ? 'b' : 'w';
  const meP = x.col === 'w' ? g.white : g.black;
  const opP = x.col === 'w' ? g.black : g.white;
  const res = x.sc === 1 ? 'You won' : x.sc === 0.5 ? 'Draw' : 'You lost';
  const how = RESULT_TEXT[(x.sc === 1 ? opP : meP)?.result] || '';
  const cc = g.accuracies;
  const ccOf = (c) => cc?.[c === 'w' ? 'white' : 'black'];
  const acc = (c) => RV.C.accFromLosses(R.loss, c);
  const ph = { me: phaseAccuracy(R, x.col), op: phaseAccuracy(R, opp) };
  const cnt = { w: {}, b: {} };
  R.cl.forEach((c, i) => { const sd = i % 2 ? 'b' : 'w'; cnt[sd][c] = (cnt[sd][c] || 0) + 1; });
  const km = keyMoments(R, x.col);
  RV.km = km;
  RV.tab = RV.tab || 'coach';
  const player = (c) => {
    const me = c === x.col;
    const P = me ? meP : opP;
    const a = acc(c);
    return `<div class="pbar ${me ? 'me' : ''}" data-side="${c}">
      <span class="pav ${c}">${esc((P?.username || '?')[0].toUpperCase())}</span>
      <span class="pname"><b>${esc(P?.username || (me ? 'You' : x.opp))} <small>${(me ? x.myR : x.opR) || ''}${me ? ' · you' : ''}</small></b>${quality(cnt[c])}</span>
      <span class="pacc" style="--c:${accColor(a)}" title="Accuracy: how close the moves were to the engine's, from 0 to 100"><b data-count="${a}" data-fmt="dec">${a.toFixed(1)}</b><small>accuracy${ccOf(c) != null ? ` · chess.com ${ccOf(c).toFixed(1)}` : ''}</small></span>
    </div>`;
  };
  view.innerHTML = `<div class="rv-top rise"><a class="link back" href="#review">← All games</a>
      <span class="rv-res ${x.sc === 1 ? 'win' : x.sc === 0.5 ? 'draw' : 'loss'}">${res}${how ? ` <small>${esc(how)}</small>` : ''}</span>
      <span class="rv-meta">${esc(x.name)} · ${esc(x.tc)} · ${when(x.t)}${x.url ? ` · <a class="link" href="${esc(x.url)}" target="_blank" rel="noopener">chess.com ↗</a>` : ''}</span></div>
    <div class="rv2">
      <div class="rv2-board">
        <div id="pbTop"></div>
        <div class="rv-board"><div class="evalbar" id="evb"><div class="evalbar-fill" id="evf"></div><span class="evalbar-label" id="evt"></span></div><div id="rvBoard"></div></div>
        <div id="pbBot"></div>
        <div class="board-ctl"><button class="btn icon" id="r0" title="Start (Home)">⏮</button><button class="btn icon" id="r1" title="Back (←)">◀</button><button class="btn icon play" id="rPlay" title="Play through (Space)">▶</button><button class="btn icon" id="r2" title="Forward (→)">▶</button><button class="btn icon" id="r3" title="End (End)">⏭</button><button class="btn icon" id="rFlip" title="Flip board">⇅</button></div>
        <div class="evgraph" id="rvg" title="Who was better through the game: white area = White, dark = Black. Click to jump.">${graphSVG(R, x.col)}</div>
      </div>
      <div class="rv2-side">
        <div class="tabs" id="rvTabs" role="tablist">${[['coach', 'Coach'], ['moves', 'Moves'], ['report', 'Report']].map(([k, t]) => `<button role="tab" data-tab="${k}" aria-selected="${RV.tab === k}">${t}</button>`).join('')}<span class="tab-ink"></span></div>
        <div class="tabpane" data-pane="coach" ${RV.tab === 'coach' ? '' : 'hidden'}>
          ${km.length ? `<div class="km"><div class="km-head"><div><span class="eyebrow">Key moments</span><b id="kmLabel">${pl(km.length, 'moment')} decided this game</b></div><div class="km-nav"><button class="btn icon" id="kmPrev" title="Previous key moment (P)">◀</button><button class="btn cta sm" id="kmNext" title="Next key moment (N)">Next moment <span class="arrow">→</span></button></div></div>
            <div class="moment-row">${km.map((m, k) => `<button class="moment ${m.mine ? 'mine' : 'theirs'}" data-p="${m.i + 1}" data-k="${k}">${chip(m.c)}<span>${moveLabel(m.i)}${esc(R.san[m.i])}</span></button>`).join('')}</div></div>` : '<div class="km"><b>A clean game.</b> <span class="note">No big swings for you here.</span></div>'}
          <div id="rvc"></div>
        </div>
        <div class="tabpane" data-pane="moves" ${RV.tab === 'moves' ? '' : 'hidden'}><div class="mvt" id="rvm"></div></div>
        <div class="tabpane" data-pane="report" ${RV.tab === 'report' ? '' : 'hidden'}>
          <div class="rep-acc">${[x.col, opp].map((c) => `<div><span class="eyebrow">${c === x.col ? 'You' : 'Opponent'}</span><b style="color:${accColor(acc(c))}">${acc(c).toFixed(1)}</b><small>accuracy${ccOf(c) != null ? ` · chess.com ${ccOf(c).toFixed(1)}` : ''}</small></div>`).join('')}</div>
          <div class="panel-card"><span class="eyebrow">Accuracy by phase</span>${['Opening', 'Middlegame', 'Endgame'].map((k) => `<div class="ph-row"><span>${k}</span><div class="ph-bars"><i class="you" data-w="${ph.me[k] ?? 0}"></i><i class="op" data-w="${ph.op[k] ?? 0}"></i></div><span class="ph-v">${ph.me[k] ?? '–'}<small> / ${ph.op[k] ?? '–'}</small></span></div>`).join('')}<div class="legend" style="margin-top:8px"><span><i style="background:var(--you)"></i>You</span><span><i style="background:var(--muted-foreground)"></i>Opponent</span></div></div>
          <div class="panel-card"><span class="eyebrow">Every move, by quality</span><div class="mirror">${['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'].map((k) => {
            const a = cnt[x.col][k] || 0;
            const b = cnt[opp][k] || 0;
            const mx = Math.max(1, ...Object.values(cnt.w), ...Object.values(cnt.b));
            return `<div class="mr" title="${esc(HELP[k])}"><span class="mr-v">${a}</span><span class="mr-l"><i data-w="${(100 * a) / mx}" style="background:${CLASSES[k].color}"></i></span><span class="mr-k">${chip(k)}${CLASSES[k].label}</span><span class="mr-r"><i data-w="${(100 * b) / mx}" style="background:${CLASSES[k].color}"></i></span><span class="mr-v">${b}</span></div>`;
          }).join('')}</div><div class="legend" style="margin-top:8px;justify-content:space-between"><span>You</span><span>Opponent</span></div></div>
          <p class="note">Accuracy uses Outpost's formula${RV.C.accParams?.games ? `, fitted to chess.com's on ${RV.C.accParams.games} public games` : ''}${RV.C.cal ? ` and adjusted on ${RV.C.cal.n} of your own results` : ''}. Reviewed at depth ${R.d}.</p>
        </div>
      </div>
    </div>`;
  stagger(view);
  RV.board = new AnimBoard($('#rvBoard'), { orientation: x.col });
  const bars = () => {
    const top = RV.board.orientation === 'w' ? 'b' : 'w';
    $('#pbTop').innerHTML = player(top);
    $('#pbBot').innerHTML = player(top === 'w' ? 'b' : 'w');
    countUp($('.rv2-board'));
    requestAnimationFrame(() => $$('.qbar i', view).forEach((i) => i.classList.add('in')));
  };
  bars();
  requestAnimationFrame(() => $$('[data-w]', view).forEach((i) => { i.style.width = `${i.dataset.w}%`; }));
  $('#evb').classList.toggle('flipped', x.col === 'b');
  const setTab = (t) => {
    RV.tab = t;
    $$('#rvTabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $$('.tabpane', view).forEach((pn) => { pn.hidden = pn.dataset.pane !== t; });
    const cur = $(`#rvTabs [data-tab="${t}"]`);
    const ink = $('#rvTabs .tab-ink');
    ink.style.width = `${cur.offsetWidth}px`;
    ink.style.transform = `translateX(${cur.offsetLeft}px)`;
    if (t === 'report') $$('[data-pane="report"] [data-w]', view).forEach((i) => { i.style.width = '0'; requestAnimationFrame(() => { i.style.width = `${i.dataset.w}%`; }); });
  };
  $('#rvTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); };
  requestAnimationFrame(() => setTab(RV.tab));
  $('#r0').onclick = () => go(0);
  $('#r1').onclick = () => go(RV.p - 1);
  $('#r2').onclick = () => go(RV.p + 1);
  $('#r3').onclick = () => go(R.san.length);
  $('#rPlay').onclick = togglePlay;
  $('#rFlip').onclick = () => { RV.board.setOrientation(RV.board.orientation === 'w' ? 'b' : 'w'); $('#evb').classList.toggle('flipped', RV.board.orientation === 'b'); bars(); };
  $$('.moment', view).forEach((b) => { b.onclick = () => go(+b.dataset.p); });
  const stepMoment = (dir) => {
    if (!km.length) return;
    const k = dir > 0 ? km.findIndex((m) => m.i + 1 > RV.p) : km.map((m) => m.i + 1 < RV.p).lastIndexOf(true);
    const target = k < 0 ? (dir > 0 ? km[0] : km.at(-1)) : km[k];
    setTab('coach');
    go(target.i + 1);
  };
  RV.stepMoment = stepMoment;
  const kn = $('#kmNext');
  if (kn) kn.onclick = () => stepMoment(1);
  const kp = $('#kmPrev');
  if (kp) kp.onclick = () => stepMoment(-1);
  const gs = $('#rvg');
  const at = (e) => { const r = gs.getBoundingClientRect(); return Math.max(0, Math.min(R.san.length, Math.round(((e.clientX - r.left) / r.width) * R.san.length))); };
  gs.onclick = (e) => go(at(e));
  gs.onpointermove = (e) => {
    const pp = at(e);
    const tip = $('#rvtip');
    const r = gs.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = `${Math.min(r.width - 130, Math.max(0, e.clientX - r.left - 65))}px`;
    tip.innerHTML = pp ? `${chip(R.cl[pp - 1])}<b>${moveLabel(pp - 1)}${esc(R.san[pp - 1])}</b> <span>${esc(R.ev[pp].t || '')}</span>` : 'Start';
  };
  gs.onpointerleave = () => { $('#rvtip').hidden = true; };
  const rows = [];
  for (let i = 0; i < R.san.length; i += 2) {
    rows.push(`<span>${i / 2 + 1}.</span>${[i, i + 1].map((j) => (j < R.san.length ? `<button data-p="${j + 1}" class="${(j % 2 === 0) === (x.col === 'w') ? 'mine' : ''}">${chip(R.cl[j])}${esc(R.san[j])}</button>` : '<span></span>')).join('')}`);
  }
  $('#rvm').innerHTML = rows.join('');
  $('#rvm').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) go(+b.dataset.p); };
  drawBoard(false);
}

function go(p, animate = true) {
  if (!RV.R) return;
  RV.ex = null;
  RV.p = Math.max(0, Math.min(RV.R.san.length, p));
  RV.retry = false;
  drawBoard(animate);
}

async function togglePlay() {
  RV.playing = !RV.playing;
  const b = $('#rPlay');
  if (b) b.textContent = RV.playing ? '⏸' : '▶';
  const tk = RV.tk;
  if (RV.playing && RV.p >= RV.R.san.length) go(0);
  while (RV.playing && tk === RV.tk && RV.p < RV.R.san.length) {
    await sleep(850);
    if (!RV.playing || tk !== RV.tk) break;
    go(RV.p + 1);
  }
  RV.playing = false;
  const b2 = $('#rPlay');
  if (b2) b2.textContent = '▶';
}

function drawBoard(animate = true) {
  const { R, x, p, board } = RV;
  if (!$('#rvBoard')) return;
  const { fens } = fensOf(R.san);
  const retry = RV.retry && p > 0;
  const fen = retry ? fens[p - 1] : fens[p];
  const i = p - 1;
  let last = [];
  const arrows = [];
  if (!retry && i >= 0) {
    const mv = new Chess(fens[i]).move(R.san[i]);
    last = [mv.from, mv.to];
    const k = R.cl[i];
    if (['inaccuracy', 'mistake', 'blunder', 'miss', 'good', 'excellent'].includes(k) && R.ev[i].best && R.ev[i].bs !== R.san[i]) {
      arrows.push({ from: R.ev[i].best.slice(0, 2), to: R.ev[i].best.slice(2, 4), color: '#3f7a52', key: `best${i}` });
    }
  }
  board.setFen(fen, { animate, lastMove: last });
  board.setArrows(arrows);
  if (!retry && i >= 0) { board.badge(last[1], CLASSES[R.cl[i]].sym, CLASSES[R.cl[i]].color); if (ERROR_CLASSES.includes(R.cl[i]) || ['brilliant', 'great'].includes(R.cl[i])) board.pulse(last[1], CLASSES[R.cl[i]].color); } else board.badge(null);
  const e = R.ev[retry ? p - 1 : p];
  $('#evf').style.height = `${e.w}%`;
  $('#evb').classList.toggle('white-ahead', e.w >= 50);
  $('#evt').textContent = e.t || '';
  const W = 600;
  const cx = (p * W) / (R.ev.length - 1 || 1);
  $('#rvcur').setAttribute('x1', cx);
  $('#rvcur').setAttribute('x2', cx);
  $('#rvdot').setAttribute('cx', cx);
  $('#rvdot').setAttribute('cy', 120 * (1 - R.ev[p].w / 100));
  let html;
  const mine = i >= 0 && (i % 2 === 0) === (x.col === 'w');
  if (retry) html = `<div class="comment try"><h3>Find a better move</h3><p>${esc(RV.msg || 'Your move: tap a piece, then its square.')}</p></div>`;
  else if (i < 0) html = `<div class="comment intro"><h3>How to review this game</h3><ol><li>Press <b>Next moment</b> to jump to the moves that decided the game.</li><li>At each one, read why it mattered, then try <b>Find a better move</b>.</li><li>Move any piece to explore other ideas; arrows show the engine's suggestions.</li></ol><p class="note">Keys: ← → step · N / P next or previous moment · Space plays the game.</p></div>`;
  else {
    const q = reviewComment(R, i, x.fam);
    const err = ERROR_CLASSES.includes(q.k);
    const ki = (RV.km || []).findIndex((m) => m.i === i);
    const km = ki >= 0 ? RV.km[ki] : null;
    html = `<div class="comment ${err ? 'err' : ''}" style="--c:${CLASSES[q.k].color}">
      ${km ? `<span class="eyebrow">Key moment ${ki + 1} of ${RV.km.length} · ${momentTitle(km)}</span>` : ''}
      <div class="cm-head"><span class="cm-chip">${CLASSES[q.k].sym}</span><div><b>${esc(moveLabel(i) + R.san[i])} is ${q.k === 'book' ? 'a book move' : `${/^[aeiou]/i.test(CLASSES[q.k].label) ? 'an' : 'a'} ${CLASSES[q.k].label.toLowerCase()}`}</b><span>${mine ? 'Your move' : "Opponent's move"} · ${esc(HELP[q.k])}</span></div><span class="cm-eval" title="Evaluation from White's side: + means White is better">${esc(R.ev[p].t || '')}</span></div>
      <p>${esc(q.text)}</p>
      ${q.line ? `<details class="cm-more"><summary>Show the engine's line</summary><div class="cm-line"><span class="mono">${esc(q.line)}</span></div></details>` : ''}
      <div class="row">${q.line ? '<button class="btn sm" id="rShow">Play the better line</button>' : ''}${mine && err ? '<button class="btn sm cta" id="rRetry">Find a better move</button>' : ''}</div>
      <p class="note cm-tip">Tip: move any piece on the board to explore what would have happened.</p></div>`;
  }
  $('#rvc').innerHTML = html;
  const sb = $('#rShow');
  if (sb) sb.onclick = () => showLine(i);
  const rr = $('#rRetry');
  if (rr) rr.onclick = () => { RV.retry = true; RV.msg = ''; drawBoard(); };
  $$('#rvm button').forEach((b) => { const c = +b.dataset.p === p; b.classList.toggle('cur', c); if (c) b.scrollIntoView({ block: 'nearest' }); });
  $$('.moment').forEach((b) => b.classList.toggle('cur', +b.dataset.p === p));
  $('#r0').disabled = p === 0;
  $('#r1').disabled = p === 0;
  $('#r2').disabled = p === R.san.length;
  $('#r3').disabled = p === R.san.length;
  if (retry) {
    const c = new Chess(fen);
    board.interactive({
      canPick: (sq) => c.get(sq)?.color === c.turn(),
      targets: (sq) => c.moves({ square: sq, verbose: true }).map((m) => m.to),
      onMove: async (from, to) => {
        const t = new Chess(fen);
        const mv = t.move({ from, to, promotion: 'q' });
        board.setFen(t.fen(), { lastMove: [from, to] });
        board.interactive(null);
        $('#rvc').innerHTML = `<div class="comment try"><h3>Checking ${esc(mv.san)}…</h3></div>`;
        let after = 100;
        if (t.isDraw()) after = 50;
        else if (!t.isCheckmate()) { const r = await interactiveQueue().go(t.fen(), { depth: 14 }); after = 100 - wp(r.score); }
        const before = (p - 1) % 2 === 0 ? R.ev[p - 1].w : 100 - R.ev[p - 1].w;
        const l = Math.max(0, before - after);
        const ok = mv.san === R.ev[p - 1].bs || l < 5;
        RV.msg = mv.san === R.ev[p - 1].bs ? `${mv.san} is the best move.` : l < 5 ? `${mv.san} is good: it costs only about ${Math.round(l)} points.` : `${mv.san} still costs about ${Math.round(l)} points of win chance. Try again.`;
        if (ok) board.pulse(to, 'var(--success)'); else board.shake();
        drawBoard(false);
      },
    });
  } else {
    // Any move on the board starts exploring "what if" from here (the game's own move just steps forward).
    const g = new Chess(fen);
    board.interactive({
      canPick: (sq) => g.get(sq)?.color === g.turn(),
      targets: (sq) => g.moves({ square: sq, verbose: true }).map((m) => m.to),
      onMove: (from, to) => {
        const mv = new Chess(fen).move({ from, to, promotion: 'q' });
        if (p < R.san.length && mv.san === R.san[p]) { go(p + 1); return; }
        RV.ex = { base: p, moves: [mv.san] };
        drawExplore();
      },
    });
  }
}

// ───────────────────────── explore: "what if I had played…" ─────────────────────────
let maiaP = null;
let maiaPct = 0;
function maia() {
  if (!maiaP) maiaP = Maia.load({ onProgress: (f) => { maiaPct = f; const el = $('#exMaia'); if (el) el.textContent = `Loading the human-move model… ${Math.round(f * 100)}%`; } }).catch((e) => { console.warn(e); maiaP = null; return null; });
  return maiaP;
}
const RANKC = ['#2f6fb3', '#3f9a63', '#c98a2e'];

function exFen() {
  const { R, ex } = RV;
  const { fens } = fensOf(R.san.slice(0, ex.base));
  const c = new Chess(fens[ex.base]);
  const moves = [];
  for (const s of ex.moves) moves.push(c.move(s));
  return { c, last: moves.at(-1) };
}

function drawExplore() {
  const { R, x, ex, board } = RV;
  const tk = ++RV.exTk || (RV.exTk = 1);
  RV.exTk = tk;
  const { c, last } = exFen();
  const fen = c.fen();
  board.setFen(fen, { lastMove: last ? [last.from, last.to] : [] });
  board.setArrows([]);
  board.badge(null);
  const theirTurn = c.turn() !== x.col;
  const oppName = x.opp;
  const label = (i) => moveLabel(ex.base + i);
  $('#rvc').innerHTML = `<div class="comment explore"><div class="cm-head"><span class="cm-chip" style="background:var(--engine)">?</span><div><b>What if…</b><span>exploring from ${ex.base ? `${moveLabel(ex.base - 1)}${esc(R.san[ex.base - 1])}` : 'the start'} · the game went ${ex.base < R.san.length ? esc(moveLabel(ex.base) + R.san[ex.base]) : 'no further'}</span></div><span class="cm-eval" id="exEval">…</span></div>
    <div class="ex-line">${ex.moves.map((m, i) => `<button data-i="${i}" class="${i === ex.moves.length - 1 ? 'cur' : ''}">${(ex.base + i) % 2 === 0 || i === 0 ? label(i) : ''}${esc(m)}</button>`).join('')}</div>
    <div id="exLines" class="ex-lines"><p class="note">Stockfish is thinking…</p></div>
    ${theirTurn ? `<div class="ex-replies"><div class="row"><span class="eyebrow">How ${esc(oppName)} would likely answer</span><span class="spacer"></span>${x.src === 'chess.com' && !RV.book ? `<button class="btn sm" id="exBook">Use ${esc(oppName)}'s own games</button>` : ''}</div><div id="exReplies"><p class="note" id="exMaia">${maiaPct && maiaPct < 1 ? `Loading the human-move model… ${Math.round(maiaPct * 100)}%` : 'Predicting human replies…'}</p></div></div>` : `<p class="note">Your move: try one, or pick an engine line.</p>`}
    <div class="row"><button class="btn sm" id="exUndo">◀ Undo</button><button class="btn sm ghost" id="exExit">Back to the game</button></div></div>`;
  $$('.ex-line button').forEach((b) => { b.onclick = () => { ex.moves = ex.moves.slice(0, +b.dataset.i + 1); drawExplore(); }; });
  $('#exUndo').onclick = () => { ex.moves.pop(); if (!ex.moves.length) { const p = ex.base; RV.ex = null; go(p); } else drawExplore(); };
  $('#exExit').onclick = () => go(ex.base);
  const bk = $('#exBook');
  if (bk) bk.onclick = async () => {
    bk.disabled = true;
    try {
      RV.book = await RV.C.opponentBook(oppName, (i, n) => { bk.textContent = `Loading ${oppName}'s games… ${i}/${n}`; });
      drawExplore();
    } catch (e) { bk.textContent = 'Could not load their games'; console.warn(e); }
  };
  board.interactive({
    canPick: (sq) => c.get(sq)?.color === c.turn(),
    targets: (sq) => c.moves({ square: sq, verbose: true }).map((m) => m.to),
    onMove: (from, to) => { const mv = new Chess(fen).move({ from, to, promotion: 'q' }); ex.moves.push(mv.san); drawExplore(); },
  });
  if (c.isGameOver()) { $('#exLines').innerHTML = `<p class="note">${c.isCheckmate() ? 'Checkmate.' : 'Draw.'}</p>`; return; }
  const state = { lines: [], human: null };
  const wtm = c.turn() === 'w';
  const paint = () => {
    if (tk !== RV.exTk || !RV.ex) return;
    const L = state.lines;
    if (L.length) {
      const top = L[0];
      const w0 = wp(top.score);
      const W = wtm ? w0 : 100 - w0;
      $('#evf').style.height = `${W}%`;
      $('#evb').classList.toggle('white-ahead', W >= 50);
      $('#evt').textContent = evalText(top.score, wtm);
      const ee = $('#exEval');
      if (ee) ee.textContent = evalText(top.score, wtm);
      $('#exLines').innerHTML = `<span class="eyebrow">Engine · depth ${top.depth || ''}</span>${L.map((l, i) => {
        const pv = pvToSan(fen, l.pv, 7);
        return `<button class="eline ex" data-san="${esc(pv[0] || '')}"><span class="rk" style="background:${RANKC[i]}">${i + 1}</span><span class="san">${esc(pv[0] || '')}</span><span class="ev">${evalText(l.score, wtm)}</span><span class="pv">${esc(pv.slice(1).join(' '))}</span></button>`;
      }).join('')}`;
      $$('#exLines [data-san]').forEach((b) => { b.onclick = () => { if (b.dataset.san) { ex.moves.push(b.dataset.san); drawExplore(); } }; });
    }
    const arrows = [];
    if (theirTurn && state.human) {
      state.human.slice(0, 3).forEach((h, i) => arrows.push({ from: h.uci.slice(0, 2), to: h.uci.slice(2, 4), color: '#8a63c9', width: 8 + 14 * h.p, opacity: 0.85, label: `${Math.round(h.p * 100)}`, key: `h${h.uci}` }));
      if (L[0]) arrows.push({ from: L[0].pv[0].slice(0, 2), to: L[0].pv[0].slice(2, 4), color: RANKC[0], width: 9, opacity: 0.6, dashed: true, key: `e${L[0].pv[0]}` });
    } else {
      L.slice(0, 3).forEach((l, i) => arrows.push({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), color: RANKC[i], width: 15 - i * 3, label: String(i + 1), key: `e${i}${l.pv[0]}` }));
    }
    RV.board.setArrows(arrows);
    if (theirTurn && state.human) {
      const evalOf = (uci) => L.find((l) => l.pv[0] === uci);
      $('#exReplies').innerHTML = state.human.slice(0, 5).map((h) => {
        const e = evalOf(h.uci);
        return `<button class="reply" data-san="${esc(h.san)}"><b>${esc(h.san)}</b><span class="rbar"><i style="width:${Math.round(h.p * 100)}%"></i></span><span class="rp">${Math.round(h.p * 100)}%</span><small>${h.maia != null ? `players at ${x.opR}: ${Math.round(h.maia * 100)}%` : ''}${h.book ? ` · ${esc(oppName)} played it ${h.book.n} of ${h.bookTotal}` : ''}${e ? ` · engine ${evalText(e.score, wtm)}` : ''}</small></button>`;
      }).join('') + (RV.book ? `<p class="note" style="margin:6px 0 0">Mixes ${esc(oppName)}'s own moves from ${plural(RV.book.games, 'recent game')} with how players rated ${x.opR} usually play.</p>` : `<p class="note" style="margin:6px 0 0">How players rated ${x.opR} usually play here (Maia-2).</p>`);
      $$('#exReplies [data-san]').forEach((b) => { b.onclick = () => { ex.moves.push(b.dataset.san); drawExplore(); }; });
    }
  };
  const q = interactiveQueue();
  q.clear();
  q.go(fen, { depth: 16, multipv: 3, movetime: 6000, onUpdate: (lines) => { state.lines = lines; paint(); } }).then((r) => { if (r) { state.lines = r.lines; paint(); } });
  if (theirTurn) {
    (async () => {
      const legal = c.moves({ verbose: true });
      const uci = legal.map((m) => m.from + m.to + (m.promotion || ''));
      let probs = null;
      const m = await maia();
      if (m) { try { probs = (await m.predict(fen, x.opR || 1500, x.myR || 1500, uci)).probs; } catch (e) { console.warn(e); } }
      if (tk !== RV.exTk) return;
      const key = fen.split(' ').slice(0, 4).join(' ');
      const bookE = RV.book?.book.get(key);
      const rows = legal.map((mv, i) => {
        const u = uci[i];
        const maiaP = probs ? probs.get(u) : null;
        const b = bookE?.moves.get(mv.san) || null;
        const bookP = bookE ? (b ? b.n / bookE.total : 0) : null;
        // Their own history counts more the more often they reached this position.
        const wBook = bookE ? Math.min(0.8, bookE.total / 6) : 0;
        const p = bookP != null ? wBook * bookP + (1 - wBook) * (maiaP ?? 0) : (maiaP ?? 0);
        return { uci: u, san: mv.san, p, maia: maiaP, book: b, bookTotal: bookE?.total || 0 };
      }).sort((a, b) => b.p - a.p);
      if (!probs && !bookE) { $('#exReplies').innerHTML = '<p class="note">The human-move model could not be loaded; showing engine lines only.</p>'; return; }
      state.human = rows;
      paint();
    })();
  }
}

/** Play the engine's best line from the position before ply i, then return. */
async function showLine(i) {
  const { R, board } = RV;
  const tk = RV.tk;
  const p = RV.p;
  const { fens } = fensOf(R.san.slice(0, i + 1));
  const pv = R.ev[i].pv || [];
  const c = new Chess(fens[i]);
  board.setFen(c.fen(), { lastMove: [] });
  board.setArrows([]);
  board.badge(null);
  for (const s of pv.slice(0, 6)) {
    await sleep(650);
    if (tk !== RV.tk || RV.p !== p) return;
    let mv;
    try { mv = c.move(s); } catch { break; }
    board.setFen(c.fen(), { lastMove: [mv.from, mv.to] });
  }
  await sleep(1400);
  if (tk === RV.tk && RV.p === p) drawBoard();
}

addEventListener('keydown', (e) => {
  if (!RV.R || !$('#rvBoard') || RV.retry || e.target.closest?.('input, select, textarea')) return;
  if (RV.ex) {
    if (e.key === 'ArrowLeft') { RV.ex.moves.pop(); if (!RV.ex.moves.length) go(RV.ex.base); else drawExplore(); }
    if (e.key === 'Escape') go(RV.ex.base);
    return;
  }
  if (e.key === 'ArrowLeft') go(RV.p - 1);
  else if (e.key === 'ArrowRight') go(RV.p + 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(RV.R.san.length);
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'n' || e.key === 'N') RV.stepMoment?.(1);
  else if (e.key === 'p' || e.key === 'P') RV.stepMoment?.(-1);
});

// ───────────────────────── Insights ─────────────────────────
export function renderInsights(view, C, S, { quiet = false } = {}) {
  if (!C.games.length) {
    view.innerHTML = `<span class="eyebrow">Analyse</span><h1 class="h1">Where your games are decided</h1><p class="lede">Import your games in <a class="link" href="#games">Games</a> first. Insights fill in as the games are reviewed in the background.</p>`;
    return;
  }
  const L = filterGames(C.games, S.f);
  const ES = insightStats(L, C.an);
  const done = L.filter((x) => C.an[x.id]).length;
  let h = `<span class="eyebrow">Analyse</span><h1 class="h1">Where your games are decided</h1>
    <p class="lede">Patterns across every reviewed game: where blunders happen, the chances you miss, and the material you give up. This fills in by itself as games are reviewed.</p>
    ${filtersHTML(S, C.games)}
    <div class="rv-summary rise"><div><b data-count="${done}">${done}</b><span>of ${L.length} games in this filter analysed</span><div class="progress"><i style="width:${(100 * done) / Math.max(1, L.length)}%"></i></div></div></div>`;
  if (ES) {
    const ph = ES.ph;
    const mx = Math.max(1, ph.Opening, ph.Middlegame, ph.Endgame);
    const buckets = [['1–10', 1, 10], ['11–20', 11, 20], ['21–30', 21, 30], ['31+', 31, 999]].map(([t, a, b]) => [t, ES.firstAll.filter((v) => v >= a && v <= b).length]);
    const mf = Math.max(1, ...buckets.map((b) => b[1]));
    h += `<div class="tiles"><div class="tile rise"><b data-count="${(ES.bl / ES.g).toFixed(1)}" data-fmt="dec">${(ES.bl / ES.g).toFixed(1)}</b><span>blunders per game</span></div>
      <div class="tile rise"><b data-count="${(ES.ms / ES.g).toFixed(1)}" data-fmt="dec">${(ES.ms / ES.g).toFixed(1)}</b><span>missed punishments per game</span></div><div class="tile rise"><b>${ES.firstMed ?? '–'}</b><span>typical first-blunder move</span></div>
      <div class="tile rise"><b data-count="${ES.avg.toFixed(1)}" data-fmt="dec">${ES.avg.toFixed(1)}</b><span>win chance lost per move</span></div><div class="tile rise"><b>${ES.noBl}</b><span>games with no blunder</span></div></div>
      <div class="numbers">
        <div class="panel-card rise"><span class="eyebrow">Where your blunders happen</span>${Object.entries(ph).map(([k, v]) => `<div class="hbar"><span>${k}</span><div><i data-w="${(100 * v) / mx}"></i></div><span>${v}</span></div>`).join('')}</div>
        <div class="panel-card rise"><span class="eyebrow">First blunder, by move</span>${buckets.map(([k, v]) => `<div class="hbar"><span>Move ${k}</span><div><i data-w="${(100 * v) / mf}"></i></div><span>${v}</span></div>`).join('')}${ES.clkN ? `<p class="note" style="margin:8px 0 0">${ES.low} of ${ES.clkN} blunders with clock data came with under a minute left.</p>` : ''}</div>
      </div>
      <h2 class="h2">Find the move you missed</h2><p class="note">Your biggest errors. Work out the best move, then reveal it, or open the game at that moment.</p><div class="pos-list" id="pz"></div>
      <h2 class="h2">Punishments you missed</h2><div class="pos-list" id="ms"></div>
      <h2 class="h2">Material you gave up</h2><p class="note">${ES.sac.filter((s) => s.sound).length} of ${ES.sac.length} kept the evaluation roughly level. This also catches plainly hung pieces.</p><div class="pos-list" id="sc"></div>`;
  }
  view.innerHTML = h;
  if (!quiet) { stagger(view); countUp(view); }
  requestAnimationFrame(() => $$('.hbar i', view).forEach((i) => { i.style.width = `${i.dataset.w}%`; }));
  bindFilters(S, view, () => renderInsights(view, C, S));
  if (!ES) return;
  const card = (q, title, sub, i, kind) => `<div class="pos rise">${miniBoard(q.fen, q.col)}<div style="min-width:0"><h3 class="h3">${esc(title)}</h3><p>${esc(sub)}</p>
    <div class="row"><button class="btn sm" data-rv="${kind}${i}">Show best move</button><a class="btn sm" href="#review/${encodeURIComponent(q.u || '')}/${(q.ply ?? -1) + 1}">Open the game</a></div><p class="reveal" id="rv${kind}${i}" hidden>Best: ${esc(q.best || 'not available')}</p></div></div>`;
  $('#pz').innerHTML = ES.blunders.slice(0, 8).map((b, i) => card(b, `Move ${b.mv}: you played ${b.san}`, `Cost ${b.drop} points of win chance in the ${b.phase.toLowerCase()}.`, i, 'p')).join('') || '<p class="note">No blunders found.</p>';
  $('#ms').innerHTML = ES.missed.slice(0, 6).map((b, i) => card(b, `Move ${b.mv}: after …${b.opp}, you played ${b.san}`, `Your reply gave back ${b.drop} points of win chance.`, i, 'm')).join('') || '<p class="note">None found.</p>';
  $('#sc').innerHTML = ES.sac.slice(-6).reverse().map((b, i) => card(b, `Move ${b.mv}: ${b.san}, down ${b.net} points after the exchange`, b.sound ? 'The engine kept this roughly level.' : `It cost ${b.drop} points of win chance.`, i, 's')).join('') || '<p class="note">None found.</p>';
  $$('[data-rv]', view).forEach((b) => { b.onclick = () => { $(`#rv${b.dataset.rv}`).hidden = false; b.hidden = true; C.log('insight', b.dataset.rv + (location.hash || '')); }; });
  if (!quiet) stagger(view);
}

export { pct, sanLine, pvToSan };
