// Study → Training: calculation (play the whole line yourself, or blindfold), Puzzle Rush, and
// endgames you play out against Stockfish. Every mode is a short session with a score.
import { Chess } from '../../vendor/chess.js';
import { AnimBoard, sleep } from './animboard.js';
import { $, $$, esc, miniBoard, stagger, countUp } from './ui.js';
import { wp, evalText, reviewDocName } from './analysis.js';
import { store, ls } from './store.js';
import { dayKey } from './progress.js';
import { ENDGAMES } from './training.js';
import { interactiveQueue } from './review.js';
import { confetti } from './story.js';
import { judgeMove } from './judge.js';

const TR = { tk: 0 };
const GOAL_TEXT = { mate: 'Checkmate', win: 'Win it', draw: 'Hold the draw' };
const LEVEL = ['Easy', 'Medium', 'Hard'];
const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/** Mastery 0-3 from the spaced-repetition record (clean repetitions). */
const mastery = (C, key) => Math.min(3, C.prog.srs[key]?.reps || 0);
const stars = (n) => `<span class="stars" aria-label="${n} of 3 mastered">${[1, 2, 3].map((k) => `<i class="${k <= n ? 'on' : ''}">★</i>`).join('')}</span>`;
const dueState = (C, key) => {
  const e = C.prog.srs[key];
  if (!e) return { k: 'new', t: 'New' };
  if (e.due <= dayKey()) return { k: 'due', t: e.reps ? 'Due today' : 'Try again' };
  return { k: 'ok', t: `Back in ${Math.max(1, Math.round((new Date(e.due) - new Date(dayKey())) / 864e5))} d` };
};

function calcCandidates(C) {
  return C.puzzles().filter((p) => p.theme !== 'Quiet move').sort((a, b) => {
    const due = (e) => (!e ? 1 : e.due <= dayKey() ? 2 : 0);
    return due(C.prog.srs[`calc|${b.id}`]) - due(C.prog.srs[`calc|${a.id}`]) || b.drop - a.drop;
  });
}

// ───────────────────────── hub ─────────────────────────
export function renderTraining(view, C, args = []) {
  TR.tk++;
  if (args[0] === 'eg' && args[1]) { const e = ENDGAMES.find((x) => x.id === args[1]); if (e) { playEndgame(view, C, e); return; } }
  if (args[0] === 'calc') { calcSession(view, C, args[1] === 'blind' ? 'blind' : 'play'); return; }
  if (args[0] === 'rush') { rush(view, C); return; }
  const pool = calcCandidates(C);
  const best = ls.get('sfet.rush.best', 0);
  const egDone = ENDGAMES.filter((e) => mastery(C, `eg|${e.id}`) > 0).length;
  view.innerHTML = `<span class="eyebrow">Study</span><h1 class="h1">Training</h1>
    <p class="lede">Short sessions that build the skills games train slowly: seeing a line through, finding tactics fast, and converting endgames.</p>
    <div class="tr-modes">
      <a class="tr-mode rise" href="#training/calc" ${pool.length ? '' : 'aria-disabled="true"'}>
        <span class="tr-ic" style="--c:var(--engine)">⟶</span><b>Play the line</b>
        <small>A sharp position from your games. Play your move, then their best reply, then your follow-up. Each step is checked.</small>
        <span class="tr-go">${pool.length ? 'Start · 5 positions' : 'Needs reviewed games'} →</span></a>
      <a class="tr-mode rise" href="#training/rush" ${C.puzzles().length ? '' : 'aria-disabled="true"'}>
        <span class="tr-ic" style="--c:var(--cta)">⚡</span><b>Puzzle Rush</b>
        <small>3 minutes, your own puzzles, three mistakes and you're out. Beat your best.</small>
        <span class="tr-go">${best ? `Best: ${best}` : 'Set a score'} →</span></a>
      <a class="tr-mode rise" href="#training/calc/blind" ${pool.length ? '' : 'aria-disabled="true"'}>
        <span class="tr-ic" style="--c:#8a63c9">◉</span><b>Blindfold</b>
        <small>Harder: the pieces don't move. Enter the whole line from your head, then watch it play out.</small>
        <span class="tr-go">Start →</span></a>
    </div>
    <div class="row" style="margin-top:28px"><h2 class="h2" style="margin:0">Endgames to master</h2><span class="spacer"></span><span class="note">${egDone} of ${ENDGAMES.length} solved</span></div>
    <p class="note">Play them out against Stockfish, which defends perfectly. Each one you solve comes back later until it's automatic: three stars = mastered.</p>
    ${[1, 2, 3].map((lv) => `<p class="eyebrow group-title">${LEVEL[lv - 1]}</p><div class="eg-grid">${ENDGAMES.filter((e) => e.level === lv).map((e) => {
      const s = dueState(C, `eg|${e.id}`);
      return `<a class="eg rise" href="#training/eg/${e.id}">${miniBoard(e.fen, e.fen.split(' ')[1])}<span class="eg-body"><span class="chipk ${e.goal === 'draw' ? 'punish' : 'blunder'}">${GOAL_TEXT[e.goal]}</span><b>${esc(e.title)}</b><small class="eg-meta">You play ${e.fen.split(' ')[1] === 'w' ? 'White' : 'Black'}</small><span class="eg-foot">${stars(mastery(C, `eg|${e.id}`))}<span class="pz-st ${s.k}">${s.t}</span></span></span></a>`;
    }).join('')}</div>`).join('')}`;
  stagger(view, 30);
}

