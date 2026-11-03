// Review (one game, move by move, with move classes) and Insights (engine batch over many games).
import { Chess } from '../../vendor/chess.js';
import { Engine } from '../engine.js';
import { AnimBoard } from './animboard.js';
import { $, $$, esc, miniBoard, countUp, stagger, when } from './ui.js';
import { EngineQueue, reviewGame, reviewComment, insightGame, insightStats, CLASSES, CLASS_ORDER, ERROR_CLASSES, bookPlies, fensOf, wp, evalText } from './analysis.js';
import { filterGames, plural } from './games.js';
import { filtersHTML, bindFilters } from './filters.js';
import { store } from './store.js';
import { moveLabel } from './library.js';

const ENGINE_URL = new URL('../../engine/stockfish-19-lite-single.js', import.meta.url).href;
let iq = null;
/** Engine for interactive work on this page (separate from the background analyser). */
export function interactiveQueue() {
  if (!iq) iq = new EngineQueue(new Engine(ENGINE_URL));
  return iq;
}

const rvName = (id) => `rv-${String(id).replace(/[^A-Za-z0-9_-]/g, '-').slice(-70)}`;
const RV = { tk: 0, idx: null, show: 40, x: null, R: null, p: 0, retry: false, sel: null, msg: '' };
const chip = (k) => `<span class="sym" style="background:${CLASSES[k].color}">${CLASSES[k].sym}</span>`;

async function index(C) {
  if (RV.idx && RV.idxUser === C.user) return RV.idx;
  RV.idx = (C.user && (await store.get(`rvidx-${C.user.toLowerCase()}`).catch(() => null))) || {};
  RV.idxUser = C.user;
  return RV.idx;
}

export async function renderReview(view, C, S, args = []) {
  RV.view = view;
  RV.C = C;
  RV.S = S;
  if (args[0]) {
    const x = C.games.find((g) => g.id === args[0]) || (C.games.length ? null : undefined);
    if (x) { openGame(x, args[1] != null ? +args[1] : null); return; }
    if (x === undefined && C.user) { view.innerHTML = '<p class="note">Loading games…</p>'; await C.loadGames().catch(() => null); return renderReview(view, C, S, args); }
  }
  RV.x = null;
  RV.tk++;
  if (!C.games.length) {
    view.innerHTML = `<span class="eyebrow">Review</span><h1 class="h1">Game review</h1><p class="lede">Import your games in <a class="link" href="#games">Games</a> first.</p>`;
    return;
  }
  const idx = await index(C);
  const L = filterGames(C.games, S.f).slice().reverse();
  view.innerHTML = `<span class="eyebrow">Review</span><h1 class="h1">Game review</h1><p class="lede">Pick a game. Stockfish reviews it in your browser, labels every move, and saves the result.</p>
    ${filtersHTML(S, C.games)}
    <div class="game-list">${L.slice(0, RV.show).map((x) => {
      const res = x.sc === 1 ? 'var(--win)' : x.sc === 0.5 ? 'var(--draw)' : 'var(--loss)';
      const acc = idx[x.id] ? `${idx[x.id][x.col]}%` : '';
      return `<button class="game-row rise" data-gid="${esc(x.id)}"><span class="res" style="background:${res}"></span><span style="min-width:0"><b>${esc(x.opp)} (${x.opR})</b> · ${x.col === 'w' ? 'White' : 'Black'}<small>${esc(x.fam)} · ${esc(x.tc)} · ${when(x.t)}</small></span><span class="acc">${acc ? `${acc}<small>accuracy</small>` : '<small>Review →</small>'}</span></button>`;
    }).join('') || '<p class="note">No games match these filters.</p>'}</div>
    ${L.length > RV.show ? `<button class="btn" id="more" style="margin-top:10px;width:100%">Show more (${L.length - RV.show} left)</button>` : ''}`;
  stagger(view, 20);
  bindFilters(S, view, () => renderReview(view, C, S));
  const mo = $('#more');
  if (mo) mo.onclick = () => { RV.show += 60; renderReview(view, C, S); };
  $$('[data-gid]', view).forEach((b) => { b.onclick = () => { location.hash = `review/${encodeURIComponent(b.dataset.gid)}`; }; });
}

