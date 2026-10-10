import { Chess, DEFAULT_POSITION } from '../vendor/chess.js';
import { Board } from './board.js';
import { Engine } from './engine.js';
import {
  eloParams, eloBand, weighCandidates, sampleMove, materialOutcome,
  describeOutcome, formatScore, scoreToCp, uciToMove, materialOf,
} from './solver.js';

// ─────────────────────────── settings ───────────────────────────
const STORE_KEY = 'sfet.settings.v1';
const DEFAULTS = {
  ctrl: { w: 'human', b: 'solver' },
  elo: { w: 1500, b: 1500 },
  n: 3,
  pool: 8,
  depth: 0,
  movetime: 2500,
  randomness: 1,
  horizon: 6,
  delay: 600,
  arrows: true,
  hintsHuman: true,
  hintsSolver: true,
  coords: true,
  orientation: 'w',
};

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return {
      ...DEFAULTS, ...raw,
      ctrl: { ...DEFAULTS.ctrl, ...raw.ctrl },
      elo: { ...DEFAULTS.elo, ...raw.elo },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}
const settings = loadSettings();
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch {}
}

// Rank colours for candidate arrows / badges (best → worst).
const RANK_COLORS = ['#3f9a63', '#3d7fd1', '#c98a2e', '#a65e46', '#8a63c9', '#2f9aa0', '#b0577f', '#6b7a8f'];
const COLOR_NAME = { w: 'White', b: 'Black' };
const PIECE_ORDER = ['q', 'r', 'b', 'n', 'p'];
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };

// ─────────────────────────── state ───────────────────────────
let startFen = DEFAULT_POSITION;
let history = []; // [{ from, to, promotion, san, color, solver?: { prob, rank } }]
let cursor = 0;
let game = new Chess();
let analysis = null; // { token, fen, color, params, lines, weighted, final }
let token = 0;
let paused = false;
let autoTimer = null;
let solveRequested = false;
let hoverIdx = null;
let renderQueued = false;

const $ = (id) => document.getElementById(id);
const el = {
  candidates: $('candidates'), otherMoves: $('otherMoves'), summary: $('solverSummary'),
  searchInfo: $('searchInfo'), movelist: $('movelist'), status: $('statusBadge'),
  fen: $('fenInput'), evalFill: $('evalFill'), evalLabel: $('evalLabel'), evalbar: $('evalbar'),
  stripTop: $('stripTop'), stripBottom: $('stripBottom'), promo: $('promo'), gameOver: $('gameOver'),
  toast: $('toast'), engineName: $('engineName'), engineDot: $('engineDot'), pause: $('btnPause'),
};

// ─────────────────────────── engine ───────────────────────────
let engine = null;
function bootEngine() {
  if (location.protocol === 'file:') {
    engineStatus('error', 'Open via start.bat / node server.js — engines cannot load from file://');
    return;
  }
  try {
    engine = new Engine('engine/stockfish-19-lite-single.js');
    engine.worker.addEventListener('error', () => engineStatus('error', 'Engine failed to load'));
    engine.ready.then((name) => {
      engineStatus('ok', name);
      startAnalysis();
    });
  } catch (err) {
    engineStatus('error', `Engine failed: ${err.message}`);
  }
}
function engineStatus(kind, text) {
  el.engineDot.dataset.state = kind;
  el.engineName.textContent = text;
}

// ─────────────────────────── board ───────────────────────────
const board = new Board($('board'), {
  canPick(sq) {
    const p = game.get(sq);
    return !!p && p.color === game.turn() && !game.isGameOver() && humanMayMove();
  },
  targets(sq) {
    return game.moves({ square: sq, verbose: true }).map((m) => m.to);
  },
  onMove(from, to) {
    const options = game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!options.length) return;
    if (options.some((m) => m.promotion)) askPromotion(from, to);
    else playMove({ from, to });
  },
});

function humanMayMove() {
  // Solver-controlled sides can still be moved by hand while paused or when reviewing history.
  return settings.ctrl[game.turn()] === 'human' || paused || cursor < history.length;
}

