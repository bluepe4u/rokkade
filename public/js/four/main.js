import {
  newGame, legalMoves, playMove, serialize, deserialize, sq, xOf, yOf, isValidSquare, inCheck,
  pieceType, pieceOwner, moveFrom, moveTo, moveFlags, promotionPiece, describeResult,
  NAMES, KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN, INVALID, FLAG_PROMOTION,
} from './rules.js';
import { chooseMove, analyse, describeMaterial, LEVEL_NAMES } from './bot.js';
import { renderArrows } from '../arrows.js';

// ─────────────────────────── settings ───────────────────────────
const STORE_KEY = 'sfet.four.v1';
const DEFAULTS = {
  mode: 'ffa', ctrl: ['human', 'bot', 'bot', 'bot'], level: [3, 3, 3, 3], view: 'auto', hints: true, coords: true,
  n: 3, hintsHuman: true, hintsBots: false, arrows: true, ffaChoice: false, setup: 'standard',
};
const COLORS = ['#d9473f', '#3f7fd9', '#e3b72c', '#3fa65a'];
const RANK_COLORS = ['#3f9a63', '#3d7fd1', '#c98a2e', '#a65e46', '#8a63c9'];
const BOT_DELAY = 450;    // ms pause so moves can be followed
const ANALYSIS_DELAY = 150;
const ANALYSIS_MS = 2500; // thinking time for the best-moves panel

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { ...DEFAULTS, ...raw, ctrl: DEFAULTS.ctrl.map((c, i) => raw.ctrl?.[i] ?? c), level: DEFAULTS.level.map((l, i) => raw.level?.[i] ?? l) };
  } catch {
    return structuredClone(DEFAULTS);
  }
}
const settings = loadSettings();
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch {} };

const $ = (id) => document.getElementById(id);
const el = {
  board: $('fboard'), banner: $('turnBanner'), score: $('scoreboard'), teamTotals: $('teamTotals'), result: $('resultBox'),
  moves: $('movelist'), status: $('statusBadge'), over: $('gameOver'), toast: $('toast'), seats: $('seats'),
  pause: $('btnPause'), nudge: $('btnNudge'), modeNote: $('modeNote'), promo: $('promo'),
  cands: $('candidates'), searchInfo: $('searchInfo'), hintSummary: $('hintSummary'), arrows: $('farrows').querySelector('g.arrows'),
};

// ─────────────────────────── view rotation ───────────────────────────
// Logical (x, y) has Red at the bottom. A quarter-turn per seat brings that seat to the bottom.
const toDisplay = (x, y, v) => (v === 0 ? [x, y] : v === 1 ? [13 - y, x] : v === 2 ? [13 - x, 13 - y] : [y, 13 - x]);
const fromDisplay = (dx, dy, v) => (v === 0 ? [dx, dy] : v === 1 ? [dy, 13 - dx] : v === 2 ? [13 - dx, 13 - dy] : [13 - dy, dx]);

function currentView() {
  if (settings.view !== 'auto') return Number(settings.view);
  const humans = [0, 1, 2, 3].filter((p) => settings.ctrl[p] === 'human');
  return humans.length === 1 ? humans[0] : 0;
}