/** Session header: progress dots, score and streak. */
function hud(total, results, extra = '') {
  const streak = (() => { let n = 0; for (let i = results.length - 1; i >= 0 && results[i]; i--) n++; return n; })();
  return `<div class="hud"><div class="hud-dots">${Array.from({ length: total }, (_, i) => `<i class="${i < results.length ? (results[i] ? 'ok' : 'no') : i === results.length ? 'cur' : ''}"></i>`).join('')}</div>
    <span class="hud-score"><b>${results.filter(Boolean).length}</b> solved</span>${streak >= 2 ? `<span class="hud-streak">🔥 ${streak} in a row</span>` : ''}${extra}</div>`;
}

function summary(view, title, sub, again) {
  view.innerHTML = `<div class="done-card rise" id="sumCard"><div class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
    <h2 class="h2" style="margin:6px 0">${title}</h2><p class="note">${sub}</p>
    <div class="row" style="justify-content:center"><a class="btn" href="#training">Training</a><a class="btn cta" href="${again}">Go again <span class="arrow">→</span></a></div></div>`;
  confetti($('#sumCard'));
}

// ───────────────────────── calculation ─────────────────────────
async function calcSession(view, C, mode) {
  const tk = ++TR.tk;
  view.innerHTML = '<p class="note">Picking positions from your games…</p>';
  const picked = [];
  for (const p of calcCandidates(C)) {
    if (picked.length >= 5) break;
    const R = await store.get(reviewDocName(p.gid)).catch(() => null);
    const pv = R?.ev?.[p.ply]?.pv || [];
    if (pv.length >= 3) picked.push({ ...p, pv, w: R.ev[p.ply].w });
  }
  if (tk !== TR.tk) return;
  if (!picked.length) { view.innerHTML = '<a class="link back" href="#training">← Training</a><p class="lede">No suitable positions yet: they come from your reviewed games.</p>'; return; }
  const results = [];
  let points = 0;
  const next = () => {
    if (tk !== TR.tk) return;
    if (results.length >= picked.length) {
      summary(view, `${points} of ${picked.length * 3} steps right`, `${results.filter(Boolean).length} of ${picked.length} lines fully right. Lines you missed come back tomorrow.`, `#training/calc${mode === 'blind' ? '/blind' : ''}`);
      return;
    }
    const p = picked[results.length];
    (mode === 'blind' ? calcBlind : calcPlay)(view, C, p, { total: picked.length, results }, (s) => { points += s; results.push(s === 3); next(); });
  };
  next();
}

