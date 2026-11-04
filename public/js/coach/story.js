// The study story for one discovery: five animated scenes, then the line joins your library.
//   1 The moment      the line replays on the board; how often your games got here
//   2 Your answers    what you played, how often, and how it went
//   3 Engine's view   win-chance scale with the engine's moves and yours, the best move drawn
//   4 The idea        the engine's line plays out with an evaluation sparkline; choose your move
//   5 Practice        play it from memory; on success the line is added to the library
import { Chess } from '../../vendor/chess.js';
import { AnimBoard, sleep, reducedMotion } from './animboard.js';
import { $, $$, esc, countUp, ring, since, miniBoard, toast } from './ui.js';
import { CLASSES, evalText } from './analysis.js';
import { fenOf, studiedLine } from './discoveries.js';
import { moveLabel, sanLine } from './library.js';
import { pct, plural } from './games.js';

const SCENES = ['The moment', 'Your answers', "The engine's view", 'The idea', 'Practice'];
const ENGINE = 'var(--engine)';
const YOU = 'var(--you)';
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || name;

let st = null;

export function openStory(C, id, { onClose } = {}) {
  const el = $('#story');
  const it = C.get(id);
  if (!it) { toast('That position is no longer in Discoveries'); onClose?.(); return; }
  if (st) cleanup();
  st = { C, id, it, el, scene: 0, tk: 0, chosen: null, onClose, done: false };
  window.__story = st;
  el.hidden = false;
  el.classList.remove('closing');
  el.innerHTML = `<div class="story-card">
      <div class="story-stage"><div class="story-board" id="sBoard"></div><div class="story-caption" id="sCap"></div></div>
      <div class="story-side">
        <div class="story-top"><span class="eyebrow" id="sEyebrow"></span><button class="icon-btn story-close" id="sClose" aria-label="Close (Esc)">✕</button></div>
        <div class="scene-wrap" id="sWrap"></div>
        <div class="story-foot"><div class="pills" id="sPills">${SCENES.map((t, i) => `<button data-i="${i}" title="${t}" aria-label="${t}"></button>`).join('')}</div>
          <span class="spacer"></span><button class="btn" id="sBack">Back</button><button class="btn cta" id="sNext">Next <span class="arrow">→</span></button></div>
      </div></div>`;
  st.board = new AnimBoard($('#sBoard'), { orientation: it.side, glide: 280 });
  $('#sEyebrow').textContent = eyebrow(it);
  $('#sClose').onclick = close;
  $('#sBack').onclick = () => go(st.scene - 1);
  $('#sNext').onclick = () => (st.scene === 4 && st.done ? nextDiscovery() : go(st.scene + 1));
  $('#sPills').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) go(+b.dataset.i); };
  el.onclick = (e) => { if (e.target === el) close(); };
  st.onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.target.closest?.('input')) return;
    else if (e.key === 'ArrowRight' && st.scene < 4) go(st.scene + 1);
    else if (e.key === 'ArrowLeft' && st.scene > 0) go(st.scene - 1);
  };
  addEventListener('keydown', st.onKey);
  st.onChange = () => {
    const fresh = C.get(id);
    if (!fresh) return;
    const wasReady = !!st.it.analysis && st.it.status !== 'new';
    st.it = fresh;
    if (!wasReady && fresh.status !== 'new' && st.scene >= 2 && st.scene <= 3) show(st.scene, true);
  };
  st.onProgress = () => { if (st.scene >= 2 && st.it.status === 'new') paintWaiting(); };
  C.addEventListener('change', st.onChange);
  C.addEventListener('progress', st.onProgress);
  document.body.style.overflow = 'hidden';
  show(0);
  $('#sClose').focus({ preventScroll: true });
}

function eyebrow(it) {
  const lib = st.C.lib.describe(it.side, st.C.lib.nodeAfter(it.side, it.path));
  return [it.opening || lib.chapter || 'Your openings', it.side === 'w' ? 'You play White' : 'You play Black'].join(' · ');
}

function cleanup() {
  if (!st) return;
  st.tk++;
  removeEventListener('keydown', st.onKey);
  st.C.removeEventListener('change', st.onChange);
  st.C.removeEventListener('progress', st.onProgress);
  document.body.style.overflow = '';
}

function close() {
  if (!st) return;
  const { el, onClose } = st;
  cleanup();
  st = null;
  el.classList.add('closing');
  setTimeout(() => { el.hidden = true; el.innerHTML = ''; el.classList.remove('closing'); }, reducedMotion() ? 0 : 240);
  onClose?.();
}