// ─────────────────────────── piece images ───────────────────────────
const LETTER = { [KING]: 'K', [QUEEN]: 'Q', [ROOK]: 'R', [BISHOP]: 'B', [KNIGHT]: 'N', [PAWN]: 'P' };
const images = []; // images[owner][type] = data URL
async function loadPieceImages() {
  const svgs = {};
  await Promise.all(Object.entries(LETTER).map(async ([type, letter]) => {
    svgs[type] = await (await fetch(`pieces/w${letter}.svg`)).text();
  }));
  for (let owner = 0; owner < 4; owner++) {
    images[owner] = {};
    for (const type of Object.keys(LETTER)) {
      const svg = svgs[type].replace(/#fff\b/gi, COLORS[owner]);
      images[owner][type] = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }
  }
}
const pieceImg = (owner, type, cls = '') => `<img class="${cls}" src="${images[owner][type]}" alt="">`;

// ─────────────────────────── workers ───────────────────────────
const workerUrl = () => new URL('./bot-worker.js', import.meta.url);

/** Chooses the bots' moves, on one long-lived worker (falls back to the UI thread). */
class BotRunner {
  constructor() {
    this.id = 0;
    this.pending = new Map();
    this.worker = null;
    try {
      this.worker = new Worker(workerUrl(), { type: 'module' });
      this.worker.onmessage = (e) => {
        const entry = this.pending.get(e.data.id);
        if (!entry) return;
        this.pending.delete(e.data.id);
        entry.resolve(e.data.error ? this.direct(entry.state, entry.level) : e.data);
      };
      this.worker.onerror = () => {
        this.worker = null;
        for (const [id, entry] of this.pending) { this.pending.delete(id); entry.resolve(this.direct(entry.state, entry.level)); }
      };
    } catch {
      this.worker = null;
    }
  }

  direct(state, level) { return chooseMove(deserialize(state), level); }

  think(game, level) {
    const state = serialize(game);
    if (!this.worker) return new Promise((resolve) => setTimeout(() => resolve(this.direct(state, level)), 0));
    return new Promise((resolve) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, state, level });
      this.worker.postMessage({ id, state, level });
    });
  }
}

/** Finds the best n moves for the hints panel. One short-lived worker per request, so it can be cancelled. */
class Analyser {
  constructor() { this.worker = null; this.timer = null; }

  cancel() {
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
  }

  start(game, { n, timeMs }, onUpdate) {
    this.cancel();
    const state = serialize(game);
    try {
      this.worker = new Worker(workerUrl(), { type: 'module' });
      const mine = this.worker;
      mine.onmessage = (e) => { if (this.worker === mine) onUpdate(e.data); };
      mine.onerror = () => { if (this.worker === mine) { this.worker = null; this.direct(state, n, onUpdate); } };
      mine.postMessage({ id: 1, type: 'analyse', state, n, timeMs });
    } catch {
      this.direct(state, n, onUpdate);
    }
  }

  direct(state, n, onUpdate) { // no worker support: a short search on the UI thread
    this.timer = setTimeout(() => onUpdate({ type: 'done', ...analyse(deserialize(state), { n, timeMs: 700 }) }), 0);
  }
}
const runner = new BotRunner();
const analyser = new Analyser();

// ─────────────────────────── game state ───────────────────────────
let game = newGame(settings.mode, { choosePromotion: settings.ffaChoice, setup: settings.setup });
let log = [];             // move events
let legal = [];           // legal moves for the player to move
let legalBySquare = new Map();
let selected = null;      // selected square index
let targets = new Map();  // destination index -> legal moves there (several for a promotion choice)
let paused = false;
let thinking = -1;
let botToken = 0;
let botTimer = null;
let drag = null;
let analysis = null;      // { token, player, lines, depth, nodes, final }
let analysisToken = 0;
let analysisTimer = null;
let hover = -1;           // hovered hint card

const humanTurn = () => !game.result && settings.ctrl[game.turn] === 'human';

function refreshLegal() {
  legal = game.result ? [] : legalMoves(game);
  legalBySquare = new Map();
  for (const m of legal) {
    const from = moveFrom(m);
    if (!legalBySquare.has(from)) legalBySquare.set(from, []);
    legalBySquare.get(from).push(m);
  }
}

function select(idx) {
  selected = idx;
  targets = new Map();
  if (idx !== null && legalBySquare.has(idx)) {
    for (const m of legalBySquare.get(idx)) {
      const list = targets.get(moveTo(m)) ?? [];
      list.push(m);
      targets.set(moveTo(m), list);
    }
  }
  hidePromotion();
  renderBoard();
}