/** Judge one step of a line with the engine. Returns {ok, best (SAN)}. */
async function judgeStep(fen, san, { reply = false, moverWp = null } = {}) {
  const q = interactiveQueue();
  const c = new Chess(fen);
  const r = await q.go(fen, { depth: 12, multipv: 2 });
  if (!r) return { ok: false, best: null };
  const best = c.move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] }).san;
  if (san === best) return { ok: true, best };
  const t = new Chess(fen);
  t.move(san);
  if (t.isCheckmate()) return { ok: true, best };
  if (reply) {
    // their reply: the engine's choice, or its second line when that is just as good
    if (r.second) {
      const s2 = new Chess(fen).move({ from: r.second.pv[0].slice(0, 2), to: r.second.pv[0].slice(2, 4), promotion: r.second.pv[0][4] }).san;
      if (san === s2 && Math.abs(wp(r.score) - wp(r.second.score)) <= 3) return { ok: true, best };
    }
    return { ok: false, best };
  }
  const before = moverWp ?? wp(r.score);
  if (t.isDraw()) return { ok: before <= 53, best };
  const r2 = await q.go(t.fen(), { depth: 12 });
  return { ok: r2 ? before - (100 - wp(r2.score)) <= 3 : false, best };
}

const STEP_LABEL = ['Your move', 'Their best reply', 'Your follow-up'];

function calcShell(view, p, ctx, mode) {
  const me = p.ply % 2 === 0 ? 'w' : 'b';
  view.innerHTML = `<a class="link back" href="#training">← Training</a>
    ${hud(ctx.total, ctx.results)}
    <div class="pz-session"><div class="pz-board"><div id="ccBoard"></div></div>
      <div class="panel-card pz-panel"><span class="chipk ${mode === 'blind' ? 'punish' : 'blunder'}">${mode === 'blind' ? 'Blindfold' : 'Play the line'}</span>
        <h2 class="h2" style="margin:12px 0 6px" id="ccTitle">${me === 'w' ? 'White' : 'Black'} to move</h2>
        <p id="ccPrompt"></p>
        <div class="calc-slots" id="ccSlots">${STEP_LABEL.map((t, k) => `<span data-k="${k}"><small>${k + 1}</small>${t}</span>`).join('')}</div>
        <p class="feedback" id="ccFb"></p>
        <div class="row" id="ccAct"></div>
        <p class="note" style="margin-top:12px">From your game vs ${esc(p.kind === 'punish' ? p.oppName : p.opp)}${p.fam ? ` · ${esc(p.fam)}` : ''}</p>
      </div></div>`;
  const board = new AnimBoard($('#ccBoard'), { orientation: me });
  board.setFen(p.fen, { animate: false, lastMove: [] });
  return { board, me };
}

const paintSlots = (k, marks = {}, labels = {}) => $$('#ccSlots span').forEach((el, i) => {
  el.classList.toggle('cur', i === k);
  el.classList.toggle('ok', marks[i] === true);
  el.classList.toggle('no', marks[i] === false);
  if (labels[i]) el.innerHTML = `<small>${i + 1}</small>${esc(labels[i])}`;
});

