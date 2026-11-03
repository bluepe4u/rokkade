// Study → Puzzles: solve positions from your own games, scheduled with spaced repetition.
import { Chess } from '../../vendor/chess.js';
import { AnimBoard, sleep } from './animboard.js';
import { $, $$, esc, miniBoard, countUp, stagger, when, toast } from './ui.js';
import { reviewDocName, wp } from './analysis.js';
import { store } from './store.js';
import { moveLabel } from './library.js';
import { puzzleKey, dayKey } from './progress.js';
import { KIND, focusFor, puzzleQueue, puzzleStats } from './puzzles.js';
import { playerProfile, priorities } from './guide.js';
import { interactiveQueue } from './review.js';

const PZ = { filter: 'all', session: null, view: null, C: null, tk: 0 };
window.__pz = PZ;

function focusOf(C) {
  if (!C.games.length) return { key: null, fn: null, title: null };
  const pr = priorities(playerProfile({ games: C.games, an: C.an, lib: C.lib, discoveries: C.list() }));
  const top = pr.find((p) => focusFor(p.key));
  return top ? { key: top.key, fn: focusFor(top.key), title: top.title } : { key: null, fn: null, title: null };
}

function status(C, p) {
  const e = C.prog.srs[puzzleKey(p.id)];
  if (!e) return { k: 'new', t: 'New' };
  if (e.due <= dayKey()) return { k: 'due', t: 'Due today' };
  return e.reps > 0 ? { k: 'ok', t: `Solved · back in ${Math.max(1, Math.round((new Date(e.due) - new Date(dayKey())) / 864e5))} d` } : { k: 'due', t: 'Retry tomorrow' };
}

/** True while a puzzle session is on screen (background refreshes must leave it alone). */
export const puzzleSessionActive = () => !!PZ.session && !!document.getElementById('pzBoard');