function startGame() {
  clearTimeout(botTimer);
  botToken++;
  game = newGame(settings.mode, { choosePromotion: settings.ffaChoice, setup: settings.setup });
  log = [];
  selected = null;
  targets = new Map();
  thinking = -1;
  paused = false;
  el.pause.textContent = 'Pause bots';
  el.pause.classList.remove('active');
  hidePromotion();
  refreshLegal();
  renderAll();
  scheduleBot();
  scheduleAnalysis();
}

function applyMove(m) {
  if (game.result || !legal.includes(m)) return;
  const ev = playMove(game, m);
  log.push(ev);
  selected = null;
  targets = new Map();
  thinking = -1;
  hidePromotion();
  refreshLegal();
  renderAll();
  announce(ev);
  scheduleBot();
  scheduleAnalysis();
}

/** A click or drop on a destination: play it, or ask which piece to promote to. */
function chooseDestination(idx) {
  const moves = targets.get(idx);
  if (!moves) return;
  if (moves.length === 1) applyMove(moves[0]);
  else askPromotion(moves);
}

// ─────────────────────────── promotion picker ───────────────────────────
function askPromotion(moves) {
  const owner = game.turn;
  el.promo.innerHTML = '';
  for (const type of [QUEEN, ROOK, BISHOP, KNIGHT]) {
    const m = moves.find((x) => promotionPiece(x) === type);
    if (!m) continue;
    const b = document.createElement('button');
    b.title = `Promote to ${['', '', 'knight', 'bishop', 'rook', 'queen'][type]}`;
    b.innerHTML = pieceImg(owner, type);
    b.onclick = (e) => { e.stopPropagation(); applyMove(m); };
    el.promo.append(b);
  }
  const cancel = document.createElement('button');
  cancel.className = 'promo-cancel';
  cancel.textContent = '✕';
  cancel.title = 'Cancel';
  cancel.onclick = (e) => { e.stopPropagation(); hidePromotion(); select(null); };
  el.promo.append(cancel);
  el.promo.hidden = false;
}
function hidePromotion() { el.promo.hidden = true; el.promo.innerHTML = ''; }

// ─────────────────────────── bots ───────────────────────────
function scheduleBot() {
  clearTimeout(botTimer);
  const mine = ++botToken;
  thinking = -1;
  if (game.result || paused) { renderBanner(); return; }
  const p = game.turn;
  if (settings.ctrl[p] !== 'bot') { renderBanner(); return; }
  thinking = p;
  renderBanner();
  botTimer = setTimeout(() => botMove(mine), BOT_DELAY);
}

async function botMove(token) {
  const p = game.turn;
  const r = await runner.think(game, settings.level[p]);
  if (token !== botToken || game.result) return;
  thinking = -1;
  if (r && r.move !== null && r.move !== undefined) applyMove(r.move);
}

function announce(ev) {
  const notes = [];
  for (const e of ev.eliminated) {
    if (e.reason === 'checkmate') notes.push(`${NAMES[e.player]} is checkmated${e.by >= 0 && e.by !== undefined ? ` by ${NAMES[e.by]}` : ''}`);
    else notes.push(`${NAMES[e.player]} is stalemated`);
  }
  if (moveFlags(ev.move) & FLAG_PROMOTION) notes.push(`${NAMES[ev.player]} promotes`);
  if (!ev.eliminated.length && ev.checks.length && !ev.over) notes.push(`Check on ${ev.checks.map((q) => NAMES[q]).join(' and ')}`);
  if (ev.over) notes.push(describeResult(game));
  if (notes.length) toast(notes.join(' · '));
}

let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3600);
}

// ─────────────────────────── engine hints ───────────────────────────
const hintsWanted = () => !game.result && (settings.ctrl[game.turn] === 'human' ? settings.hintsHuman : settings.hintsBots);