/** Play the line: pieces move; you play your move, their reply, and your follow-up. */
function calcPlay(view, C, p, ctx, onDone) {
  const tk = ++TR.tk;
  const { board, me } = calcShell(view, p, ctx, 'play');
  const c = new Chess(p.fen);
  const marks = {};
  const labels = {};
  let k = 0;
  let score = 0;
  const moverWp = me === 'w' ? p.w : 100 - p.w;
  const prompt = () => {
    $('#ccTitle').textContent = k === 1 ? `Now ${me === 'w' ? 'Black' : 'White'}: their best reply` : `${me === 'w' ? 'White' : 'Black'} to move`;
    $('#ccPrompt').innerHTML = k === 0 ? 'Find the strongest move. Then you will play their best defence yourself, and your follow-up.'
      : k === 1 ? 'Think like your opponent: what is their best answer? Move <b>their</b> piece.'
        : 'And your follow-up?';
    paintSlots(k, marks, labels);
  };
  window.__trFen = () => c.fen();
  const enable = () => board.interactive({
    canPick: (sq) => c.get(sq)?.color === c.turn(),
    targets: (sq) => c.moves({ square: sq, verbose: true }).map((m) => m.to),
    onIllegal: () => board.shake(),
    onMove,
  });
  async function onMove(from, to) {
    const before = c.fen();
    const mv = c.move({ from, to, promotion: 'q' });
    board.setFen(c.fen(), { lastMove: [mv.from, mv.to] });
    board.interactive(null);
    const fb = $('#ccFb');
    fb.className = 'feedback';
    fb.textContent = 'Checking…';
    const j = await judgeStep(before, mv.san, { reply: k === 1, moverWp: k === 0 ? moverWp : null });
    if (tk !== TR.tk) return;
    marks[k] = j.ok;
    labels[k] = j.ok ? mv.san : `${mv.san} → ${j.best}`;
    if (j.ok) {
      score++;
      board.pulse(mv.to, 'var(--success)');
      fb.className = 'feedback ok';
      fb.textContent = k === 1 ? `Yes, ${mv.san} is their best try.` : `${mv.san}. Good.`;
    } else {
      board.shake();
      fb.className = 'feedback no';
      fb.innerHTML = `Not quite: ${k === 1 ? 'their best is' : 'stronger is'} <b>${esc(j.best)}</b>.`;
      await sleep(700);
      if (tk !== TR.tk) return;
      c.undo();
      const m2 = c.move(j.best);
      board.setFen(c.fen(), { lastMove: [m2.from, m2.to] });
      board.setArrows([{ from: m2.from, to: m2.to, color: '#3f7a52', key: `fix${k}` }]);
    }
    k++;
    paintSlots(k, marks, labels);
    await sleep(900);
    if (tk !== TR.tk) return;
    board.setArrows([]);
    if (k >= 3 || c.isGameOver()) { finish(); return; }
    prompt();
    enable();
  }
  async function finish() {
    await C.trainResult(`calc|${p.id}`, score === 3);
    const fb = $('#ccFb');
    fb.className = `feedback ${score === 3 ? 'ok' : ''}`;
    fb.innerHTML = score === 3 ? 'All three right. That is calculation.' : `${score} of 3 right. The engine's line: <span class="mono">${esc(p.pv.slice(0, 5).join(' '))}</span>`;
    if (score === 3) confetti($('.pz-panel'));
    $('#ccAct').innerHTML = `<button class="btn cta" id="ccNext">${ctx.results.length + 1 < ctx.total ? 'Next position' : 'See results'} <span class="arrow">→</span></button><a class="btn" href="#review/${encodeURIComponent(p.gid)}/${p.ply}">See it in the game</a>`;
    $('#ccNext').onclick = () => onDone(score);
  }
  prompt();
  enable();
}