async function openGame(x, startP) {
  const { view, C } = RV;
  const tk = ++RV.tk;
  RV.x = x;
  RV.R = null;
  RV.retry = false;
  const s = x.sans;
  view.innerHTML = `<a class="link" href="#review">← All games</a><h1 class="h1" style="margin-top:12px">Reviewing your game</h1><p class="note" id="rvp">Starting Stockfish…</p><div class="progress" style="max-width:520px"><i id="rvb0"></i></div>`;
  let R = await store.get(rvName(x.id)).catch(() => null);
  if (!R) {
    let seen = 0;
    const libPly = C.lib.walk(x.col, s).ply;
    R = await reviewGame(interactiveQueue(), s, {
      depth: 14,
      bookPlies: bookPlies(x, libPly),
      isCancelled: () => tk !== RV.tk,
      tick: () => {
        seen++;
        const b = $('#rvb0');
        const t = $('#rvp');
        if (b) b.style.width = `${(100 * seen) / (s.length + 1)}%`;
        if (t) t.textContent = `Analysing position ${seen} of ${s.length + 1}`;
      },
    });
    if (!R) return;
    await store.set(rvName(x.id), R);
    const idx = await index(C);
    idx[x.id] = R.acc;
    await store.set(`rvidx-${C.user.toLowerCase()}`, idx);
  }
  if (tk !== RV.tk) return;
  RV.R = R;
  const first = R.cl.findIndex((c, i) => ['blunder', 'miss', 'mistake'].includes(c) && (i % 2 === 0) === (x.col === 'w'));
  RV.p = startP != null && startP >= 0 ? startP : first >= 0 ? first + 1 : 0;
  drawReview();
}

