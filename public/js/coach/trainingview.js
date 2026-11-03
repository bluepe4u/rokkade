// Study → Training: endgames you play out against Stockfish, and calculation drills where you
// enter the whole line on a still board before anything moves.
import { Chess } from '../../vendor/chess.js';
import { AnimBoard, sleep } from './animboard.js';
import { $, $$, esc, miniBoard, stagger } from './ui.js';
import { wp, evalText, reviewDocName } from './analysis.js';
import { store } from './store.js';
import { moveLabel } from './library.js';
import { dayKey } from './progress.js';
import { ENDGAMES } from './training.js';
import { interactiveQueue } from './review.js';

const TR = { tk: 0 };
const GOAL_TEXT = { mate: 'Checkmate', win: 'Win it', draw: 'Hold the draw' };
const srsState = (C, key) => {
  const e = C.prog.srs[key];
  if (!e) return { k: 'new', t: 'New' };
  if (e.due <= dayKey()) return { k: 'due', t: e.reps ? 'Due today' : 'Try again' };
  return { k: 'ok', t: `Done · back in ${Math.max(1, Math.round((new Date(e.due) - new Date(dayKey())) / 864e5))} d` };
};

export function renderTraining(view, C, args = []) {
  TR.tk++;
  if (args[0] === 'eg' && args[1]) { const e = ENDGAMES.find((x) => x.id === args[1]); if (e) { playEndgame(view, C, e); return; } }
  if (args[0] === 'calc') { calcSession(view, C); return; }
  const egs = ENDGAMES.slice().sort((a, b) => a.level - b.level);
  const calcPool = calcCandidates(C);
  view.innerHTML = `<span class="eyebrow">Study</span><h1 class="h1">Training</h1>
    <p class="lede">Two skills that games alone train slowly: converting and holding endgames, and calculating a line before you play it.</p>
    <section class="tr-hero rise">
      <div><span class="eyebrow">Calculation</span><h2 class="h3" style="font-size:20px">See it before you play it</h2>
        <p class="note">A position from your own games. Enter your move, their best reply and your follow-up on a board that doesn't move, then check the line against the engine.</p>
        <a class="btn cta" href="#training/calc" ${calcPool.length ? '' : 'aria-disabled="true"'}>${calcPool.length ? `Start · ${Math.min(5, calcPool.length)} positions` : 'Needs reviewed games'} <span class="arrow">→</span></a></div>
      <div class="tr-steps"><span><b>1</b>Your move</span><span><b>2</b>Their best reply</span><span><b>3</b>Your follow-up</span><span><b>✓</b>Check</span></div>
    </section>
    <h2 class="h2">Endgames to master</h2>
    <div class="eg-grid">${egs.map((e) => {
      const s = srsState(C, `eg|${e.id}`);
      return `<a class="eg rise" href="#training/eg/${e.id}">${miniBoard(e.fen, e.fen.split(' ')[1])}<span class="eg-body"><span class="chipk ${e.goal === 'draw' ? 'punish' : 'blunder'}">${GOAL_TEXT[e.goal]}</span><b>${esc(e.title)}</b><small class="eg-meta"><span class="lvl" title="Difficulty" aria-label="Difficulty ${e.level} of 3">${[1, 2, 3].map((k) => `<i class="${k <= e.level ? 'on' : ''}"></i>`).join('')}</span>${['Easy', 'Medium', 'Hard'][e.level - 1]} · ${e.fen.split(' ')[1] === 'w' ? 'White' : 'Black'}</small><span class="pz-st ${s.k}">${s.t}</span></span></a>`;
    }).join('')}</div>`;
  stagger(view, 30);
}