/** Blindfold: the pieces stay put; enter the whole line, then check it. */
function calcBlind(view, C, p, ctx, onDone) {
  const tk = ++TR.tk;
  const { board, me } = calcShell(view, p, ctx, 'blind');
  $('#ccPrompt').innerHTML = 'The pieces stay where they are. Enter <b>your move</b>, <b>their best reply</b> and <b>your follow-up</b> by clicking a piece and then its target square; arrows show what you have entered.';
  board.interactive(null);
  const sim = new Chess(p.fen);
  const entered = [];
  let sel = null;
  const COLORS = ['#2f6fb3', '#8a63c9', '#3f9a63'];
  const paint = () => {
    board.setArrows(entered.map((m, k) => ({ from: m.from, to: m.to, color: COLORS[k], label: String(k + 1), key: `c${k}${m.from}${m.to}` })));
    paintSlots(entered.length, {}, Object.fromEntries(entered.map((m, k) => [k, m.san])));
    board.setMarks({ ...board.marks, selected: sel, targets: sel ? sim.moves({ square: sel, verbose: true }).map((m) => m.to) : [] });
    $('#ccAct').innerHTML = entered.length && entered.length < 3 ? '<button class="btn sm" id="ccUndo">Undo</button>' : '';
    const u = $('#ccUndo');
    if (u) u.onclick = () => { entered.pop(); sim.undo(); paint(); };
  };
  paint();
  const root = $('#ccBoard');
  root.addEventListener('click', (ev) => {
    if (entered.length >= 3 || tk !== TR.tk) return;
    const sq = board.squareAt(ev.clientX, ev.clientY);
    if (!sq) return;
    const pc = sim.get(sq);
    if (pc && pc.color === sim.turn()) { sel = sq; paint(); return; }
    const m = sel && sim.moves({ square: sel, verbose: true }).find((x) => x.to === sq);
    sel = null;
    if (m) { entered.push(sim.move({ from: m.from, to: m.to, promotion: 'q' })); if (entered.length === 3) check(); }
    paint();
  });
  async function check() {
    const fb = $('#ccFb');
    fb.className = 'feedback';
    fb.textContent = 'Checking your line…';
    const marks = {};
    const c = new Chess(p.fen);
    for (let k = 0; k < 3; k++) {
      const before = c.fen();
      const j = await judgeStep(before, entered[k].san, { reply: k === 1, moverWp: k === 0 ? (me === 'w' ? p.w : 100 - p.w) : null });
      if (tk !== TR.tk) return;
      marks[k] = j.ok;
      c.move(entered[k].san);
    }
    const score = Object.values(marks).filter(Boolean).length;
    await C.trainResult(`calc|${p.id}`, score === 3);
    paintSlots(3, marks);
    fb.className = `feedback ${score === 3 ? 'ok' : 'no'}`;
    fb.innerHTML = score === 3 ? 'All three right, without moving a piece.' : `${score} of 3 right. The engine's line: <span class="mono">${esc(p.pv.slice(0, 5).join(' '))}</span>`;
    // play your line, then the engine's
    const show = new Chess(p.fen);
    board.setArrows([]);
    for (const m of entered) {
      await sleep(650);
      if (tk !== TR.tk) return;
      const mv = show.move(m.san);
      board.setFen(show.fen(), { lastMove: [mv.from, mv.to] });
    }
    if (score === 3) confetti($('.pz-panel'));
    $('#ccAct').innerHTML = `<button class="btn cta" id="ccNext">${ctx.results.length + 1 < ctx.total ? 'Next position' : 'See results'} <span class="arrow">→</span></button><a class="btn" href="#review/${encodeURIComponent(p.gid)}/${p.ply}">See it in the game</a>`;
    $('#ccNext').onclick = () => onDone(score);
  }
}