function scheduleAnalysis() {
  clearTimeout(analysisTimer);
  analyser.cancel();
  const mine = ++analysisToken;
  hover = -1;
  analysis = null;
  if (!hintsWanted()) { renderHints(); return; }
  analysis = { token: mine, player: game.turn, lines: [], depth: 0, nodes: 0, final: false };
  renderHints();
  analysisTimer = setTimeout(() => {
    analyser.start(game, { n: settings.n, timeMs: ANALYSIS_MS }, (msg) => {
      if (mine !== analysisToken || !analysis || msg.type === 'error') return;
      analysis.lines = msg.lines ?? analysis.lines;
      analysis.depth = msg.depth ?? analysis.depth;
      analysis.nodes = msg.nodes ?? analysis.nodes;
      analysis.final = msg.type === 'done';
      renderHints();
    });
  }, ANALYSIS_DELAY);
}

const formatEval = (v) => {
  if (Math.abs(v) > 90000) return v > 0 ? 'mate' : '−mate';
  const x = v / 100;
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`;
};

function squareCentre(idx) {
  const [dx, dy] = toDisplay(xOf(idx), yOf(idx), currentView());
  const cell = 800 / 14;
  return [(dx + 0.5) * cell, (13 - dy + 0.5) * cell];
}

function renderHints() {
  const a = analysis;
  el.cands.innerHTML = '';
  if (!a) {
    el.searchInfo.textContent = 'off';
    el.searchInfo.classList.remove('live');
    el.hintSummary.textContent = game.result ? 'The game is over.' : 'Hints are off for this turn. Turn them on under Engine hints.';
    drawArrows();
    return;
  }
  const p = a.player;
  el.hintSummary.innerHTML = `<b>${NAMES[p]}</b> to move${game.mode === 'teams' ? ` (with ${NAMES[(p + 2) & 3]})` : ''}`;
  el.searchInfo.textContent = a.depth ? `${a.final ? 'depth' : 'searching'} ${a.depth} · ${a.nodes >= 1000 ? `${Math.round(a.nodes / 1000)}k` : a.nodes} nodes` : 'thinking…';
  el.searchInfo.classList.toggle('live', !a.final);
  if (!a.lines.length) {
    for (let i = 0; i < Math.min(settings.n, legal.length); i++) el.cands.insertAdjacentHTML('beforeend', '<li class="cand skeleton"><span></span></li>');
    drawArrows();
    return;
  }
  a.lines.forEach((l, i) => {
    const chipCls = l.delta > 0 ? 'up' : l.delta < 0 ? 'down' : 'flat';
    const chip = l.delta > 0 ? `+${l.delta}` : l.delta < 0 ? `−${-l.delta}` : '±0';
    const icons = (list) => list.map((c) => pieceImg(c.owner, c.type)).join('');
    const pv = l.steps.map((s) => `<span class="pvd" style="--c:${COLORS[s.player]}"></span>${s.text}`).join(' ');
    const li = document.createElement('li');
    li.className = 'cand';
    li.style.setProperty('--rank', RANK_COLORS[i % RANK_COLORS.length]);
    li.innerHTML = `
      <span class="cand-rank">${i + 1}</span>
      <div class="cand-main">
        <div class="cand-top">
          <span class="cand-san">${l.steps[0].text}</span>
          <span class="cand-eval mono" title="Evaluation from ${NAMES[p]}'s side: material and position, assuming everyone not on that side plays against it">${formatEval(l.value)}</span>
        </div>
        <div class="cand-material">
          <span class="mat-chip ${chipCls}" title="Points ${NAMES[p]}'s side wins minus loses along this line">${chip}</span>
          <span class="mat-text">${describeMaterial(l)}</span>
          <span class="mat-pieces">
            ${l.gained.length ? `<span class="gain">${icons(l.gained)}</span>` : ''}
            ${l.lost.length ? `<span class="loss">${icons(l.lost)}</span>` : ''}
          </span>
        </div>
        <div class="cand-pv mono">${pv}</div>
      </div>`;
    li.title = humanTurn() ? 'Click to play this move' : '';
    li.addEventListener('mouseenter', () => { hover = i; drawArrows(); });
    li.addEventListener('mouseleave', () => { hover = -1; drawArrows(); });
    li.addEventListener('click', () => {
      if (!humanTurn() || a.token !== analysisToken) return;
      applyMove(l.move);
    });
    el.cands.append(li);
  });
  drawArrows();
}

function drawArrows() {
  const a = analysis;
  if (!a || !settings.arrows || !a.lines.length) { renderArrows(el.arrows, []); return; }
  if (hover >= 0 && a.lines[hover]) {
    const l = a.lines[hover];
    renderArrows(el.arrows, l.steps.map((s, j) => {
      const [x1, y1] = squareCentre(moveFrom(s.move));
      const [x2, y2] = squareCentre(moveTo(s.move));
      return { x1, y1, x2, y2, color: COLORS[s.player], width: j === 0 ? 13 : 9, opacity: Math.max(0.4, 0.9 - j * 0.1), label: String(j + 1) };
    }));
    return;
  }
  // weakest first so the best arrow ends up on top
  renderArrows(el.arrows, [...a.lines].reverse().map((l) => {
    const [x1, y1] = squareCentre(moveFrom(l.move));
    const [x2, y2] = squareCentre(moveTo(l.move));
    const i = l.rank - 1;
    return { x1, y1, x2, y2, color: RANK_COLORS[i % RANK_COLORS.length], width: 13 - i, opacity: 0.85 - 0.08 * i, label: String(l.rank) };
  }));
}

// ─────────────────────────── board ───────────────────────────
const cells = [];
for (let i = 0; i < 196; i++) {
  const c = document.createElement('div');
  c.className = 'sq hole';
  el.board.append(c);
  cells.push(c);
}

function renderBoard() {
  const v = currentView();
  const mover = game.turn;
  const checked = new Set([0, 1, 2, 3].filter((p) => inCheck(game, p)).map((p) => game.kingSq[p]));
  const last = game.lastMove;
  el.board.classList.toggle('my-turn', humanTurn());
  for (let row = 0; row < 14; row++) {
    for (let col = 0; col < 14; col++) {
      const cell = cells[row * 14 + col];
      const [x, y] = fromDisplay(col, 13 - row, v);
      const idx = sq(x, y);
      if (!isValidSquare(idx)) {
        if (cell.className !== 'sq hole') { cell.className = 'sq hole'; cell.textContent = ''; }
        continue;
      }
      const piece = game.board[idx];
      const own = piece && piece !== INVALID && pieceOwner(piece) === mover && !game.eliminated[mover];
      let cls = `sq ${(x + y) % 2 ? 'light' : 'dark'}`;
      if (last && (idx === last.from || idx === last.to)) cls += ' last';
      if (idx === selected) cls += ' selected';
      if (settings.hints && targets.has(idx)) cls += game.board[idx] ? ' target capture' : ' target';
      if (checked.has(idx)) cls += ' in-check';
      if (own && humanTurn()) cls += ' mine';
      if (cell.className !== cls) cell.className = cls;
      cell.dataset.sq = idx;

      let img = cell.querySelector('img.piece');
      if (piece && piece !== INVALID) {
        const src = images[pieceOwner(piece)]?.[pieceType(piece)] ?? '';
        if (!img) {
          img = document.createElement('img');
          img.draggable = false;
          img.alt = '';
          cell.append(img);
        }
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        const dead = game.eliminated[pieceOwner(piece)];
        img.className = `piece${dead ? ' dead' : ''}${drag?.active && drag.from === idx ? ' dragging' : ''}`;
      } else if (img) {
        img.remove();
      }

      // coordinates along the bottom and left edges of the board as drawn
      let label = '';
      if (settings.coords) {
        if (row === 13) label = v % 2 === 0 ? String.fromCharCode(97 + x) : String(y + 1);
        else if (col === 0) label = v % 2 === 0 ? String(y + 1) : String.fromCharCode(97 + x);
      }
      let tag = cell.querySelector('.coord');
      if (label) {
        if (!tag) { tag = document.createElement('span'); cell.append(tag); }
        tag.className = `coord ${row === 13 ? 'file' : 'rank'}`;
        if (tag.textContent !== label) tag.textContent = label;
      } else if (tag) {
        tag.remove();
      }
    }
  }
  drawArrows();
}

function squareAt(clientX, clientY) {
  const r = el.board.getBoundingClientRect();
  const col = Math.floor(((clientX - r.left) / r.width) * 14);
  const row = Math.floor(((clientY - r.top) / r.height) * 14);
  if (col < 0 || col > 13 || row < 0 || row > 13) return -1;
  const [x, y] = fromDisplay(col, 13 - row, currentView());
  const idx = sq(x, y);
  return isValidSquare(idx) ? idx : -1;
}

el.board.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !humanTurn() || !el.promo.hidden) return;
  const idx = squareAt(e.clientX, e.clientY);
  if (idx < 0) return;
  if (selected !== null && targets.has(idx)) { chooseDestination(idx); return; }
  const piece = game.board[idx];
  if (piece && piece !== INVALID && pieceOwner(piece) === game.turn && legalBySquare.has(idx)) {
    e.preventDefault();
    const wasSelected = selected === idx;
    select(idx);
    drag = { from: idx, x: e.clientX, y: e.clientY, active: false, wasSelected, ghost: null };
  } else {
    select(null);
  }
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.active && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) {
    drag.active = true;
    const piece = game.board[drag.from];
    const size = el.board.getBoundingClientRect().width / 14;
    drag.ghost = document.createElement('img');
    drag.ghost.src = images[pieceOwner(piece)][pieceType(piece)];
    drag.ghost.className = 'drag-ghost';
    drag.ghost.style.width = drag.ghost.style.height = `${size}px`;
    document.body.append(drag.ghost);
    renderBoard();
  }
  if (drag.active) {
    const size = parseFloat(drag.ghost.style.width);
    drag.ghost.style.transform = `translate(${e.clientX - size / 2}px, ${e.clientY - size / 2}px)`;
  }
});

window.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.ghost?.remove();
  const idx = squareAt(e.clientX, e.clientY);
  if (d.active) {
    if (idx >= 0 && targets.has(idx)) chooseDestination(idx);
    else renderBoard();
  } else if (d.wasSelected && idx === d.from) {
    select(null);
  }
});

// ─────────────────────────── panels ───────────────────────────
const botLabel = (p) => `Bot · ${LEVEL_NAMES[settings.level[p]]}`;

function renderBanner() {
  const b = el.banner;
  if (game.result) {
    b.style.setProperty('--c', 'var(--cta)');
    b.innerHTML = `<span class="dot"></span><span class="who">Game over</span><span class="sub">${describeResult(game)}</span>`;
  } else {
    const p = game.turn;
    b.style.setProperty('--c', COLORS[p]);
    const who = settings.ctrl[p] === 'human' ? 'Human' : botLabel(p);
    const status = inCheck(game, p) ? ' — in check' : '';
    const sub = paused && settings.ctrl[p] === 'bot' ? 'paused' : thinking === p ? '<span class="thinking">thinking…</span>' : who;
    b.innerHTML = `<span class="dot"></span><span class="who">${NAMES[p]} to move${status}</span><span class="sub">${sub}</span>`;
  }
  el.nudge.hidden = !(paused && !game.result && settings.ctrl[game.turn] === 'bot');
}

function renderScoreboard() {
  el.score.innerHTML = '';
  const teams = game.mode === 'teams';
  for (let p = 0; p < 4; p++) {
    const card = document.createElement('div');
    card.className = `pcard${!game.result && game.turn === p && !game.eliminated[p] ? ' to-move' : ''}${game.eliminated[p] ? ' out' : ''}`;
    card.style.setProperty('--c', COLORS[p]);
    const tags = [];
    if (teams) tags.push(`<span class="tag team">with ${NAMES[(p + 2) & 3]}</span>`);
    if (inCheck(game, p)) tags.push('<span class="tag check">CHECK</span>');
    if (game.eliminated[p]) tags.push('<span class="tag out">OUT</span>');
    card.innerHTML = `
      <span class="swatch"><img src="pieces/wK.svg" alt=""></span>
      <span class="nm">${NAMES[p]}${tags.join('')}</span>
      <span class="pts mono">${game.score[p]}<small>points</small></span>
      <span class="sub">${settings.ctrl[p] === 'human' ? 'Human' : botLabel(p)}</span>`;
    el.score.append(card);
  }
  el.teamTotals.hidden = !teams;
  if (teams) {
    const a = game.score[0] + game.score[2];
    const b = game.score[1] + game.score[3];
    el.teamTotals.innerHTML = `<div class="tt">Red + Yellow<b>${a}</b></div><div class="tt">Blue + Green<b>${b}</b></div>`;
  }
  el.result.hidden = !game.result;
  if (game.result) {
    const r = game.result;
    let html = `<div>${describeResult(game)}</div>`;
    if (r.ranking) {
      html += `<ol>${r.ranking.map((p) => `<li><b style="color:${COLORS[p]}">${NAMES[p]}</b> — ${game.score[p]} points${game.eliminated[p] ? ' (out)' : ''}</li>`).join('')}</ol>`;
    }
    el.result.innerHTML = html;
  }
  el.over.hidden = !game.result;
  el.over.textContent = game.result ? describeResult(game) : '';
  el.status.textContent = game.result ? 'finished' : `move ${log.length + 1}`;
}

function renderMoves() {
  el.moves.innerHTML = '';
  if (!log.length) {
    el.moves.innerHTML = '<li class="empty-list">Red moves first. Click a piece, then a highlighted square, or drag it.</li>';
    return;
  }
  let li = null;
  let round = 0;
  let lastP = 99;
  log.forEach((ev, i) => {
    if (!li || ev.player <= lastP) {
      round++;
      li = document.createElement('li');
      li.innerHTML = `<span class="mv-no">${round}.</span>`;
      el.moves.append(li);
    }
    lastP = ev.player;
    const chip = document.createElement('span');
    chip.className = `chip4${i === log.length - 1 ? ' latest' : ''}`;
    chip.style.setProperty('--c', COLORS[ev.player]);
    const mark = ev.eliminated.some((e) => e.reason === 'checkmate') ? '#' : ev.eliminated.length ? '=' : ev.checks.length ? '+' : '';
    const pts = ev.delta[ev.player] > 0 ? `<em>+${ev.delta[ev.player]}</em>` : '';
    chip.innerHTML = `${ev.text}${mark}${pts}`;
    li.append(chip);
  });
  el.moves.lastElementChild?.scrollIntoView({ block: 'nearest' });
}

function renderAll() {
  renderBoard();
  renderBanner();
  renderScoreboard();
  renderMoves();
}

// ─────────────────────────── setup controls ───────────────────────────
function buildSeats() {
  el.seats.innerHTML = '';
  for (let p = 0; p < 4; p++) {
    const row = document.createElement('div');
    row.className = `seat ${settings.ctrl[p]}`;
    row.style.setProperty('--c', COLORS[p]);
    row.innerHTML = `
      <span class="seat-swatch"></span>
      <span class="seat-name">${NAMES[p]}<small>${['bottom', 'left', 'top', 'right'][p]}</small></span>
      <div class="segmented" role="radiogroup" aria-label="${NAMES[p]} controller">
        <button data-c="human" role="radio" aria-checked="${settings.ctrl[p] === 'human'}">Human</button>
        <button data-c="bot" role="radio" aria-checked="${settings.ctrl[p] === 'bot'}">Bot</button>
      </div>
      <label class="level">Strength
        <input type="range" min="1" max="4" step="1" value="${settings.level[p]}" aria-label="${NAMES[p]} bot strength" />
        <b>${LEVEL_NAMES[settings.level[p]]}</b>
      </label>`;
    row.querySelectorAll('[data-c]').forEach((btn) => btn.addEventListener('click', () => {
      settings.ctrl[p] = btn.dataset.c;
      save();
      buildSeats();
      renderAll();
      if (game.turn === p) { scheduleBot(); scheduleAnalysis(); }
    }));
    const range = row.querySelector('input');
    range.addEventListener('input', () => {
      settings.level[p] = Number(range.value);
      row.querySelector('.level b').textContent = LEVEL_NAMES[settings.level[p]];
      save();
      renderScoreboard();
    });
    el.seats.append(row);
  }
}

function syncMode() {
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode)));
  el.modeNote.textContent = settings.mode === 'ffa'
    ? 'Everyone against everyone. Score points for captures and checkmates; the game ends after three eliminations.'
    : 'Red + Yellow against Blue + Green. Teammates cannot capture each other; the first checkmate wins.';
}
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  if (settings.mode === b.dataset.mode) return;
  settings.mode = b.dataset.mode;
  save();
  syncMode();
  startGame();
}));

$('btnNew').onclick = startGame;
$('setupSel').value = settings.setup;
$('setupSel').onchange = (e) => { settings.setup = e.target.value; save(); startGame(); };
$('viewSel').value = String(settings.view);
$('viewSel').onchange = (e) => { settings.view = e.target.value; save(); renderBoard(); };
for (const [id, key, after] of [
  ['inHints', 'hints', () => renderBoard()],
  ['inCoords', 'coords', () => renderBoard()],
  ['inFfaChoice', 'ffaChoice', () => {}],
  ['inHintsHuman', 'hintsHuman', () => scheduleAnalysis()],
  ['inHintsBots', 'hintsBots', () => scheduleAnalysis()],
  ['inArrows', 'arrows', () => drawArrows()],
]) {
  const input = $(id);
  input.checked = settings[key];
  input.onchange = () => { settings[key] = input.checked; save(); after(); };
}
$('inN').value = settings.n;
$('outN').textContent = settings.n;
$('inN').oninput = (e) => {
  settings.n = Number(e.target.value);
  $('outN').textContent = settings.n;
  save();
  scheduleAnalysis();
};

function rotate() {
  settings.view = String((currentView() + 1) % 4);
  $('viewSel').value = settings.view;
  save();
  renderBoard();
}
$('btnTurn').onclick = rotate;

function togglePause() {
  paused = !paused;
  el.pause.textContent = paused ? 'Resume bots' : 'Pause bots';
  el.pause.classList.toggle('active', paused);
  scheduleBot();
}
el.pause.onclick = togglePause;

function stepBot() {
  if (!paused || game.result || settings.ctrl[game.turn] !== 'bot') return;
  const mine = ++botToken;
  thinking = game.turn;
  renderBanner();
  botMove(mine);
}
el.nudge.onclick = stepBot;


document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  const actions = { n: startGame, r: rotate, p: togglePause, ' ': stepBot };
  const fn = actions[e.key.toLowerCase()];
  if (fn) { e.preventDefault(); fn(); }
});

// Test hook: open four.html?debug and load an arbitrary position (see test scripts), bots paused.
if (new URLSearchParams(location.search).has('debug')) {
  window.fourDebug = {
    load(state) {
      clearTimeout(botTimer);
      botToken++;
      game = state;
      log = [];
      paused = true;
      selected = null;
      targets = new Map();
      hidePromotion();
      refreshLegal();
      renderAll();
      scheduleAnalysis();
    },
    get game() { return game; },
  };
}

// ─────────────────────────── boot ───────────────────────────
syncMode();
buildSeats();
loadPieceImages().then(() => {
  refreshLegal();
  renderAll();
  scheduleBot();
  scheduleAnalysis();
}).catch((err) => {
  console.error(err);
  toast('Could not load the piece images. Open the page through start.bat / node server.js.');
});