function nextDiscovery() {
  const C = st.C;
  const next = C.list().find((s) => s.id !== st.id && (s.status === 'ready' || s.status === 'new'));
  if (!next) { close(); return; }
  const onClose = st.onClose;
  cleanup();
  st = null;
  history.replaceState(null, '', `#discoveries/${next.id}`);
  openStory(C, next.id, { onClose });
}

function go(i) {
  if (!st || i < 0 || i > 4 || i === st.scene) return;
  show(i);
}

async function show(i, keepBoard = false) {
  const s = st;
  s.tk++;
  const prev = s.scene;
  s.scene = i;
  $$('#sPills button').forEach((b, k) => { b.classList.toggle('on', k === i); b.classList.toggle('done', k < i); });
  $('#sBack').disabled = i === 0;
  $('#sNext').innerHTML = i === 4 ? (s.done ? 'Next discovery <span class="arrow">→</span>' : 'Next <span class="arrow">→</span>') : i === 3 ? 'Practice <span class="arrow">→</span>' : 'Next <span class="arrow">→</span>';
  $('#sNext').disabled = i === 4 && !s.done;
  const wrap = $('#sWrap');
  const old = wrap.firstElementChild;
  if (old && prev !== i && !reducedMotion()) { old.classList.add('out'); await sleep(170); }
  if (s !== st || s.scene !== i) return;
  wrap.innerHTML = `<div class="scene">${[scene0, scene1, scene2, scene3, scene4][i]()}</div>`;
  wrap.scrollTop = 0;
  s.board.interactive(null);
  s.board.clearFx();
  countUp(wrap);
  [play0, play1, play2, play3, play4][i](s.tk, keepBoard);
}

const alive = (tk) => st && st.tk === tk;
const caption = (html) => { const c = $('#sCap'); if (c) c.innerHTML = html; };
const positionBefore = (it) => { const c = new Chess(); for (const s of it.path) c.move(s); return c; };

// ───────────────────────── 1 · the moment ─────────────────────────
function funnelRows(it) {
  const games = st.C.games.filter((g) => g.col === it.side);
  const line = [...it.path, it.move];
  const rows = [];
  let pool = games;
  for (let i = 0; i < line.length; i++) {
    pool = pool.filter((g) => g.sans[i] === line[i]);
    rows.push({ i, san: line[i], n: i === line.length - 1 ? Math.max(pool.length, it.n) : Math.max(pool.length, it.n) });
  }
  return rows;
}

function scene0() {
  const it = st.it;
  const rows = funnelRows(it);
  const top = Math.max(1, rows[0]?.n || 1);
  const shown = rows.slice(-12);
  const a = it.a;
  return `<h1 class="h1">They played <em>${esc(it.label)}</em>.</h1>
    <p>This position isn't in your library yet. ${it.n === 1 ? 'It came up once' : `It came up in ${it.n} of your games`}${it.firstSeen ? `, first on ${since(it.firstSeen)}` : ''}.</p>
    <div class="stat-row">
      <div class="stat"><b data-count="${it.n}">${it.n}</b><span>${it.n === 1 ? 'game' : 'games'}</span></div>
      <div class="stat"><b data-count="${a.n ? Math.round(a.sc * 100) : 0}" data-fmt="pct">${a.n ? pct(a.sc) : '–'}</b><span>your score${a.n ? ` · ${pct(a.ex)} expected` : ''}</span></div>
      <div class="stat"><b>${since(it.last) || '–'}</b><span>last time</span></div>
    </div>
    ${st.C.games.length ? `<p class="eyebrow">How your games got here</p>
    <div class="funnel" id="funnel">${shown.map((r) => `<div class="funnel-row ${r.i === rows.length - 1 ? 'cur' : ''}" data-i="${r.i}"><span class="mv ${(r.i % 2 === 0) === (it.side === 'w') ? 'you' : ''}">${moveLabel(r.i)}${esc(r.san)}</span><span class="funnel-bar"><i data-w="${Math.max(2, (100 * r.n) / top)}"></i></span><span class="n">${r.n}</span></div>`).join('')}</div>
    <p class="note">Moves in <span style="color:var(--you)">copper</span> are yours. Each bar is the number of your games that followed the line that far.</p>` : ''}`;
}