// ───────────────────────── Puzzle Rush ─────────────────────────
function rush(view, C) {
  const tk = ++TR.tk;
  const pool = C.puzzles().slice().sort(() => Math.random() - 0.5);
  if (!pool.length) { view.innerHTML = '<a class="link back" href="#training">← Training</a><p class="lede">Puzzles come from your reviewed games.</p>'; return; }
  const DURATION = 180;
  let left = DURATION;
  let solved = 0;
  let strikes = 0;
  let i = 0;
  let started = false;
  let timer = null;
  const best = ls.get('sfet.rush.best', 0);
  view.innerHTML = `<a class="link back" href="#training">← Training</a>
    <div class="rush-bar"><span class="rush-time" id="rTime">3:00</span><span class="rush-score"><b id="rScore">0</b> solved</span><span class="rush-strikes" id="rStrikes">${'<i></i>'.repeat(3)}</span><span class="note">Best ${best}</span></div>
    <div class="pz-session"><div class="pz-board"><div id="rBoard"></div></div>
      <div class="panel-card pz-panel"><span class="chipk blunder">Puzzle Rush</span>
        <h2 class="h2" style="margin:12px 0 6px" id="rTitle">Ready?</h2>
        <p id="rPrompt">Find the best move. Each correct answer is +1; three mistakes or the clock ends it. The clock starts with your first move.</p>
        <p class="feedback" id="rFb"></p></div></div>`;
  const board = new AnimBoard($('#rBoard'), { orientation: 'w' });
  const end = (why) => {
    clearInterval(timer);
    board.interactive(null);
    const isBest = solved > best;
    if (isBest) ls.set('sfet.rush.best', solved);
    C.trainResult(`rush|${dayKey()}`, true);
    summary(view, `${solved} solved${isBest ? ' · new best!' : ''}`, `${why} Best: ${Math.max(best, solved)}.`, '#training/rush');
  };
  const tick = () => {
    left--;
    const t = $('#rTime');
    if (!t) { clearInterval(timer); return; }
    t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    t.classList.toggle('low', left <= 20);
    if (left <= 0) end("Time's up.");
  };
  const show = () => {
    if (tk !== TR.tk) return;
    const p = pool[i % pool.length];
    i++;
    const me = p.ply % 2 === 0 ? 'w' : 'b';
    const c = new Chess(p.fen);
    board.setOrientation(me);
    board.setFen(c.fen(), { animate: false, lastMove: [] });
    board.setArrows([]);
    $('#rTitle').textContent = `${me === 'w' ? 'White' : 'Black'} to move`;
    $('#rPrompt').textContent = p.kind === 'punish' ? `They just played ${p.opp}. Punish it.` : `In your game you played ${p.played}. Find better.`;
    board.interactive({
      canPick: (sq) => c.get(sq)?.color === c.turn(),
      targets: (sq) => c.moves({ square: sq, verbose: true }).map((m) => m.to),
      onIllegal: () => board.shake(),
      onMove: async (from, to) => {
        if (!started) { started = true; timer = setInterval(tick, 1000); }
        const want = new Chess(p.fen).move(p.best);
        const fen0 = c.fen();
        const mv = c.move({ from, to, promotion: want.from === from && want.to === to && want.promotion ? want.promotion : 'q' });
        board.setFen(c.fen(), { lastMove: [mv.from, mv.to], duration: 160 });
        board.interactive(null);
        const fb = $('#rFb');
        // Lichess-style: the stored move or anything the engine rates as good as it.
        const j = await judgeMove(fen0, mv.san, { expected: want.san, depth: 10 });
        if (tk !== TR.tk || left <= 0) return;
        if (j.ok) {
          solved++;
          $('#rScore').textContent = solved;
          board.pulse(mv.to, 'var(--success)');
          fb.className = 'feedback ok';
          fb.textContent = mv.san === want.san ? `${mv.san} ✓` : `${mv.san} ✓ works too`;
        } else {
          strikes++;
          $$('#rStrikes i').forEach((el, k) => el.classList.toggle('x', k < strikes));
          board.shake();
          fb.className = 'feedback no';
          fb.textContent = `${mv.san} ✗ · ${want.san} was good`;
          board.setArrows([{ from: want.from, to: want.to, color: '#3f7a52', key: 'w' }]);
          if (strikes >= 3) { await sleep(900); end('Three mistakes.'); return; }
        }
        await sleep(j.ok ? 350 : 900);
        show();
      },
    });
  };
  show();
}