export function renderPuzzles(view, C, args = []) {
  Object.assign(PZ, { view, C });
  PZ.tk++;
  PZ.session = null;
  const all = C.puzzles();
  if (args[0]) {
    const p = all.find((x) => x.id === args[0]);
    if (p) { startSession([p, ...puzzleQueue(all, C.prog, { focus: focusOf(C).fn }).filter((x) => x.id !== p.id)]); return; }
  }
  if (!all.length) {
    view.innerHTML = `<span class="eyebrow">Study</span><h1 class="h1">Puzzles from your games</h1>
      <p class="lede">Every blunder you make and every mistake of your opponent's you didn't punish becomes a puzzle here. ${C.games.length ? 'They appear as your games are reviewed in the background.' : 'Import your games in <a class="link" href="#games">Analyse → Games</a> to start.'}</p>`;
    return;
  }
  const focus = focusOf(C);
  const queue = puzzleQueue(all, C.prog, { focus: focus.fn });
  const st = puzzleStats(all, C.prog);
  const kinds = { punish: all.filter((p) => p.kind === 'punish').length, blunder: all.filter((p) => p.kind === 'blunder').length };
  const themes = [...all.reduce((m, p) => m.set(p.theme, (m.get(p.theme) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  const shown = all.filter((p) => PZ.filter === 'all' || p.kind === PZ.filter || p.theme === PZ.filter || (PZ.filter === 'due' && status(C, p).k !== 'ok'))
    .sort((a, b) => b.t - a.t).slice(0, 60);
  view.innerHTML = `<span class="eyebrow">Study</span><h1 class="h1">Puzzles from your games</h1>
    <p class="lede">Positions where you went wrong, or let your opponent off. Solve them until the right move is the one you see first; each comes back on a schedule until it sticks.</p>
    <section class="pz-hero rise">
      <div><b data-count="${queue.length}">${queue.length}</b><span>for today${focus.title ? ` · focus: ${esc(focus.title.toLowerCase())}` : ''}</span>
        <button class="btn cta lg" id="pzGo" ${queue.length ? '' : 'disabled'}>${queue.length ? 'Start puzzles' : 'All done for today'} <span class="arrow">→</span></button></div>
      <div class="pz-stats"><div><b data-count="${st.total}">${st.total}</b><span>puzzles from your games</span></div>
        <div><b data-count="${st.solved}">${st.solved}</b><span>solved</span></div>
        <div><b>${st.tried ? `${Math.round((100 * st.firstTry) / st.tried)}%` : '–'}</b><span>first try</span></div></div>
      <div class="pz-mix">${[['punish', 'Punish the mistake', kinds.punish], ['blunder', 'Find the better move', kinds.blunder]].map(([k, t, n]) => `<div class="hbar"><span>${t}</span><div><i data-w="${(100 * n) / Math.max(1, all.length)}"></i></div><span>${n}</span></div>`).join('')}</div>
    </section>
    <div class="filters"><div class="seg" id="pzF">${[['all', 'All'], ['due', 'To do'], ['punish', 'Punish'], ['blunder', 'Better move'], ...themes.slice(0, 4).map(([t]) => [t, t])].map(([v, t]) => `<button data-v="${esc(v)}" aria-pressed="${PZ.filter === v}">${esc(t)}</button>`).join('')}</div></div>
    <div class="pz-grid">${shown.map((p) => {
      const s = status(C, p);
      return `<button class="pz-card rise" data-id="${esc(p.id)}">${miniBoard(p.fen, p.col)}<span class="pz-meta"><span class="chipk ${p.kind}">${KIND[p.kind].label}</span><b>${esc(p.theme)}</b><small>${esc(p.phase)} · vs ${esc(p.kind === 'punish' ? p.oppName : p.opp)} · ${when(p.t)}</small><span class="pz-st ${s.k}">${s.t}</span></span></button>`;
    }).join('')}</div>`;
  stagger(view, 25);
  countUp(view);
  requestAnimationFrame(() => $$('.hbar i', view).forEach((i) => { i.style.width = `${i.dataset.w}%`; }));
  $('#pzGo').onclick = () => startSession(queue);
  $('#pzF').onclick = (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v) { PZ.filter = v; renderPuzzles(view, C); } };
  $$('.pz-card', view).forEach((b) => { b.onclick = () => { location.hash = `puzzles/${encodeURIComponent(b.dataset.id)}`; }; });
}

function startSession(list) {
  PZ.session = { list, i: 0, solved: 0, clean: 0 };
  nextPuzzle();
}

async function nextPuzzle() {
  const { view, C, session } = PZ;
  if (!view.isConnected) return;
  const tk = ++PZ.tk;
  const p = session.list[session.i];
  if (!p) {
    view.innerHTML = `<div class="done-card rise"><div class="check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h2 class="h2" style="margin:6px 0">Session done</h2><p class="note">${session.clean} of ${session.list.length} solved first try. They come back on a schedule until they stick.</p>
      <div class="row" style="justify-content:center"><a class="btn" href="#puzzles">All puzzles</a><a class="btn cta" href="#today">Back to Today</a></div></div>`;
    return;
  }
  const R = await store.get(reviewDocName(p.gid)).catch(() => null);
  if (tk !== PZ.tk) return;
  const pv = R?.ev?.[p.ply]?.pv?.length ? R.ev[p.ply].pv : [p.best];
  const steps = [pv[0]];
  if (pv.length >= 3 && /[x+#]/.test(pv[0])) steps.push(pv[1], pv[2]);
  const moverW = p.ply % 2 === 0;
  const beforeWp = R?.ev?.[p.ply] ? (moverW ? R.ev[p.ply].w : 100 - R.ev[p.ply].w) : null;
  view.innerHTML = `<a class="link back" href="#puzzles">← All puzzles</a>
    <div class="pz-session">
      <div class="pz-board"><div id="pzBoard"></div></div>
      <div class="panel-card pz-panel">
        <div class="row"><span class="chipk ${p.kind}">${KIND[p.kind].label}</span><span class="spacer"></span><span class="note">${session.i + 1} of ${session.list.length}</span></div>
        <div class="pz-prog"><i style="width:${(100 * session.i) / session.list.length}%"></i></div>
        <h2 class="h2" style="margin:14px 0 6px">${moverW ? 'White' : 'Black'} to move</h2>
        <p>${esc(KIND[p.kind].prompt(p))}</p>
        <p class="note">${esc(p.fam || '')} · vs ${esc(p.kind === 'punish' ? p.oppName : p.opp)} · ${when(p.t)}${steps.length > 1 ? ' · a two-move combination' : ''}</p>
        <p class="feedback" id="pzFb"></p>
        <div class="row" id="pzAct"><button class="btn sm" id="pzHint">Hint</button><button class="btn sm ghost" id="pzSkip">Show solution</button></div>
      </div>
    </div>`;
  const board = new AnimBoard($('#pzBoard'), { orientation: moverW ? 'w' : 'b' });
  const c = new Chess(p.fen);
  board.setFen(c.fen(), { animate: false, lastMove: [] });
  let k = 0;
  let mistakes = 0;
  let hinted = false;
  const fb = $('#pzFb');
  const finish = async (clean, note) => {
    board.interactive(null);
    await C.solvePuzzle(p.id, clean);
    if (clean) session.clean++;
    session.solved++;
    const e = C.prog.srs[puzzleKey(p.id)];
    fb.className = `feedback ${clean ? 'ok' : 'no'}`;
    fb.innerHTML = `${note} ${clean ? `Back in ${e?.iv ?? 1} ${e?.iv === 1 ? 'day' : 'days'}.` : 'It comes back tomorrow.'}`;
    $('#pzAct').innerHTML = `<button class="btn cta" id="pzNext">Next puzzle <span class="arrow">→</span></button><a class="btn" href="#review/${encodeURIComponent(p.gid)}/${p.ply}">See it in the game</a>`;
    $('#pzNext').onclick = () => { session.i++; nextPuzzle(); };
    if (clean) board.pulse(board.marks.last?.[1] || 'e4', 'var(--success)');
  };
  const reveal = () => {
    const m = new Chess(c.fen()).move(steps[k]);
    board.setArrows([{ from: m.from, to: m.to, color: '#3f7a52', key: 'sol' }]);
    return m.san;
  };
  $('#pzHint').onclick = () => {
    hinted = true;
    const m = new Chess(c.fen()).move(steps[k]);
    board.setMarks({ ...board.marks, hint: [m.from] });
    fb.className = 'feedback';
    fb.textContent = `Look at your ${({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' })[m.piece]} on ${m.from}.`;
  };
  $('#pzSkip').onclick = () => { const s = reveal(); finish(false, `The move was ${s}.`); };
  const enable = () => board.interactive({
    canPick: (sq) => c.get(sq)?.color === c.turn(),
    targets: (sq) => c.moves({ square: sq, verbose: true }).map((m) => m.to),
    onIllegal: () => board.shake(),
    onMove,
  });
  async function onMove(from, to) {
      const want = new Chess(c.fen()).move(steps[k]);
      const t = new Chess(c.fen());
      const mv = t.move({ from, to, promotion: want.promotion && want.from === from && want.to === to ? want.promotion : 'q' });
      board.setFen(t.fen(), { lastMove: [from, to], duration: 200 });
      let ok = mv.san === want.san;
      let alsoGood = false;
      if (!ok && k === 0 && beforeWp != null) {
        // A different move can be just as good: ask the engine.
        board.interactive(null);
        fb.className = 'feedback';
        fb.textContent = `Checking ${mv.san}…`;
        let after = t.isCheckmate() ? 100 : t.isDraw() ? 50 : null;
        if (after == null) { const r = await interactiveQueue().go(t.fen(), { depth: 12 }); after = r ? 100 - wp(r.score) : 0; }
        if (tk !== PZ.tk) return;
        alsoGood = beforeWp - after <= 3;
        ok = alsoGood;
      }
      if (!ok) {
        mistakes++;
        board.shake();
        fb.className = 'feedback no';
        fb.textContent = mistakes >= 2 ? `${mv.san} isn't it either.` : `${mv.san} isn't the move. Try again.`;
        await sleep(600);
        if (tk !== PZ.tk) return;
        board.setFen(c.fen(), { duration: 200, lastMove: k ? board.marks.last : [] });
        if (mistakes >= 3) { const s = reveal(); finish(false, `The move was ${s}.`); return; }
        enable();
        return;
      }
      c.move(mv.san);
      board.pulse(to, 'var(--success)');
      if (alsoGood) { finish(!mistakes && !hinted, `${mv.san} works too (the engine's choice was ${want.san}).`); return; }
      k++;
      if (k >= steps.length) { finish(!mistakes && !hinted, `${mv.san}! ${p.kind === 'punish' ? 'That punishes it.' : 'That keeps the advantage.'}`); return; }
      fb.className = 'feedback ok';
      fb.textContent = `${mv.san}. Keep going.`;
      board.interactive(null);
      await sleep(550);
      if (tk !== PZ.tk) return;
      const r = c.move(steps[k]);
      board.setFen(c.fen(), { lastMove: [r.from, r.to] });
      k++;
      await sleep(250);
      enable();
  }
  enable();
  void toast;
  void moveLabel;
}