async function play0(tk) {
  const { it, board } = st;
  const line = [...it.path, it.move];
  const c = new Chess();
  board.setArrows([]);
  board.setFen(c.fen(), { animate: false, lastMove: [] });
  caption('<span>Replaying the line…</span>');
  const rows = new Map($$('#funnel .funnel-row').map((r) => [+r.dataset.i, r]));
  await sleep(350);
  const step = line.length > 14 ? 170 : 260;
  for (let i = 0; i < line.length; i++) {
    if (!alive(tk)) return;
    const mv = c.move(line[i]);
    const last = i === line.length - 1;
    if (last) await sleep(380);
    if (!alive(tk)) return;
    board.setFen(c.fen(), { lastMove: [mv.from, mv.to], duration: last ? 420 : step });
    const r = rows.get(i);
    if (r) { r.classList.add('on'); const bar = r.querySelector('i'); bar.style.width = `${bar.dataset.w}%`; }
    caption(last ? `<span>They played</span><b>${esc(moveLabel(i) + line[i])}</b>` : `<b>${esc(moveLabel(i) + line[i])}</b>`);
    if (last) board.pulse(mv.to);
    await sleep(step + 40);
  }
  if (!alive(tk)) return;
  rows.forEach((r) => r.classList.add('on'));
  caption(`<span>Your move. What did you play here?</span>`);
}

// ───────────────────────── 2 · your answers ─────────────────────────
function scene1() {
  const it = st.it;
  const g = it.groups;
  const noReply = it.games.filter((x) => !x.reply).length;
  const max = Math.max(1, ...g.map((x) => x.n));
  const best = g.filter((x) => x.a.n).sort((p, q) => q.a.sc - p.a.sc)[0];
  let lead;
  if (!g.length) lead = 'None of these games continued after their move.';
  else if (g.length > 1 && g.every((x) => x.n === g[0].n)) lead = `You tried <b>${g.length} different moves</b>, ${g[0].n === 1 ? 'once each' : `${g[0].n} games each`}.`;
  else if (g.length === 1) lead = `You answered <b>${esc(g[0].san)}</b> ${g[0].n === 1 ? 'the one time' : `every time (${g[0].n} games)`}.`;
  else lead = `You tried <b>${g.length} different moves</b>. Most often <b>${esc(g[0].san)}</b> (${g[0].n} of ${it.n}).`;
  return `<h1 class="h1">How you answered</h1><p>${lead}${best && g.length > 1 ? ` Your best results came with <b>${esc(best.san)}</b>: ${pct(best.a.sc)}.` : ''}</p>
    <div class="answers" id="answers">${g.map((x, i) => `<div class="answer" data-i="${i}">
      <span class="san">${esc(x.san)}</span>
      <span class="bars"><span class="freq"><i data-w="${(100 * x.n) / max}">${x.a.n ? `<span class="w" style="width:${(100 * x.a.w) / x.a.n}%"></span><span class="d" style="width:${(100 * x.a.d) / x.a.n}%"></span><span class="l" style="width:${(100 * x.a.l) / x.a.n}%"></span>` : '<span class="d" style="width:100%"></span>'}</i></span>
        <small>${plural(x.n, 'game')}${x.a.n ? ` · ${x.a.w}W ${x.a.d}D ${x.a.l}L` : ''}</small></span>
      <span class="score">${x.a.n ? pct(x.a.sc) : '–'}<small>score</small></span></div>`).join('')}</div>
    <div class="legend"><span><i style="background:var(--win)"></i>Won</span><span><i style="background:var(--draw)"></i>Drawn</span><span><i style="background:var(--loss)"></i>Lost</span></div>
    ${noReply ? `<p class="note">${plural(noReply, 'game')} ended right after their move.</p>` : ''}
    <p class="note">Recent games: ${it.games.slice(-4).reverse().map((x) => `${esc(x.opp || 'Opponent')}${x.opR ? ` (${x.opR})` : ''} · ${x.reply ? esc(x.reply) : '—'} · ${x.sc === 1 ? 'won' : x.sc === 0.5 ? 'draw' : x.sc === 0 ? 'lost' : 'unfinished'}`).join('<br>')}</p>`;
}

function answerArrows(it, hl = -1) {
  const pos = positionBefore(it);
  pos.move(it.move);
  const max = Math.max(1, ...it.groups.map((g) => g.n));
  return it.groups.map((g, i) => {
    const c = new Chess(pos.fen());
    let mv;
    try { mv = c.move(g.san); } catch { return null; }
    return { from: mv.from, to: mv.to, color: cssVar('--you'), width: 8 + (14 * g.n) / max, opacity: hl < 0 || hl === i ? 0.9 : 0.25, label: String(g.n), key: `you-${g.san}` };
  }).filter(Boolean);
}