// ───────────────────────── endgames ─────────────────────────
function meter(userEval) {
  if (!userEval) return { t: 'Your move', c: 'var(--muted-foreground)', p: 50 };
  const cp = userEval.mate != null ? (userEval.mate > 0 ? 2000 : -2000) : userEval.cp;
  const p = Math.max(3, Math.min(97, wp({ cp })));
  if (userEval.mate != null && userEval.mate > 0) return { t: `Mate in ${userEval.mate}`, c: 'var(--success)', p: 97 };
  if (userEval.mate != null) return { t: 'Getting mated', c: 'var(--destructive)', p: 3 };
  if (cp >= 300) return { t: 'Winning', c: 'var(--success)', p };
  if (cp >= 100) return { t: 'Better', c: 'var(--cl-excellent)', p };
  if (cp > -100) return { t: 'Drawish', c: 'var(--cl-inaccuracy)', p };
  if (cp > -300) return { t: 'Worse', c: 'var(--cl-mistake)', p };
  return { t: 'Losing', c: 'var(--destructive)', p };
}

function playEndgame(view, C, e) {
  const tk = ++TR.tk;
  const me = e.fen.split(' ')[1];
  view.innerHTML = `<a class="link back" href="#training">← Training</a>
    <div class="pz-session"><div class="pz-board"><div id="egBoard"></div></div>
      <div class="panel-card pz-panel"><div class="row"><span class="chipk ${e.goal === 'draw' ? 'punish' : 'blunder'}">${GOAL_TEXT[e.goal]}</span><span class="spacer"></span>${stars(mastery(C, `eg|${e.id}`))}</div>
        <h2 class="h2" style="margin:12px 0 6px">${esc(e.title)}</h2>
        <p>You play ${me === 'w' ? 'White' : 'Black'}. ${e.goal === 'mate' ? 'Deliver checkmate.' : e.goal === 'win' ? 'Promote and keep the win, or mate.' : `Don't lose: hold for ${e.hold} moves.`} Stockfish defends perfectly.</p>
        <div class="eg-status"><div class="eg-meter"><i id="egBar"></i></div><div class="row"><b id="egWord">Your move</b><span class="spacer"></span><span class="mono note" id="egEval"></span></div>
          <div class="row"><span class="note" id="egMoves">Move 0</span>${e.goal === 'draw' ? `<span class="spacer"></span><span class="eg-hold"><i id="egHold"></i></span>` : ''}</div></div>
        <details class="cm-more" open><summary>The idea</summary><p class="note">${esc(e.idea)}</p></details>
        <p class="feedback" id="egFb"></p>
        <div class="row" id="egAct"></div>
      </div></div>`;
  const board = new AnimBoard($('#egBoard'), { orientation: me });
  const q = interactiveQueue();
  const queens0 = new Chess(e.fen).board().flat().filter((p) => p && p.color === me && p.type === 'q').length;
  let c;
  let moves = 0;
  let hinted = false;
  let busy = false;
  const fb = () => $('#egFb');
  const setMeter = (ue) => {
    const m = meter(ue);
    $('#egBar').style.width = `${m.p}%`;
    $('#egBar').style.background = m.c;
    $('#egWord').textContent = m.t;
    $('#egWord').style.color = m.c;
    $('#egEval').textContent = ue ? evalText(ue, true) : '';
  };
  const done = async (ok, msg) => {
    board.interactive(null);
    fb().className = `feedback ${ok ? 'ok' : 'no'}`;
    fb().textContent = msg;
    await C.trainResult(`eg|${e.id}`, ok && !hinted);
    $('#egAct').innerHTML = `<button class="btn ${ok ? '' : 'cta'}" id="egAgain">${ok ? 'Play it again' : 'Try again'}</button><a class="btn ${ok ? 'cta' : ''}" href="#training">More endgames</a>`;
    $('#egAgain').onclick = start;
    if (ok) confetti($('.pz-panel'));
  };
  const judge = (ue) => {
    if (c.isCheckmate()) return c.turn() === me ? [false, 'Checkmated. Try again.'] : [true, 'Checkmate. Well done!'];
    if (c.isDraw()) return e.goal === 'draw' ? [true, 'A draw: you held it.'] : [false, c.isStalemate() ? 'Stalemate! The win slipped away.' : 'That ended in a draw. Try again.'];
    if (!ue) return null;
    const cp = ue.mate != null ? (ue.mate > 0 ? 10000 : -10000) : ue.cp;
    if (e.goal === 'draw') {
      if (cp <= -400) return [false, 'This position is now lost. Try again.'];
      if (moves >= e.hold) return [true, `You held for ${e.hold} moves.`];
    } else if (e.goal === 'win') {
      const queens = c.board().flat().filter((p) => p && p.color === me && p.type === 'q').length;
      if (cp < 150) return [false, 'The win slipped away. Try again.'];
      if (queens > queens0 && cp >= 600) return [true, 'Promoted, and still winning. Done!'];
    } else if (cp < 300) return [false, 'The win slipped away. Try again.'];
    if (moves >= 60) return [false, 'Too many moves. Try a more direct plan.'];
    return null;
  };
  const enable = () => board.interactive({
    canPick: (sq) => !busy && c.get(sq)?.color === me && c.turn() === me,
    targets: (sq) => c.moves({ square: sq, verbose: true }).map((m) => m.to),
    onIllegal: () => board.shake(),
    onMove: async (from, to) => {
      const mv = c.move({ from, to, promotion: 'q' });
      moves++;
      board.setFen(c.fen(), { lastMove: [mv.from, mv.to] });
      board.setMarks({ ...board.marks, hint: [] });
      board.setArrows([]);
      $('#egMoves').textContent = `Move ${moves}${e.goal === 'draw' ? ` of ${e.hold}` : ''}`;
      const h = $('#egHold');
      if (h) h.style.width = `${Math.min(100, (100 * moves) / e.hold)}%`;
      let v = judge(null);
      if (v) { done(...v); return; }
      busy = true;
      $('#egWord').textContent = 'Stockfish is thinking…';
      fb().textContent = '';
      const r = await q.go(c.fen(), { depth: 14, movetime: 1500 });
      if (tk !== TR.tk || !r) return;
      const ue = r.score.mate != null ? { mate: -r.score.mate } : { cp: -r.score.cp };
      setMeter(ue);
      v = judge(ue);
      if (v && !v[0]) { busy = false; done(...v); return; }
      const reply = c.move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] });
      await sleep(250);
      if (tk !== TR.tk) return;
      board.setFen(c.fen(), { lastMove: [reply.from, reply.to] });
      busy = false;
      v = judge(ue);
      if (v) done(...v);
    },
  });
  function start() {
    c = new Chess(e.fen);
    moves = 0;
    hinted = false;
    busy = false;
    board.setFen(c.fen(), { animate: false, lastMove: [] });
    board.setArrows([]);
    fb().textContent = '';
    setMeter(null);
    $('#egMoves').textContent = `Move 0${e.goal === 'draw' ? ` of ${e.hold}` : ''}`;
    const h = $('#egHold');
    if (h) h.style.width = '0';
    $('#egAct').innerHTML = '<button class="btn sm" id="egHint">Hint</button><button class="btn sm ghost" id="egReset">Start over</button>';
    $('#egHint').onclick = async () => {
      hinted = true;
      const r = await q.go(c.fen(), { depth: 16, movetime: 2000 });
      if (!r || tk !== TR.tk) return;
      const m = new Chess(c.fen()).move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] });
      board.setArrows([{ from: m.from, to: m.to, color: '#3f7a52', key: 'hint' }]);
      fb().className = 'feedback';
      fb().textContent = `Try the ${PIECE[m.piece]}.`;
    };
    $('#egReset').onclick = start;
    enable();
  }
  start();
  void countUp;
}