function graph(R) {
  const W = 600, H = 96, n = R.ev.length - 1 || 1;
  const X = (i) => (i * W) / n;
  const Y = (w) => H * (1 - w / 100);
  const pts = R.ev.map((e, i) => `${X(i).toFixed(1)},${Y(e.w).toFixed(1)}`).join(' ');
  const dots = R.cl.map((c, i) => (['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(c) ? `<circle cx="${X(i + 1)}" cy="${Y(R.ev[i + 1].w)}" r="4" fill="${CLASSES[c].color}"/>` : '')).join('');
  return `<div class="evgraph" id="rvg"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Win chance through the game"><rect width="${W}" height="${H}" fill="#14121f"/><polygon points="0,${H} ${pts} ${W},${H}" fill="#f6efe8"/><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#8b94a6" stroke-dasharray="4"/>${dots}<line id="rvcur" y1="0" y2="${H}" stroke="var(--cta)" stroke-width="3"/></svg></div>`;
}

function drawReview() {
  const { R, x, view } = RV;
  const g = x.g || {};
  const cc = g.accuracies;
  const cnt = { w: {}, b: {} };
  R.cl.forEach((c, i) => { const sd = i % 2 ? 'b' : 'w'; cnt[sd][c] = (cnt[sd][c] || 0) + 1; });
  view.innerHTML = `<a class="link" href="#review">← All games</a>
    <h1 class="h1" style="margin-top:12px">${esc(g.white?.username || '')} vs ${esc(g.black?.username || '')}</h1>
    <p class="note">${esc(x.name)} · ${x.sc === 1 ? 'You won' : x.sc === 0.5 ? 'Draw' : 'You lost'} · ${when(x.t)}${x.url ? ` · <a class="link" href="${esc(x.url)}" target="_blank" rel="noopener">Open on chess.com</a>` : ''}</p>
    <div class="tiles"><div class="tile"><b data-count="${R.acc.w}" data-fmt="dec">${R.acc.w}</b><span>White accuracy${x.col === 'w' ? ' (you)' : ''}${cc?.white != null ? ` · chess.com ${cc.white.toFixed(1)}` : ''}</span></div>
      <div class="tile"><b data-count="${R.acc.b}" data-fmt="dec">${R.acc.b}</b><span>Black accuracy${x.col === 'b' ? ' (you)' : ''}${cc?.black != null ? ` · chess.com ${cc.black.toFixed(1)}` : ''}</span></div></div>
    ${graph(R)}
    <div class="review" style="margin-top:16px">
      <div><div class="rv-board"><div class="evalbar" id="evb"><div class="evalbar-fill" id="evf"></div><span class="evalbar-label" id="evt"></span></div><div id="rvBoard"></div></div>
        <div class="board-ctl"><button class="btn icon" id="r0">⏮</button><button class="btn icon" id="r1">◀</button><button class="btn icon" id="r2">▶</button><button class="btn icon" id="r3">⏭</button></div></div>
      <div class="rv-side"><div id="rvc"></div>
        <div class="row"><button class="btn sm" id="rPrev">← Previous error</button><button class="btn sm" id="rNext">Next error →</button><button class="btn sm" id="rRetry">Try this move again</button></div>
        <div class="mvt" id="rvm"></div></div>
    </div>
    <h2 class="h2">Move counts</h2>
    <div class="counts"><b class="r">White</b><span></span><b class="l">Black</b>${CLASS_ORDER.map((k) => `<span class="r" style="color:${CLASSES[k].color}">${cnt.w[k] || 0}</span><span class="c">${chip(k)}${CLASSES[k].label}</span><span class="l" style="color:${CLASSES[k].color}">${cnt.b[k] || 0}</span>`).join('')}</div>
    <p class="note">Labels and accuracy use this app's own formula (chess.com doesn't publish theirs), so numbers can differ from chess.com's.</p>`;
  countUp(view);
  RV.board = new AnimBoard($('#rvBoard'), { orientation: x.col });
  $('#evb').classList.toggle('flipped', x.col === 'b');
  $('#r0').onclick = () => go(0);
  $('#r1').onclick = () => go(RV.p - 1);
  $('#r2').onclick = () => go(RV.p + 1);
  $('#r3').onclick = () => go(R.san.length);
  const errs = () => R.cl.map((c, i) => [c, i]).filter(([c, i]) => ERROR_CLASSES.includes(c) && (i % 2 === 0) === (x.col === 'w')).map(([, i]) => i + 1);
  $('#rNext').onclick = () => { const e = errs().find((v) => v > RV.p); if (e) go(e); };
  $('#rPrev').onclick = () => { const e = errs().reverse().find((v) => v < RV.p); if (e) go(e); };
  $('#rRetry').onclick = () => { if (RV.p < 1) return; RV.retry = true; RV.msg = 'Your move: find something better.'; drawBoard(); };
  const gs = $('#rvg');
  gs.onclick = (e) => { const r = gs.getBoundingClientRect(); go(Math.round(((e.clientX - r.left) / r.width) * R.san.length)); };
  const rows = [];
  for (let i = 0; i < R.san.length; i += 2) {
    rows.push(`<span>${i / 2 + 1}.</span>${[i, i + 1].map((j) => (j < R.san.length ? `<button data-p="${j + 1}">${chip(R.cl[j])}${esc(R.san[j])}</button>` : '<span></span>')).join('')}`);
  }
  $('#rvm').innerHTML = rows.join('');
  $('#rvm').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) go(+b.dataset.p); };
  drawBoard(false);
  scrollTo({ top: 0 });
}

function go(p) {
  if (!RV.R) return;
  RV.p = Math.max(0, Math.min(RV.R.san.length, p));
  RV.retry = false;
  drawBoard();
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
  if (!retry && i >= 0) board.badge(last[1], CLASSES[R.cl[i]].sym, CLASSES[R.cl[i]].color); else board.badge(null);
  const e = R.ev[retry ? p - 1 : p];
  $('#evf').style.height = `${e.w}%`;
  $('#evb').classList.toggle('white-ahead', e.w >= 50);
  $('#evt').textContent = e.t || '';
  const cx = (p * 600) / (R.ev.length - 1 || 1);
  $('#rvcur').setAttribute('x1', cx);
  $('#rvcur').setAttribute('x2', cx);
  let html;
  if (retry) html = `<div class="comment"><h3>Try again</h3><p>${esc(RV.msg)}</p></div>`;
  else if (i < 0) html = '<div class="comment"><h3>Starting position</h3><p>Use the arrows, tap a move, or tap the graph.</p></div>';
  else {
    const q = reviewComment(R, i, x.fam);
    html = `<div class="comment"><h3>${chip(q.k)}${esc(moveLabel(i) + R.san[i])} is ${q.k === 'book' ? 'a book move' : `${/^[aeiou]/.test(q.k) ? 'an' : 'a'} ${CLASSES[q.k].label.toLowerCase()}`}</h3><p>${esc(q.text)}</p>${q.line ? `<p class="note">Best line: ${esc(q.line)}</p>` : ''}</div>`;
  }
  $('#rvc').innerHTML = html;
  $$('#rvm button').forEach((b) => { const c = +b.dataset.p === p; b.classList.toggle('cur', c); if (c) b.scrollIntoView({ block: 'nearest' }); });
  $('#r0').disabled = p === 0;
  $('#r1').disabled = p === 0;
  $('#r2').disabled = p === R.san.length;
  $('#r3').disabled = p === R.san.length;
  $('#rRetry').disabled = p < 1 || ((p - 1) % 2 === 0) !== (x.col === 'w');
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
        $('#rvc').innerHTML = `<div class="comment"><h3>Checking ${esc(mv.san)}…</h3></div>`;
        let after = 100;
        if (t.isDraw()) after = 50;
        else if (!t.isCheckmate()) { const r = await interactiveQueue().go(t.fen(), { depth: 14 }); after = 100 - wp(r.score); }
        const before = (p - 1) % 2 === 0 ? R.ev[p - 1].w : 100 - R.ev[p - 1].w;
        const l = Math.max(0, before - after);
        RV.msg = mv.san === R.ev[p - 1].bs ? `${mv.san} is the best move.` : l < 5 ? `${mv.san} is good, and costs only about ${Math.round(l)} points.` : `${mv.san} still costs about ${Math.round(l)} points of win chance. Try again.`;
        drawBoard();
      },
    });
  } else board.interactive(null);
}