async function play1(tk) {
  const { it, board } = st;
  const fen = fenOf(it);
  const pos = positionBefore(it);
  const opp = pos.move(it.move);
  board.setFen(fen, { animate: true, lastMove: [opp.from, opp.to] });
  board.setArrows([]);
  caption(`<span>After</span><b>${esc(it.label)}</b><span>· arrows show your replies, thicker = more often</span>`);
  await sleep(200);
  const rows = $$('#answers .answer');
  for (const r of rows) {
    if (!alive(tk)) return;
    const bar = r.querySelector('.freq i');
    bar.style.width = `${bar.dataset.w}%`;
    await sleep(70);
  }
  if (!alive(tk)) return;
  board.setArrows(answerArrows(it));
  rows.forEach((r) => {
    r.onmouseenter = () => { board.setArrows(answerArrows(it, +r.dataset.i), { draw: false }); r.classList.add('hl'); };
    r.onmouseleave = () => { board.setArrows(answerArrows(it), { draw: false }); r.classList.remove('hl'); };
  });
}

// ───────────────────────── 3 · the engine's view ─────────────────────────
const fmtEval = (score) => evalText(score, true);

function waitingHTML() {
  const p = st.C.progress && st.C.progress.id === st.id ? st.C.progress : null;
  const d = p?.stage === 'main' ? p.depth || 0 : p ? st.C.depth.main : 0;
  return `<div class="row" id="sWait" style="margin:18px 0">${ring(d / st.C.depth.main)}<div><b>${p ? `The engine is thinking · depth ${d} of ${st.C.depth.main}` : 'Queued for the engine'}</b><div class="note">${p?.stage === 'reply' ? `Checking your ${esc(p.san)}…` : p?.stage === 'idea' ? 'Following its main line…' : 'This takes up to half a minute. You can wait here; it fills in by itself.'}</div></div></div>`;
}

function paintWaiting() {
  const w = $('#sWait');
  if (w) w.outerHTML = waitingHTML();
  const r = $('#sWait .ring');
  if (r) r.classList.add('spin');
}

function scene2() {
  const it = st.it;
  const a = it.analysis;
  if (!a || it.status === 'new') return `<h1 class="h1">The engine's view</h1><p>Stockfish is analysing this position in the background: four candidate moves at depth ${st.C.depth.main}, then each of your replies.</p>${waitingHTML()}`;
  if (!a.lines.length) return `<h1 class="h1">The engine's view</h1><p>The game was already over in this position.</p>`;
  const best = a.lines[0];
  const usual = it.usual;
  const ue = usual?.eval;
  let verdict;
  if (!ue) verdict = `<div class="verdict">The engine's choice is <b>${esc(best.san)}</b>.</div>`;
  else if (usual.san === best.san) verdict = `<div class="verdict">Your usual <b>${esc(usual.san)}</b> is exactly what the engine plays.</div>`;
  else if (ue.loss < 5) verdict = `<div class="verdict">Your usual <b>${esc(usual.san)}</b> is fine: it gives up only ${ue.loss.toFixed(1)} points of win chance against <b>${esc(best.san)}</b>.</div>`;
  else verdict = `<div class="verdict warn">Your usual <b>${esc(usual.san)}</b> is ${CLASSES[ue.cls].label.toLowerCase() === 'inaccuracy' ? 'an inaccuracy' : `a ${CLASSES[ue.cls].label.toLowerCase()}`}: it gives up <b>${ue.loss.toFixed(1)}</b> points of win chance. The engine plays <b>${esc(best.san)}</b>.</div>`;
  return `<h1 class="h1">The engine's view</h1>
    <p>Your winning chances with each move, after a depth-${a.depth} search. <span style="color:var(--engine)">●</span> engine's best moves, <span style="color:var(--you)">◆</span> your replies.</p>
    <div class="scale" id="scale"><div class="scale-track"></div><div class="scale-ticks"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div></div>
    ${verdict}
    <p class="eyebrow" style="margin-top:20px">Engine lines</p>
    <div class="lines">${a.lines.map((l, i) => `<div class="eline"><span class="rk">${i + 1}</span><span class="san">${esc(l.san)}</span><span class="ev">${fmtEval(l.score)}</span><span class="pv">${esc(sanLine(l.pv.slice(1, 8), it.ply + 2))}</span></div>`).join('')}</div>
    ${it.groups.length ? `<p class="eyebrow" style="margin-top:18px">Your replies</p><div class="lines">${it.groups.map((g) => g.eval ? `<div class="eline"><span class="rk" style="background:var(--you)">${g.n}</span><span class="san">${esc(g.san)}</span><span class="ev">${g.eval.wp.toFixed(0)}%</span><span class="pv"><span class="chipcl" style="background:${CLASSES[g.eval.cls].color}"><b>${CLASSES[g.eval.cls].sym}</b>${CLASSES[g.eval.cls].label}</span> ${g.eval.loss >= 0.5 ? `−${g.eval.loss.toFixed(1)} win chance` : ''}</span></div>` : '').join('')}</div>` : ''}
    <p class="depth-note">Evaluations are for you (${it.side === 'w' ? 'White' : 'Black'}) · depth ${a.depth} · ${a.lines.length} lines</p>`;
}