// ───────────────────────── endgames ─────────────────────────
function playEndgame(view, C, e) {
  const tk = ++TR.tk;
  const me = e.fen.split(' ')[1];
  view.innerHTML = `<a class="link back" href="#training">← Training</a>
    <div class="pz-session"><div class="pz-board"><div id="egBoard"></div></div>
      <div class="panel-card pz-panel"><span class="chipk ${e.goal === 'draw' ? 'punish' : 'blunder'}">${GOAL_TEXT[e.goal]}</span>
        <h2 class="h2" style="margin:12px 0 6px">${esc(e.title)}</h2>
        <p>You play ${me === 'w' ? 'White' : 'Black'}. ${e.goal === 'mate' ? 'Deliver checkmate.' : e.goal === 'win' ? 'Promote and keep the win (or mate).' : `Don't lose: hold for ${e.hold} moves.`} Stockfish defends perfectly.</p>
        <details class="cm-more"><summary>The idea</summary><p class="note">${esc(e.idea)}</p></details>
        <div class="eg-meter"><span id="egMoves">Move 0</span><span id="egEval" class="mono"></span></div>
        <p class="feedback" id="egFb"></p>
        <div class="row" id="egAct"><button class="btn sm" id="egHint">Hint</button><button class="btn sm ghost" id="egReset">Start over</button></div>
      </div></div>`;
  const board = new AnimBoard($('#egBoard'), { orientation: me });
  const q = interactiveQueue();
  let c;
  let moves = 0;
  let hinted = false;
  let busy = false;
  const fb = $('#egFb');
  const startMat = (side) => [...new Chess(e.fen).board().flat()].filter((p) => p && p.color === side && p.type === 'q').length;
  const queens0 = startMat(me);
  const done = async (ok, msg) => {
    board.interactive(null);
    fb.className = `feedback ${ok ? 'ok' : 'no'}`;
    fb.textContent = msg;
    await C.trainResult(`eg|${e.id}`, ok && !hinted);
    $('#egAct').innerHTML = `<button class="btn ${ok ? '' : 'cta'}" id="egAgain">${ok ? 'Play it again' : 'Try again'}</button><a class="btn ${ok ? 'cta' : ''}" href="#training">More endgames</a>`;
    $('#egAgain').onclick = start;
    if (ok) board.pulse(board.marks.last?.[1] || 'e4', 'var(--success)');
  };
  const judge = (userEval) => {
    // userEval: score from the user's side ({cp}|{mate})
    if (c.isCheckmate()) return c.turn() === me ? [false, 'Checkmated. Try again.'] : [true, 'Checkmate. Well done!'];
    if (c.isDraw()) return e.goal === 'draw' ? [true, 'A draw: you held it.'] : [false, c.isStalemate() ? 'Stalemate! The win slipped away.' : 'That ended in a draw. Try again.'];
    if (!userEval) return null;
    const cp = userEval.mate != null ? (userEval.mate > 0 ? 10000 : -10000) : userEval.cp;
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
      let v = judge(null);
      if (v) { done(...v); return; }
      busy = true;
      fb.className = 'feedback';
      fb.textContent = '';
      const r = await q.go(c.fen(), { depth: 14, movetime: 1500 });
      if (tk !== TR.tk || !r) return;
      const userEval = r.score.mate != null ? { mate: -r.score.mate } : { cp: -r.score.cp };
      $('#egEval').textContent = evalText(userEval, true);
      v = judge(userEval);
      if (v && !v[0]) { busy = false; done(...v); return; }
      const reply = c.move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] });
      await sleep(250);
      if (tk !== TR.tk) return;
      board.setFen(c.fen(), { lastMove: [reply.from, reply.to] });
      busy = false;
      v = judge(userEval);
      if (v) { done(...v); return; }
    },
  });
  function start() {
    c = new Chess(e.fen);
    moves = 0;
    hinted = false;
    busy = false;
    board.setFen(c.fen(), { animate: false, lastMove: [] });
    board.setArrows([]);
    fb.textContent = '';
    $('#egMoves').textContent = 'Move 0';
    $('#egEval').textContent = '';
    $('#egAct').innerHTML = '<button class="btn sm" id="egHint">Hint</button><button class="btn sm ghost" id="egReset">Start over</button>';
    $('#egHint').onclick = async () => {
      hinted = true;
      const r = await q.go(c.fen(), { depth: 16, movetime: 2000 });
      if (!r || tk !== TR.tk) return;
      board.setArrows([{ from: r.best.slice(0, 2), to: r.best.slice(2, 4), color: '#3f7a52', key: 'hint' }]);
    };
    $('#egReset').onclick = start;
    enable();
  }
  start();
}

// ───────────────────────── calculation ─────────────────────────
function calcCandidates(C) {
  return C.puzzles().filter((p) => p.theme !== 'Quiet move').sort((a, b) => {
    const da = C.prog.srs[`calc|${a.id}`];
    const db = C.prog.srs[`calc|${b.id}`];
    const due = (e) => (!e ? 1 : e.due <= dayKey() ? 2 : 0);
    return due(db) - due(da) || b.drop - a.drop;
  });
}

async function calcSession(view, C) {
  const pool = calcCandidates(C);
  const picked = [];
  for (const p of pool) {
    if (picked.length >= 5) break;
    const R = await store.get(reviewDocName(p.gid)).catch(() => null);
    const pv = R?.ev?.[p.ply]?.pv || [];
    if (pv.length >= 3) picked.push({ ...p, pv, w: R.ev[p.ply].w });
  }
  if (!picked.length) { view.innerHTML = '<a class="link back" href="#training">← Training</a><p class="lede">No suitable positions yet: they come from your reviewed games.</p>'; return; }
  let i = 0;
  let score = 0;
  const next = () => { if (i >= picked.length) finish(); else calcOne(view, C, picked[i], i, picked.length, (s) => { score += s; i++; next(); }); };
  const finish = () => {
    view.innerHTML = `<div class="done-card rise"><div class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h2 class="h2" style="margin:6px 0">${score} of ${picked.length * 3} steps right</h2><p class="note">Positions you got fully right come back later; the others tomorrow.</p>
      <div class="row" style="justify-content:center"><a class="btn" href="#training">Training</a><a class="btn cta" href="#training/calc">Another round</a></div></div>`;
  };
  next();
}

function calcOne(view, C, p, idx, total, onDone) {
  const tk = ++TR.tk;
  const me = p.ply % 2 === 0 ? 'w' : 'b';
  view.innerHTML = `<a class="link back" href="#training">← Training</a>
    <div class="pz-session"><div class="pz-board"><div id="ccBoard"></div></div>
      <div class="panel-card pz-panel"><div class="row"><span class="chipk blunder">Calculation</span><span class="spacer"></span><span class="note">${idx + 1} of ${total}</span></div>
        <h2 class="h2" style="margin:12px 0 6px">${me === 'w' ? 'White' : 'Black'} to move</h2>
        <p>Without moving anything, enter the line you'd play: <b>your move</b>, <b>their best reply</b>, <b>your follow-up</b>. Pieces stay put; arrows show what you've entered.</p>
        <div class="calc-slots" id="ccSlots"><span>1 · your move</span><span>2 · their reply</span><span>3 · your follow-up</span></div>
        <p class="feedback" id="ccFb"></p>
        <div class="row" id="ccAct"><button class="btn sm" id="ccUndo">Undo</button></div>
      </div></div>`;
  const board = new AnimBoard($('#ccBoard'), { orientation: me });
  board.setFen(p.fen, { animate: false, lastMove: [] });
  board.interactive(null);
  const sim = new Chess(p.fen);
  const entered = [];
  let sel = null;
  const COLORS = ['#2f6fb3', '#8a63c9', '#3f9a63'];
  const paint = () => {
    board.setArrows(entered.map((m, k) => ({ from: m.from, to: m.to, color: COLORS[k], label: String(k + 1), key: `c${k}${m.from}${m.to}` })), { draw: true });
    $$('#ccSlots span').forEach((s, k) => { s.classList.toggle('ok', k < entered.length); s.classList.toggle('cur', k === entered.length); s.textContent = k < entered.length ? `${k + 1} · ${entered[k].san}` : ['1 · your move', '2 · their reply', '3 · your follow-up'][k]; });
    board.setMarks({ ...board.marks, selected: sel, targets: sel ? sim.moves({ square: sel, verbose: true }).map((m) => m.to) : [] });
  };
  paint();
  const root = $('#ccBoard');
  const onClick = (ev) => {
    if (entered.length >= 3 || tk !== TR.tk) return;
    const sq = board.squareAt(ev.clientX, ev.clientY);
    if (!sq) return;
    const pc = sim.get(sq);
    if (pc && pc.color === sim.turn()) { sel = sq; paint(); return; }
    if (sel) {
      const m = sim.moves({ square: sel, verbose: true }).find((x) => x.to === sq);
      if (m) {
        const mv = sim.move({ from: sel, to: sq, promotion: 'q' });
        entered.push(mv);
        sel = null;
        paint();
        if (entered.length === 3) check();
        return;
      }
    }
    sel = null;
    paint();
  };
  root.addEventListener('click', onClick);
  $('#ccUndo').onclick = () => { if (entered.length && entered.length < 3) { entered.pop(); sim.undo(); paint(); } };
  async function check() {
    const fb = $('#ccFb');
    fb.className = 'feedback';
    fb.textContent = 'Checking your line…';
    const q = interactiveQueue();
    const res = [];
    const moverWp = (w) => (me === 'w' ? w : 100 - w);
    const before = moverWp(p.w);
    // step 1: your move
    const c1 = new Chess(p.fen);
    c1.move(entered[0].san);
    let ok1 = entered[0].san === p.pv[0];
    let r1 = null;
    if (!c1.isGameOver()) r1 = await q.go(c1.fen(), { depth: 12, multipv: 2 });
    if (!ok1 && r1) ok1 = before - (100 - wp(r1.score)) <= 3;
    if (c1.isCheckmate()) ok1 = true;
    res.push(ok1);
    // step 2: their reply — the engine's best (or close to it) in the position after your move
    const bestReply = r1 ? new Chess(c1.fen()).move({ from: r1.best.slice(0, 2), to: r1.best.slice(2, 4), promotion: r1.best[4] }).san : null;
    let ok2 = entered[1].san === bestReply;
    if (!ok2 && r1?.second) {
      const s2 = new Chess(c1.fen()).move({ from: r1.second.pv[0].slice(0, 2), to: r1.second.pv[0].slice(2, 4), promotion: r1.second.pv[0][4] }).san;
      if (entered[1].san === s2 && Math.abs(wp(r1.score) - wp(r1.second.score)) <= 3) ok2 = true;
    }
    res.push(ok2);
    // step 3: your follow-up, judged in the position you predicted
    const c3 = new Chess(p.fen);
    c3.move(entered[0].san);
    c3.move(entered[1].san);
    const r3 = c3.isGameOver() ? null : await q.go(c3.fen(), { depth: 12 });
    let ok3 = false;
    if (r3) {
      const best3 = wp(r3.score);
      const c4 = new Chess(c3.fen());
      c4.move(entered[2].san);
      if (c4.isCheckmate()) ok3 = true;
      else if (!c4.isGameOver()) { const r4 = await q.go(c4.fen(), { depth: 12 }); ok3 = r4 ? best3 - (100 - wp(r4.score)) <= 3 : false; }
    }
    res.push(ok3);
    if (tk !== TR.tk) return;
    const s = res.filter(Boolean).length;
    await C.trainResult(`calc|${p.id}`, s === 3);
    $$('#ccSlots span').forEach((el, k) => { el.classList.remove('cur'); el.classList.toggle('ok', res[k]); el.classList.toggle('no', !res[k]); });
    fb.className = `feedback ${s === 3 ? 'ok' : 'no'}`;
    fb.innerHTML = s === 3 ? 'All three right. That is calculation.' : `${s} of 3 right.${!res[1] && bestReply ? ` Their best reply was <b>${esc(bestReply)}</b>.` : ''} The engine's line: <span class="mono">${esc(p.pv.slice(0, 5).join(' '))}</span>`;
    // play the engine's line on the board
    const show = new Chess(p.fen);
    board.setArrows([]);
    for (const san of p.pv.slice(0, 5)) {
      await sleep(700);
      if (tk !== TR.tk) return;
      let mv;
      try { mv = show.move(san); } catch { break; }
      board.setFen(show.fen(), { lastMove: [mv.from, mv.to] });
    }
    $('#ccAct').innerHTML = `<button class="btn cta" id="ccNext">${idx + 1 < total ? 'Next position' : 'Finish'} <span class="arrow">→</span></button><a class="btn" href="#review/${encodeURIComponent(p.gid)}/${p.ply}">See it in the game</a>`;
    $('#ccNext').onclick = () => { root.removeEventListener('click', onClick); onDone(s); };
  }
  void moveLabel;
}