addEventListener('keydown', (e) => {
  if (!RV.R || !$('#rvBoard') || RV.retry || e.target.closest?.('input, select')) return;
  if (e.key === 'ArrowLeft') go(RV.p - 1);
  if (e.key === 'ArrowRight') go(RV.p + 1);
});

// ───────────────────────── Insights ─────────────────────────
const IN = { run: false, prog: 0, txt: '', n: 30, d: 10 };

export async function renderInsights(view, C, S) {
  if (!C.games.length) {
    view.innerHTML = `<span class="eyebrow">Insights</span><h1 class="h1">Engine insights</h1><p class="lede">Import your games in <a class="link" href="#games">Games</a> first.</p>`;
    return;
  }
  const L = filterGames(C.games, S.f);
  const ES = insightStats(L, S.an);
  const todo = L.filter((x) => !S.an[x.id]).length;
  let h = `<span class="eyebrow">Insights</span><h1 class="h1">Where your games are decided</h1>
    <p class="lede">Stockfish runs through your games in the browser and finds blunders, missed punishments and the material you gave up.</p>
    ${filtersHTML(S, C.games)}
    <div class="row" style="margin-bottom:8px"><select class="select" id="eN">${[10, 30, 100, 300].map((n) => `<option ${n === IN.n ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="note">games</span>
      <select class="select" id="eD">${[[8, 'Depth 8 · fast'], [10, 'Depth 10 · balanced'], [12, 'Depth 12 · slower']].map(([v, t]) => `<option value="${v}" ${v === IN.d ? 'selected' : ''}>${t}</option>`).join('')}</select>
      ${IN.run ? '<button class="btn" id="eStop">Stop</button>' : `<button class="btn cta" id="eStart" ${todo ? '' : 'disabled'}>Analyse newest games</button>`}</div>
    <p class="note">${todo} of ${L.length} games in this filter are not analysed yet. Finished games are saved.</p>
    ${IN.run ? '<div class="progress" style="max-width:520px"><i id="pgb"></i></div>' : ''}<p class="note" id="pgt">${esc(IN.txt)}</p>`;
  if (ES) {
    const ph = ES.ph;
    const mx = Math.max(1, ph.Opening, ph.Middlegame, ph.Endgame);
    const buckets = [['1-10', 1, 10], ['11-20', 11, 20], ['21-30', 21, 30], ['31+', 31, 999]].map(([t, a, b]) => [t, ES.firstAll.filter((v) => v >= a && v <= b).length]);
    const mf = Math.max(1, ...buckets.map((b) => b[1]));
    h += `<div class="tiles"><div class="tile rise"><b data-count="${ES.g}">${ES.g}</b><span>games analysed</span></div><div class="tile rise"><b data-count="${(ES.bl / ES.g).toFixed(1)}" data-fmt="dec"></b><span>blunders per game</span></div>
      <div class="tile rise"><b data-count="${(ES.ms / ES.g).toFixed(1)}" data-fmt="dec"></b><span>missed punishments per game</span></div><div class="tile rise"><b>${ES.firstMed ?? '–'}</b><span>typical first-blunder move</span></div>
      <div class="tile rise"><b data-count="${ES.avg.toFixed(1)}" data-fmt="dec"></b><span>win chance lost per move</span></div></div>
      <p class="note">A blunder costs at least 15 points of win chance. Compare runs at the same depth.</p>
      <h2 class="h2">Where your blunders happen</h2>${Object.entries(ph).map(([k, v]) => `<div class="hbar"><span>${k}</span><div><i data-w="${(100 * v) / mx}"></i></div><span>${v}</span></div>`).join('')}
      <h2 class="h2">First blunder, by move</h2>${buckets.map(([k, v]) => `<div class="hbar"><span>Move ${k}</span><div><i data-w="${(100 * v) / mf}"></i></div><span>${v}</span></div>`).join('')}
      <p class="note">${ES.noBl} games had no blunder.${ES.clkN ? ` ${ES.low} of ${ES.clkN} blunders with clock data came with under a minute left.` : ''}</p>
      <h2 class="h2">Find the move you missed</h2><p class="note">Your biggest errors. Work out the best move, then reveal it.</p><div class="pos-list" id="pz"></div>
      <h2 class="h2">Punishments you missed</h2><div class="pos-list" id="ms"></div>
      <h2 class="h2">Material you gave up</h2><p class="note">${ES.sac.filter((s) => s.sound).length} of ${ES.sac.length} kept the evaluation roughly level. This also catches plainly hung pieces.</p><div class="pos-list" id="sc"></div>`;
  }
  view.innerHTML = h;
  stagger(view);
  countUp(view);
  requestAnimationFrame(() => $$('.hbar i', view).forEach((i) => { i.style.width = `${i.dataset.w}%`; }));
  bindFilters(S, view, () => renderInsights(view, C, S));
  $('#eN').onchange = (e) => { IN.n = +e.target.value; };
  $('#eD').onchange = (e) => { IN.d = +e.target.value; };
  const st = $('#eStart');
  if (st) st.onclick = () => runBatch(view, C, S);
  const sp = $('#eStop');
  if (sp) sp.onclick = () => { IN.run = false; interactiveQueue().clear(); };
  if (!ES) return;
  const card = (q, title, sub, i, kind) => `<div class="pos rise">${miniBoard(q.fen, q.col)}<div style="min-width:0"><h3 class="h3">${esc(title)}</h3><p>${esc(sub)}</p>
    <div class="row"><button class="btn sm" data-rv="${kind}${i}">Show best move</button><a class="btn sm" href="#review/${encodeURIComponent(q.u || '')}/${(q.ply ?? -1) + 1}">Review game</a></div><p class="reveal" id="rv${kind}${i}" hidden>Best: ${esc(q.best || 'not available')}</p></div></div>`;
  $('#pz').innerHTML = ES.blunders.slice(0, 8).map((b, i) => card(b, `Move ${b.mv}: you played ${b.san}`, `Cost ${b.drop} points of win chance in the ${b.phase.toLowerCase()}.`, i, 'p')).join('') || '<p class="note">No blunders found.</p>';
  $('#ms').innerHTML = ES.missed.slice(0, 6).map((b, i) => card(b, `Move ${b.mv}: after …${b.opp}, you played ${b.san}`, `Your reply gave back ${b.drop} points of win chance.`, i, 'm')).join('') || '<p class="note">None found.</p>';
  $('#sc').innerHTML = ES.sac.slice(-6).reverse().map((b, i) => card(b, `Move ${b.mv}: ${b.san}, down ${b.net} points after the exchange`, b.sound ? 'The engine kept this roughly level.' : `It cost ${b.drop} points of win chance.`, i, 's')).join('') || '<p class="note">None found.</p>';
  $$('[data-rv]', view).forEach((b) => { b.onclick = () => { $(`#rv${b.dataset.rv}`).hidden = false; b.hidden = true; }; });
}

async function runBatch(view, C, S) {
  const L = filterGames(C.games, S.f).filter((x) => !S.an[x.id] || S.an[x.id].d < IN.d).slice(-IN.n).reverse();
  if (!L.length) { IN.txt = 'All selected games are already analysed.'; renderInsights(view, C, S); return; }
  IN.run = true;
  C.pause(true);
  let doneN = 0;
  const plies = L.reduce((a, x) => a + x.sans.length + 1, 0);
  let seen = 0;
  renderInsights(view, C, S);
  for (const x of L) {
    if (!IN.run) break;
    if (!x.sans.length) { doneN++; continue; }
    IN.txt = `Game ${doneN + 1} of ${L.length}`;
    const r = await insightGame(interactiveQueue(), x, IN.d, {
      isCancelled: () => !IN.run,
      tick: () => { seen++; const b = $('#pgb'); if (b) b.style.width = `${Math.round((100 * seen) / plies)}%`; const t = $('#pgt'); if (t) t.textContent = IN.txt; },
    }).catch((e) => { console.error(e); return null; });
    if (r) { S.an[x.id] = r; doneN++; if (doneN % 3 === 0) await store.set(`an-${C.user.toLowerCase()}`, S.an); }
  }
  IN.run = false;
  C.pause(false);
  await store.set(`an-${C.user.toLowerCase()}`, S.an);
  IN.txt = `Analysed ${plural(doneN, 'game')}.`;
  if (location.hash.startsWith('#insights')) renderInsights(view, C, S);
}

export { evalText };