async function play2(tk) {
  const { it, board } = st;
  const pos = positionBefore(it);
  const opp = pos.move(it.move);
  board.setFen(fenOf(it), { lastMove: [opp.from, opp.to] });
  const a = it.analysis;
  if (!a || it.status === 'new' || !a.lines.length) {
    board.setArrows(answerArrows(it).map((x) => ({ ...x, opacity: 0.35 })), { draw: false });
    caption('<span>Waiting for the engine…</span>');
    paintWaiting();
    return;
  }
  board.setArrows([]);
  const best = a.lines[0];
  caption(`<span>Best move</span><b>${esc(best.san)}</b><span>· ${fmtEval(best.score)} for you</span>`);
  // Dots on the scale
  const scale = $('#scale');
  const dots = [
    ...a.lines.map((l, i) => ({ kind: 'engine', san: l.san, wp: l.wp, i })),
    ...it.groups.filter((g) => g.eval).map((g) => ({ kind: 'you', san: g.san, wp: g.eval.wp })),
  ];
  // Stack labels that would overlap: each kind has up to three rows.
  const ends = { engine: [], you: [] };
  dots.sort((p, q) => p.wp - q.wp).forEach((d) => {
    const rows = ends[d.kind];
    const w = 2 + d.san.length * 1.6;
    let k = rows.findIndex((end) => end < d.wp - w / 2);
    if (k < 0) k = rows.length < 3 ? rows.length : rows.indexOf(Math.min(...rows));
    rows[k] = d.wp + w / 2;
    d.lvl = k;
  });
  for (const d of dots) {
    const el = document.createElement('div');
    el.className = `scale-dot ${d.kind} lvl${d.lvl}`;
    el.style.left = '50%';
    el.innerHTML = `<i></i><span>${esc(d.san)}</span>`;
    scale.append(el);
    d.el = el;
  }
  await sleep(120);
  dots.sort((p, q) => (p.kind === q.kind ? (p.i ?? 0) - (q.i ?? 0) : p.kind === 'engine' ? -1 : 1));
  for (const d of dots) {
    if (!alive(tk)) return;
    d.el.classList.add('in');
    d.el.style.left = `${Math.max(1, Math.min(99, d.wp))}%`;
    await sleep(110);
  }
  if (!alive(tk)) return;
  const arrows = [];
  const c = new Chess(fenOf(it));
  const mv = c.move(best.san);
  arrows.push({ from: mv.from, to: mv.to, color: cssVar('--engine'), width: 17, key: 'best' });
  if (it.usual && it.usual.san !== best.san) {
    const c2 = new Chess(fenOf(it));
    try { const m2 = c2.move(it.usual.san); arrows.unshift({ from: m2.from, to: m2.to, color: cssVar('--you'), width: 12, opacity: 0.6, key: 'usual' }); } catch { /* ignore */ }
  }
  board.setArrows(arrows);
}