function askPromotion(from, to) {
  const color = game.turn();
  el.promo.innerHTML = '';
  for (const t of ['q', 'r', 'b', 'n']) {
    const b = document.createElement('button');
    b.innerHTML = `<img src="pieces/${color}${t.toUpperCase()}.svg" alt="${t}">`;
    b.onclick = () => { el.promo.hidden = true; playMove({ from, to, promotion: t }); };
    el.promo.append(b);
  }
  const cancel = document.createElement('button');
  cancel.className = 'promo-cancel';
  cancel.textContent = '✕';
  cancel.onclick = () => { el.promo.hidden = true; };
  el.promo.append(cancel);
  el.promo.hidden = false;
}

// ─────────────────────────── game flow ───────────────────────────
function rebuild() {
  game = new Chess(startFen);
  for (let i = 0; i < cursor; i++) game.move(history[i]);
}

function playMove(move, solverMeta = null) {
  let mv;
  try {
    mv = game.move(move);
  } catch {
    return false;
  }
  history = history.slice(0, cursor);
  history.push({ from: mv.from, to: mv.to, promotion: mv.promotion, san: mv.san, color: mv.color, solver: solverMeta });
  cursor = history.length;
  positionChanged();
  return true;
}

function goTo(i) {
  cursor = Math.max(0, Math.min(history.length, i));
  rebuild();
  positionChanged();
}

function newGame(fen = DEFAULT_POSITION) {
  startFen = fen;
  history = [];
  cursor = 0;
  game = new Chess(fen);
  engine?.newGame();
  el.promo.hidden = true;
  positionChanged();
}

function positionChanged() {
  clearTimeout(autoTimer);
  autoTimer = null;
  solveRequested = false;
  hoverIdx = null;
  const last = cursor > 0 ? history[cursor - 1] : null;
  let check = null;
  if (game.inCheck()) {
    for (const row of game.board()) for (const p of row) if (p && p.type === 'k' && p.color === game.turn()) check = p.square;
  }
  board.setPosition(game.board(), last && { from: last.from, to: last.to }, check);
  el.fen.value = game.fen();
  renderStrips();
  renderMoveList();
  renderStatus();
  startAnalysis();
}

// ─────────────────────────── analysis ───────────────────────────
function startAnalysis() {
  const myToken = ++token;
  if (!engine || game.isGameOver()) {
    analysis = null;
    engine?.cancel();
    renderAnalysis();
    return;
  }
  const color = game.turn();
  const params = eloParams(settings.elo[color], { randomness: settings.randomness, depth: settings.depth });
  const legal = game.moves().length;
  const multipv = Math.min(legal, Math.max(settings.n, settings.pool));
  const fen = game.fen();
  analysis = { token: myToken, fen, color, params, legal, lines: [], weighted: null, final: false };
  renderAnalysis();
  engine.analyse({
    fen,
    multipv,
    depth: params.depth,
    movetime: settings.movetime,
    onUpdate: (lines) => {
      if (analysis?.token !== myToken) return;
      setLines(lines, false);
    },
  }).then((lines) => {
    if (!lines || analysis?.token !== myToken) return;
    setLines(lines, true);
    maybeAutoPlay();
  });
}

function setLines(lines, final) {
  analysis.lines = lines;
  analysis.final = final;
  analysis.weighted = weighCandidates(lines, analysis.legal, analysis.params);
  for (const c of analysis.weighted.candidates) {
    c.outcome = materialOutcome(analysis.fen, c.pv, settings.horizon);
  }
  if (final) renderAnalysis();
  else queueRender();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAnalysis(); });
}

function maybeAutoPlay() {
  if (solveRequested) { playSolverMove(); return; }
  if (paused || cursor !== history.length || game.isGameOver()) return;
  if (settings.ctrl[game.turn()] !== 'solver') return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(playSolverMove, settings.delay);
}

function playSolverMove() {
  if (!analysis || game.isGameOver()) return;
  if (!analysis.final) { solveRequested = true; return; }
  solveRequested = false;
  const legal = game.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
  const uci = sampleMove(analysis.weighted, legal);
  const idx = analysis.weighted.candidates.findIndex((c) => c.move === uci);
  const prob = idx >= 0
    ? analysis.weighted.candidates[idx].prob
    : analysis.weighted.otherProb / Math.max(1, legal.length - analysis.weighted.candidates.length);
  const meta = { prob, rank: idx >= 0 ? idx + 1 : null, elo: analysis.params.elo };
  const color = COLOR_NAME[game.turn()];
  if (playMove(uciToMove(uci), meta)) {
    const last = history[history.length - 1];
    toast(`${color} solver (${meta.elo}) played ${last.san} — ${meta.rank ? `line #${meta.rank}` : 'off-list move'}, p=${pct(prob)}`);
  }
}

// ─────────────────────────── rendering ───────────────────────────
function pct(p) {
  if (p >= 0.995) return '100%';
  if (p < 0.001) return '<0.1%';
  return p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`;
}

function hintsVisible() {
  if (!analysis) return false;
  return settings.ctrl[analysis.color] === 'human' ? settings.hintsHuman : settings.hintsSolver;
}

function renderAnalysis() {
  renderSummary();
  renderEval();
  renderStrips();
  const a = analysis;
  el.candidates.innerHTML = '';
  el.otherMoves.textContent = '';
  if (!a) {
    el.searchInfo.textContent = engine ? 'game over' : 'no engine';
    board.setArrows([]);
    return;
  }
  const last = a.lines[0];
  el.searchInfo.textContent = last
    ? `${a.final ? 'depth' : 'searching'} ${last.depth}/${a.params.depth}${last.nps ? ` · ${Math.round(last.nps / 1000)} kN/s` : ''}`
    : 'thinking…';
  el.searchInfo.classList.toggle('live', !a.final);

  if (!hintsVisible()) {
    el.candidates.innerHTML = `<li class="hint-hidden">Hints are hidden on ${settings.ctrl[a.color]} turns.</li>`;
    board.setArrows([]);
    return;
  }
  const shown = (a.weighted?.candidates || []).slice(0, settings.n);
  if (!shown.length) {
    for (let i = 0; i < Math.min(settings.n, a.legal); i++) {
      el.candidates.insertAdjacentHTML('beforeend', '<li class="cand skeleton"><span></span></li>');
    }
    board.setArrows([]);
    return;
  }
  const pov = a.color === 'w' ? 1 : -1;
  const maxProb = Math.max(...shown.map((c) => c.prob));
  shown.forEach((c, i) => {
    const o = c.outcome;
    const san = o.san[0] || c.move;
    const deltaCls = o.delta > 0 ? 'up' : o.delta < 0 ? 'down' : 'flat';
    const mate = c.score.mate !== undefined;
    const chipCls = mate ? (c.score.mate > 0 ? 'up' : 'down') : deltaCls;
    const chipText = mate ? `M${Math.abs(c.score.mate)}` : o.delta > 0 ? `+${o.delta}` : o.delta < 0 ? `−${-o.delta}` : '±0';
    const capt = (arr, color) => arr.filter((p) => !p.startsWith('=')).map((p) => `<img src="pieces/${color}${p.toUpperCase()}.svg" alt="${p}">`).join('');
    const opp = a.color === 'w' ? 'b' : 'w';
    const li = document.createElement('li');
    li.className = 'cand';
    li.style.setProperty('--rank', RANK_COLORS[i % RANK_COLORS.length]);
    li.innerHTML = `
      <span class="cand-rank">${i + 1}</span>
      <div class="cand-main">
        <div class="cand-top">
          <span class="cand-san">${san}</span>
          <span class="cand-eval mono">${formatScore(c.score, pov)}</span>
          <span class="cand-prob mono">${pct(c.prob)}</span>
        </div>
        <div class="prob-track"><div class="prob-fill" style="width:${(c.prob * 100).toFixed(1)}%"></div></div>
        <div class="cand-material">
          <span class="mat-chip ${chipCls}" title="Material change for ${COLOR_NAME[a.color]} after ${o.plies} plies">${chipText}</span>
          <span class="mat-text">${describeOutcome(o, c.score)}</span>
          <span class="mat-pieces">
            ${o.won.length ? `<span class="gain">${capt(o.won, opp)}</span>` : ''}
            ${o.lost.length ? `<span class="loss">${capt(o.lost, a.color)}</span>` : ''}
          </span>
        </div>
        <div class="cand-pv mono">${formatPv(o.san, a.fen)}</div>
      </div>`;
    li.title = `Click to play ${san}. Centipawn loss vs best: ${mate ? '—' : c.loss}`;
    li.addEventListener('mouseenter', () => { hoverIdx = i; drawArrows(); });
    li.addEventListener('mouseleave', () => { hoverIdx = null; drawArrows(); });
    li.addEventListener('click', () => {
      if (!game.isGameOver()) playMove(uciToMove(c.move), { prob: c.prob, rank: i + 1, elo: a.params.elo, picked: true });
    });
    if (c.prob === maxProb) li.classList.add('favourite');
    el.candidates.append(li);
  });
  const rest = 1 - shown.reduce((s, c) => s + c.prob, 0);
  const restCount = a.legal - shown.length;
  if (restCount > 0) {
    el.otherMoves.innerHTML = `<span>${restCount} other move${restCount === 1 ? '' : 's'}</span><span class="mono">${pct(Math.max(0, rest))}</span>`;
  }
  drawArrows();
}

function formatPv(sans, fen) {
  const parts = fen.split(' ');
  let moveNo = +parts[5];
  let white = parts[1] === 'w';
  const out = [];
  sans.forEach((s, i) => {
    if (white) out.push(`<span class="pv-no">${moveNo}.</span>${s}`);
    else out.push(i === 0 ? `<span class="pv-no">${moveNo}…</span>${s}` : s);
    if (!white) moveNo++;
    white = !white;
  });
  return out.join(' ');
}

function drawArrows() {
  const a = analysis;
  if (!a || !settings.arrows || !hintsVisible() || !a.weighted) { board.setArrows([]); return; }
  const shown = a.weighted.candidates.slice(0, settings.n);
  if (hoverIdx !== null && shown[hoverIdx]) {
    // Show the hovered line as a numbered sequence of arrows.
    const c = shown[hoverIdx];
    const plies = c.pv.slice(0, Math.max(1, c.outcome.plies));
    board.setArrows(plies.map((uci, j) => ({
      from: uci.slice(0, 2), to: uci.slice(2, 4),
      color: j % 2 === 0 ? RANK_COLORS[hoverIdx % RANK_COLORS.length] : '#7d8799',
      width: j === 0 ? 18 : 11,
      opacity: j === 0 ? 0.9 : Math.max(0.35, 0.8 - j * 0.07),
      label: String(j + 1),
    })));
    return;
  }
  const maxProb = Math.max(...shown.map((c) => c.prob), 1e-9);
  board.setArrows(shown.map((c, i) => ({
    from: c.move.slice(0, 2), to: c.move.slice(2, 4),
    color: RANK_COLORS[i % RANK_COLORS.length],
    width: 8 + 16 * Math.sqrt(c.prob / maxProb),
    opacity: 0.35 + 0.55 * (c.prob / maxProb),
    label: String(i + 1),
  })));
}

function renderSummary() {
  const a = analysis;
  if (!a) { el.summary.textContent = game.isGameOver() ? 'The game is over.' : 'Waiting for the engine…'; return; }
  const p = a.params;
  el.summary.innerHTML = `<b>${COLOR_NAME[a.color]}</b> to move · solver at <b class="mono">${p.elo}</b> (${eloBand(p.elo)})
    <span class="kv"><span>depth</span><b class="mono">${p.depth}</b></span>
    <span class="kv"><span>temperature</span><b class="mono">${p.temperature.toFixed(p.temperature < 10 ? 1 : 0)}cp</b></span>
    <span class="kv"><span>blunder</span><b class="mono">${pct(p.blunder)}</b></span>`;
}

function renderEval() {
  let text = '0.0';
  let whiteShare = 50;
  const best = analysis?.lines?.[0];
  if (best) {
    const pov = analysis.color === 'w' ? 1 : -1;
    const cpWhite = scoreToCp(best.score) * pov;
    whiteShare = best.score.mate !== undefined
      ? (cpWhite > 0 ? 100 : 0)
      : 50 + 50 * (2 / (1 + Math.exp(-cpWhite / 300)) - 1);
    text = best.score.mate !== undefined ? `M${Math.abs(best.score.mate)}` : Math.abs(best.score.cp / 100).toFixed(1);
  } else if (game.isCheckmate()) {
    whiteShare = game.turn() === 'w' ? 0 : 100;
    text = game.turn() === 'w' ? '0-1' : '1-0';
  } else if (game.isGameOver()) {
    text = '½-½';
  }
  el.evalFill.style.height = `${Math.max(0, Math.min(100, whiteShare))}%`;
  el.evalLabel.textContent = text;
  el.evalbar.classList.toggle('white-ahead', whiteShare >= 50);
  el.evalbar.classList.toggle('flipped', settings.orientation === 'b');
}

function capturedBy(color) {
  // Pieces `color` has captured = opponent's missing material vs. a full set.
  const counts = { w: {}, b: {} };
  for (const row of game.board()) for (const p of row) if (p) counts[p.color][p.type] = (counts[p.color][p.type] || 0) + 1;
  const opp = color === 'w' ? 'b' : 'w';
  const out = [];
  for (const t of PIECE_ORDER) {
    const missing = Math.max(0, START_COUNT[t] - (counts[opp][t] || 0));
    for (let i = 0; i < missing; i++) out.push(t);
  }
  return out;
}

function renderStrips() {
  const bottom = settings.orientation;
  const top = bottom === 'w' ? 'b' : 'w';
  const m = materialOf(game);
  for (const [stripEl, color] of [[el.stripTop, top], [el.stripBottom, bottom]]) {
    const ctrl = settings.ctrl[color];
    const elo = settings.elo[color];
    const adv = color === 'w' ? m.w - m.b : m.b - m.w;
    const opp = color === 'w' ? 'b' : 'w';
    const caps = capturedBy(color).map((t) => `<img src="pieces/${opp}${t.toUpperCase()}.svg" alt="${t}">`).join('');
    const toMove = game.turn() === color && !game.isGameOver();
    const thinking = toMove && ctrl === 'solver' && !paused && analysis && !analysis.final && cursor === history.length;
    stripEl.className = `player-strip${toMove ? ' to-move' : ''}`;
    stripEl.innerHTML = `
      <span class="avatar ${color === 'w' ? 'white' : 'black'}"><img src="pieces/${color}K.svg" alt=""></span>
      <div class="player-id">
        <span class="player-name">${COLOR_NAME[color]} · ${ctrl === 'solver' ? 'Solver' : 'Human'}</span>
        <span class="player-meta">${ctrl === 'solver' ? `<span class="mono">${elo}</span> · ${eloBand(elo)}` : `hints at <span class="mono">${elo}</span> Elo`}${thinking ? ' · <span class="thinking">thinking</span>' : ''}${toMove && ctrl === 'solver' && paused ? ' · paused' : ''}</span>
      </div>
      <div class="captured">${caps}${adv > 0 ? `<span class="adv mono">+${adv}</span>` : ''}</div>
      ${toMove ? '<span class="turn-dot" title="To move"></span>' : ''}`;
  }
}

function renderMoveList() {
  el.movelist.innerHTML = '';
  const startTurn = new Chess(startFen).turn();
  let moveNo = +startFen.split(' ')[5] || 1;
  let li = null;
  history.forEach((h, i) => {
    if (h.color === 'w' || !li) {
      li = document.createElement('li');
      li.innerHTML = `<span class="mv-no">${moveNo}.</span>`;
      if (h.color === 'b') li.insertAdjacentHTML('beforeend', '<span class="mv empty">…</span>');
      el.movelist.append(li);
    }
    const b = document.createElement('button');
    b.className = `mv${i === cursor - 1 ? ' current' : ''}`;
    b.innerHTML = h.san + (h.solver ? `<span class="mv-tag" title="${h.solver.picked ? 'Picked from list' : 'Solver'} · line ${h.solver.rank ?? '—'} · p=${pct(h.solver.prob)}">${h.solver.rank ?? '?'}</span>` : '');
    b.onclick = () => goTo(i + 1);
    li.append(b);
    if (h.color === 'b') moveNo++;
  });
  if (!history.length) el.movelist.innerHTML = `<li class="empty-list">${COLOR_NAME[startTurn]} to move. Make a move on the board or press <kbd>Space</kbd> for a solver move.</li>`;
  el.movelist.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
}

function renderStatus() {
  let text;
  let over = null;
  if (game.isCheckmate()) {
    text = `Checkmate · ${COLOR_NAME[game.turn() === 'w' ? 'b' : 'w']} wins`;
    over = `${game.turn() === 'w' ? '0–1' : '1–0'} · Checkmate`;
  } else if (game.isStalemate()) { text = over = 'Stalemate · ½–½'; }
  else if (game.isThreefoldRepetition()) { text = over = 'Threefold repetition · ½–½'; }
  else if (game.isInsufficientMaterial()) { text = over = 'Insufficient material · ½–½'; }
  else if (game.isDraw()) { text = over = '50-move rule · ½–½'; }
  else text = `${COLOR_NAME[game.turn()]} to move${game.inCheck() ? ' · check' : ''}`;
  el.status.textContent = cursor < history.length ? `${text} · reviewing ${cursor}/${history.length}` : text;
  el.gameOver.hidden = !over;
  el.gameOver.textContent = over || '';
}

let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
}

// ─────────────────────────── controls ───────────────────────────
function bindRange(id, outId, key, fmt, { reanalyse = true } = {}) {
  const input = $(id);
  const out = $(outId);
  input.value = settings[key];
  out.textContent = fmt(+input.value);
  input.addEventListener('input', () => {
    settings[key] = +input.value;
    out.textContent = fmt(settings[key]);
    saveSettings();
    if (reanalyse) scheduleReanalyse();
    else if (analysis?.weighted) { setLines(analysis.lines, analysis.final); renderAnalysis(); }
  });
}

let reanalyseTimer = null;
function scheduleReanalyse() {
  clearTimeout(reanalyseTimer);
  reanalyseTimer = setTimeout(() => { clearTimeout(autoTimer); startAnalysis(); }, 250);
}

bindRange('inN', 'outN', 'n', (v) => v);
bindRange('inPool', 'outPool', 'pool', (v) => v);
bindRange('inDepth', 'outDepth', 'depth', (v) => (v === 0 ? 'auto' : v));
bindRange('inTime', 'outTime', 'movetime', (v) => `${(v / 1000).toFixed(1)}s`);
bindRange('inRand', 'outRand', 'randomness', (v) => `${v.toFixed(2)}×`);
bindRange('inHorizon', 'outHorizon', 'horizon', (v) => `${v} plies`, { reanalyse: false });
bindRange('inDelay', 'outDelay', 'delay', (v) => `${(v / 1000).toFixed(1)}s`, { reanalyse: false });

function bindToggle(id, key, after) {
  const input = $(id);
  input.checked = settings[key];
  input.addEventListener('change', () => {
    settings[key] = input.checked;
    saveSettings();
    after();
  });
}
bindToggle('inArrows', 'arrows', drawArrows);
bindToggle('inHintsHuman', 'hintsHuman', renderAnalysis);
bindToggle('inHintsSolver', 'hintsSolver', renderAnalysis);
bindToggle('inCoords', 'coords', applyCoords);
function applyCoords() { $('board').classList.toggle('no-coords', !settings.coords); }
applyCoords();

for (const side of document.querySelectorAll('.side-config')) {
  const color = side.dataset.color;
  const range = side.querySelector('[data-input="elo"]');
  const out = side.querySelector('[data-out="elo"]');
  const band = side.querySelector('[data-out="band"]');
  const buttons = side.querySelectorAll('[data-ctrl]');
  const sync = () => {
    range.value = settings.elo[color];
    out.textContent = settings.elo[color];
    band.textContent = eloBand(settings.elo[color]);
    range.style.setProperty('--fill', `${(settings.elo[color] / 3000) * 100}%`);
    for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.ctrl === settings.ctrl[color]));
  };
  side.sync = sync;
  sync();
  range.addEventListener('input', () => {
    settings.elo[color] = +range.value;
    sync();
    saveSettings();
    renderStrips();
    if (game.turn() === color) scheduleReanalyse();
  });
  for (const b of buttons) {
    b.addEventListener('click', () => {
      settings.ctrl[color] = b.dataset.ctrl;
      sync();
      saveSettings();
      renderStrips();
      renderAnalysis();
      if (game.turn() === color && analysis?.final) maybeAutoPlay();
      else if (game.turn() === color) clearTimeout(autoTimer);
    });
  }
}
for (const chip of document.querySelectorAll('[data-preset]')) {
  chip.addEventListener('click', () => {
    settings.elo.w = settings.elo.b = +chip.dataset.preset;
    for (const s of document.querySelectorAll('.side-config')) s.sync();
    saveSettings();
    renderStrips();
    scheduleReanalyse();
  });
}

function setPaused(v) {
  paused = v;
  el.pause.textContent = paused ? 'Resume' : 'Pause';
  el.pause.classList.toggle('active', paused);
  clearTimeout(autoTimer);
  renderStrips();
  if (!paused && analysis?.final) maybeAutoPlay();
}

function flip() {
  settings.orientation = settings.orientation === 'w' ? 'b' : 'w';
  saveSettings();
  board.setOrientation(settings.orientation);
  renderStrips();
  renderEval();
}

$('btnNew').onclick = () => newGame();
$('btnFirst').onclick = () => goTo(0);
$('btnBack').onclick = () => goTo(cursor - 1);
$('btnFwd').onclick = () => goTo(cursor + 1);
$('btnLast').onclick = () => goTo(history.length);
$('btnFlip').onclick = flip;
$('btnSolve').onclick = () => { if (analysis) { clearTimeout(autoTimer); playSolverMove(); } };
el.pause.onclick = () => setPaused(!paused);

$('btnLoadFen').onclick = () => {
  const fen = el.fen.value.trim();
  try {
    new Chess(fen);
    newGame(fen);
    toast('Position loaded');
  } catch (err) {
    toast(`Invalid FEN: ${err.message}`);
  }
};
el.fen.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnLoadFen').click(); });
$('btnCopyFen').onclick = () => copy(game.fen(), 'FEN copied');
$('btnCopyPgn').onclick = () => {
  const g = new Chess(startFen);
  for (const h of history) g.move(h);
  const name = (c) => (settings.ctrl[c] === 'solver' ? `Stockfish solver (${settings.elo[c]})` : 'Human');
  g.setHeader('Event', 'Stockfish Elo Terminal');
  g.setHeader('Date', new Date().toISOString().slice(0, 10).replaceAll('-', '.'));
  g.setHeader('White', name('w'));
  g.setHeader('Black', name('b'));
  if (startFen !== DEFAULT_POSITION) { g.setHeader('SetUp', '1'); g.setHeader('FEN', startFen); }
  copy(g.pgn(), 'PGN copied');
};

async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}

$('themeBtn').onclick = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('sfet.theme', root.dataset.theme); } catch {}
};

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea') && e.target.type !== 'checkbox') {
    if (e.target.type !== 'range' || e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') return;
  }
  const actions = {
    ArrowLeft: () => goTo(cursor - 1),
    ArrowRight: () => goTo(cursor + 1),
    Home: () => goTo(0),
    End: () => goTo(history.length),
    ' ': () => $('btnSolve').click(),
    f: flip,
    n: () => newGame(),
    p: () => setPaused(!paused),
  };
  const fn = actions[e.key];
  if (fn && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    fn();
  }
});

// ─────────────────────────── boot ───────────────────────────
board.setOrientation(settings.orientation);
positionChanged();
bootEngine();