// ───────────────────────── 4 · the idea ─────────────────────────
function sparkSVG(idea, n) {
  const W = 520, H = 110, pad = 14;
  const pts = idea.slice(0, n).map((p, i) => [pad + (i * (W - 2 * pad)) / Math.max(1, idea.length - 1), pad + (H - 2 * pad) * (1 - p.wp / 100)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = pts.length ? `${d} L${pts[pts.length - 1][0].toFixed(1)} ${H - pad} L${pts[0][0].toFixed(1)} ${H - pad} Z` : '';
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line class="mid" x1="${pad}" x2="${W - pad}" y1="${H / 2}" y2="${H / 2}"/>
    <path class="area" d="${area}"/><path class="line" d="${d}"/>${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" class="${i === pts.length - 1 ? 'on' : ''}"/>`).join('')}
    <text x="${pad}" y="11">your win chance</text><text x="${W - pad}" y="11" text-anchor="end">${idea[n - 1] ? `${Math.round(idea[n - 1].wp)}%` : ''}</text></svg>`;
}

function chooseDefault(it) {
  const a = it.analysis;
  const best = a?.lines?.[0]?.san;
  if (st.chosen) return st.chosen;
  const u = it.usual;
  if (u?.eval && u.san !== best && u.eval.loss < 5) return u.san; // your own move holds: keep it
  return best;
}

function scene3() {
  const it = st.it;
  const a = it.analysis;
  if (!a || it.status === 'new' || !a.lines.length) return `<h1 class="h1">The idea</h1><p>The engine's line appears here once the analysis is done.</p>${waitingHTML()}`;
  const best = a.lines[0];
  const u = it.usual;
  st.chosen = chooseDefault(it);
  const keepable = u?.eval && u.san !== best.san && u.eval.loss < 5;
  const pv = best.pv.slice(0, 7);
  const youCard = u ? `<div class="vs you ${keepable ? 'pick' : ''} ${st.chosen === u.san ? 'sel' : ''}" data-pick="${esc(u.san)}"><div class="eyebrow">Your usual reply</div><div class="san">${esc(u.san)}</div>
      <ul><li><b>${plural(u.n, 'game')}</b>${u.a.n ? ` · scored <b>${pct(u.a.sc)}</b>` : ''}</li>${u.eval ? `<li>win chance <b>${u.eval.wp.toFixed(0)}%</b></li><li><span class="chipcl" style="background:${CLASSES[u.eval.cls].color}"><b>${CLASSES[u.eval.cls].sym}</b>${CLASSES[u.eval.cls].label}</span></li>` : ''}</ul></div>` : '';
  const engCard = `<div class="vs engine ${keepable ? 'pick' : ''} ${st.chosen === best.san ? 'sel' : ''}" data-pick="${esc(best.san)}"><div class="eyebrow">Engine's move</div><div class="san">${esc(best.san)}</div>
      <ul><li>win chance <b>${best.wp.toFixed(0)}%</b> · ${fmtEval(best.score)}</li><li>then ${esc(sanLine(best.pv.slice(1, 4), it.ply + 2))}</li></ul></div>`;
  return `<h1 class="h1">The idea behind <em>${esc(best.san)}</em></h1>
    <p>Watch the engine's main line. The chart follows your winning chances move by move.</p>
    <div class="pvline" id="pvl">${pv.map((s, i) => `<span data-i="${i}">${esc((i === 0 || (it.ply + 1 + i) % 2 === 0 ? moveLabel(it.ply + 1 + i) : '') + s)}</span>`).join('')}</div>
    <div id="spark">${sparkSVG(a.idea, 1)}</div>
    <div class="row"><button class="btn sm" id="replay">↻ Replay the line</button></div>
    <div class="versus">${youCard}${engCard}</div>
    ${keepable ? '<p class="note">Your own move holds up (within 5 points of win chance), so you can keep it. Tap a card to choose what goes into your library.</p>' : u && u.san !== best.san ? `<p class="note">You will practise <b>${esc(best.san)}</b> and it goes into your library.</p>` : ''}`;
}

async function play3(tk) {
  const { it, board } = st;
  const a = it.analysis;
  const pos = positionBefore(it);
  const opp = pos.move(it.move);
  board.setFen(fenOf(it), { lastMove: [opp.from, opp.to] });
  board.setArrows([]);
  if (!a || it.status === 'new' || !a.lines.length) { caption('<span>Waiting for the engine…</span>'); paintWaiting(); return; }
  $$('[data-pick]').forEach((el) => {
    if (!el.classList.contains('pick')) return;
    el.onclick = () => { st.chosen = el.dataset.pick; $$('[data-pick]').forEach((x) => x.classList.toggle('sel', x === el)); };
  });
  $('#replay').onclick = () => { st.tk++; play3(st.tk); };
  const pv = a.lines[0].pv.slice(0, 7);
  const chips = $$('#pvl span');
  await sleep(400);
  const c = new Chess(fenOf(it));
  for (let i = 0; i < pv.length; i++) {
    if (!alive(tk)) return;
    let mv;
    try { mv = c.move(pv[i]); } catch { break; }
    board.setFen(c.fen(), { lastMove: [mv.from, mv.to], duration: 340 });
    board.setArrows(i === 0 ? [] : []);
    chips.forEach((ch, k) => { ch.classList.toggle('on', k <= i); ch.classList.toggle('cur', k === i); });
    const n = Math.min(a.idea.length, i + 2);
    const sp = $('#spark');
    if (sp) sp.innerHTML = sparkSVG(a.idea, n);
    const mine = c.turn() !== it.side;
    caption(`<b>${esc(moveLabel(it.ply + 1 + i) + pv[i])}</b><span>${mine ? '· your move' : '· their best reply'}${a.idea[i + 1] ? ` · ${Math.round(a.idea[i + 1].wp)}% for you` : ''}</span>`);
    await sleep(900);
  }
  if (!alive(tk)) return;
  caption(`<span>That's the plan. Next: play it yourself.</span>`);
}

// ───────────────────────── 5 · practice ─────────────────────────
function scene4() {
  const it = st.it;
  if (!it.analysis || it.status === 'new' || !it.analysis.lines.length) return `<h1 class="h1">Practice</h1><p>Practice opens once the engine has finished.</p>${waitingHTML()}`;
  st.chosen = chooseDefault(it);
  const line = studiedLine(it, st.chosen);
  st.steps = line.slice(it.ply + 1);
  return `<h1 class="h1">Your move</h1><p>Play the line from memory: your answer to ${esc(it.label)}, their reply, and your follow-up.</p>
    <div class="steps-track" id="steps">${st.steps.map((s, i) => `<span class="${i % 2 ? 'them' : ''}" data-i="${i}">${i % 2 ? 'Their reply' : i === 0 ? 'Your answer' : 'Your follow-up'}</span>`).join('')}</div>
    <p class="feedback" id="fb"></p>
    <div class="row"><button class="btn sm" id="hintBtn">Hint</button><button class="btn sm ghost" id="restartBtn">Start over</button></div>
    <div id="doneBox"></div>`;
}

async function play4(tk) {
  const { it, board } = st;
  if (!it.analysis || it.status === 'new' || !it.analysis.lines.length) { caption('<span>Waiting for the engine…</span>'); paintWaiting(); return; }
  const start = () => {
    st.tk++;
    const t = st.tk;
    const c = new Chess(fenOf(it));
    const pos = positionBefore(it);
    const opp = pos.move(it.move);
    let k = 0;
    let wrong = 0;
    board.setFen(c.fen(), { lastMove: [opp.from, opp.to] });
    board.setArrows([]);
    board.clearFx();
    const fb = $('#fb');
    const paint = () => $$('#steps span').forEach((el, i) => { el.classList.toggle('ok', i < k); el.classList.toggle('cur', i === k); });
    const hint = () => {
      const m = new Chess(c.fen()).move(st.steps[k]);
      board.setMarks({ ...board.marks, hint: [m.from, m.to] });
      fb.className = 'feedback';
      fb.textContent = `Try ${m.piece === 'p' ? 'the pawn' : 'the piece'} on ${m.from}.`;
    };
    $('#hintBtn').onclick = hint;
    $('#restartBtn').onclick = start;
    paint();
    caption(`<span>Your move as ${it.side === 'w' ? 'White' : 'Black'}</span>`);
    const enable = () => board.interactive({
      canPick: (sq) => c.get(sq)?.color === c.turn() && c.turn() === it.side,
      targets: (sq) => c.moves({ square: sq, verbose: true }).map((m) => m.to),
      onIllegal: () => board.shake(),
      onMove: async (from, to) => {
        const want = new Chess(c.fen()).move(st.steps[k]);
        const promo = want.promotion && want.from === from && want.to === to ? want.promotion : 'q';
        const tryC = new Chess(c.fen());
        const mv = tryC.move({ from, to, promotion: promo });
        if (mv.san !== want.san) {
          wrong++;
          board.setFen(tryC.fen(), { lastMove: [from, to], duration: 160 });
          board.shake();
          fb.className = 'feedback no';
          fb.textContent = `${mv.san} isn't the move here. ${wrong >= 2 ? 'Use a hint if you like.' : 'Try again.'}`;
          await sleep(560);
          if (!alive(t)) return;
          board.setFen(c.fen(), { duration: 200, lastMove: k ? board.marks.last : [opp.from, opp.to] });
          if (wrong >= 3) hint();
          return;
        }
        c.move(mv.san);
        board.setFen(c.fen(), { lastMove: [mv.from, mv.to] });
        board.pulse(mv.to, cssVar('--success'));
        fb.className = 'feedback ok';
        fb.textContent = k === 0 ? `${mv.san}. Good.` : `${mv.san}. That's the line.`;
        $(`#steps [data-i="${k}"]`).textContent = mv.san;
        k++;
        paint();
        if (k >= st.steps.length) { board.interactive(null); await finish(t); return; }
        board.interactive(null);
        await sleep(520);
        if (!alive(t)) return;
        const r = c.move(st.steps[k]);
        board.setFen(c.fen(), { lastMove: [r.from, r.to] });
        caption(`<span>They reply</span><b>${esc(r.san)}</b>`);
        $(`#steps [data-i="${k}"]`).textContent = r.san;
        k++;
        paint();
        if (k >= st.steps.length) { await finish(t); return; }
        await sleep(300);
        if (!alive(t)) return;
        caption('<span>Your move again</span>');
        enable();
      },
    });
    enable();
  };
  start();
}

async function finish(t) {
  const s = st;
  const { C, it } = s;
  let res;
  try { res = await C.study(it.id, st.chosen); } catch (e) { toast(e.message); return; }
  if (!alive(t)) return;
  s.done = true;
  $('#sNext').disabled = false;
  $('#sNext').innerHTML = C.list().some((x) => x.id !== it.id && (x.status === 'ready' || x.status === 'new')) ? 'Next discovery <span class="arrow">→</span>' : 'Done';
  $$('#sPills button').forEach((b) => b.classList.add('done'));
  caption(`<span>Added to your library</span><b>${esc(res.title)}</b>`);
  $('#hintBtn').hidden = true;
  $('#restartBtn').hidden = true;
  const libLink = `#library/${it.side}/${encodeURIComponent(res.san.slice(0, it.ply + 1).join(','))}//new`;
  $('#doneBox').innerHTML = `<div class="done-card"><div class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
    <h2 class="h2" style="margin:6px 0">Added to your library</h2><p class="note">${esc(sanLine(res.san.slice(it.ply), it.ply))}<br>It's in Library with your other ${it.side === 'w' ? 'White' : 'Black'} lines, marked “From your games”.</p>
    <div class="row" style="justify-content:center;margin-top:10px"><a class="btn" href="${libLink}" id="toLib">Open in Library</a></div></div>`;
  $('#toLib').onclick = () => { const cl = st?.onClose; cleanup(); st = null; $('#story').hidden = true; $('#story').innerHTML = ''; void cl; };
  confetti($('.done-card'));
  flyToLibrary(s);
}

export function confetti(host) {
  if (!host || reducedMotion()) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['--cta', '--success', '--engine', '--you', '--cl-inaccuracy'];
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('i');
    const ang = (Math.PI * 2 * i) / 26 + Math.random() * 0.3;
    const dist = 90 + Math.random() * 90;
    p.style.background = `var(${colors[i % colors.length]})`;
    p.style.setProperty('--x', `${Math.cos(ang) * dist}px`);
    p.style.setProperty('--y', `${Math.sin(ang) * dist - 30}px`);
    p.style.setProperty('--r', `${Math.random() * 540 - 270}deg`);
    p.style.animationDelay = `${Math.random() * 80}ms`;
    box.append(p);
  }
  host.style.position = 'relative';
  host.append(box);
  setTimeout(() => box.remove(), 1400);
}

function flyToLibrary(s) {
  if (reducedMotion()) return;
  const from = $('#sBoard')?.getBoundingClientRect();
  const target = document.querySelector('#subnav [data-sec="library"]')?.getBoundingClientRect();
  if (!from || !target) return;
  const el = document.createElement('div');
  el.className = 'fly';
  el.style.left = `${from.left}px`;
  el.style.top = `${from.top}px`;
  el.style.width = `${from.width}px`;
  el.innerHTML = miniBoard(s.board.fen, s.it.side);
  document.body.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const scale = 28 / from.width;
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${target.left + target.width / 2 - 14 - from.left}px, ${target.top + target.height / 2 - 14 - from.top}px) scale(${scale})`;
    el.style.opacity = '0.2';
  }));
  setTimeout(() => {
    el.remove();
    const tab = document.querySelector('#subnav [data-sec="library"]');
    if (tab) { tab.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' }); }
  }, 900);
}

export { ENGINE, YOU };
