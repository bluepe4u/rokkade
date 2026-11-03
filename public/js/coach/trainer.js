// Library: browse your opening tree (explore) or test yourself on it (drill), on the animated board.
import { Chess } from '../../vendor/chess.js';
import { AnimBoard, sleep } from './animboard.js';
import { $, $$, esc, miniBoard, stagger, toast } from './ui.js';
import { moveLabel, sanLine, positionAfter } from './library.js';
import { ls } from './store.js';
import { renderExplorerPanel } from './lichessview.js';

const T = {
  side: ls.get('rep-side', 'w'),
  mode: 'explore',
  path: [0],
  mv: [],
  redo: [],
  flip: false,
  msg: '',
  cls: '',
  miss: 0,
  dstart: 0,
  busy: false,
  tk: 0,
  open: {},
  target: null, // SAN list of the line being drilled (due-line sessions)
  queue: [], // due lines still to drill in this session
  session: null, // {total, clean}
};
let done = ls.get('rep-done', {});
let board = null;
let C = null;
let root = null;

const db = () => C.lib.side(T.side);
const node = () => db().n[T.path[T.path.length - 1]];
const whiteToMove = () => T.mv.length % 2 === 0;
const mine = () => whiteToMove() === (T.side === 'w');
const fullFen = (n) => `${n.k} - 0 ${Math.floor(T.mv.length / 2) + 1}`;

function reset() {
  T.tk++;
  T.busy = false;
  T.path = [0];
  T.mv = [];
  T.redo = [];
  T.msg = '';
  T.cls = '';
  T.mode = 'explore';
}

function openPath(list) {
  reset();
  let c = 0;
  for (const s of list) {
    const e = db().n[c].e.find((q) => q.s === s);
    if (!e) break;
    T.mv.push(e);
    T.path.push(e.n);
    c = e.n;
  }
}

function apply(e, animate = true) {
  T.mv.push(e);
  T.path.push(e.n);
  T.msg = '';
  T.cls = '';
  draw(animate);
}

function back() { if (!T.mv.length || T.mode === 'drill') return; T.redo.push(T.mv.pop()); T.path.pop(); T.msg = ''; draw(); }
function forward() {
  if (T.mode === 'drill') return;
  let e = T.redo.pop();
  if (e && !node().e.includes(e)) e = null;
  if (!e) { const o = C.lib.book(T.side, T.path.at(-1)); if (o.length === 1) [e] = o; }
  if (e) apply(e);
}
function toStart() { while (T.mv.length) { T.redo.push(T.mv.pop()); T.path.pop(); } T.msg = ''; draw(); }

function setMode(m) {
  if (m === T.mode) return;
  T.tk++;
  T.busy = false;
  T.mode = m;
  T.msg = '';
  T.cls = '';
  if (m === 'drill') { T.dstart = T.mv.length; T.miss = 0; draw(); drillStep(); } else draw();
}

function restart() {
  T.tk++;
  T.busy = false;
  T.path = T.path.slice(0, T.dstart + 1);
  T.mv = T.mv.slice(0, T.dstart);
  T.miss = 0;
  T.msg = '';
  draw();
  drillStep();
}

async function drillStep() {
  const o = C.lib.book(T.side, T.path.at(-1));
  if (!o.length || (T.target && T.mv.length >= T.target.length)) { finish(); return; }
  if (mine()) { T.msg = 'Your move'; T.cls = ''; draw(); return; }
  T.busy = true;
  T.msg = '';
  draw();
  const tk = ++T.tk;
  await sleep(480);
  if (tk !== T.tk || T.mode !== 'drill') return;
  const want = T.target?.[T.mv.length];
  const onTarget = want && o.find((e) => e.s === want);
  const openE = o.filter((e) => db().n[e.n].p.some((i) => !db().l[i].w && !done[T.side + i]));
  const pool = openE.length ? openE : o;
  const e = onTarget || pool[Math.floor(Math.random() * pool.length)];
  T.mv.push(e);
  T.path.push(e.n);
  T.busy = false;
  drillStep();
}

function finish() {
  const clean = !T.miss;
  if (clean) {
    for (const id of T.path) for (const i of db().n[id].t) if (!db().l[i].w) done[T.side + i] = 1;
    ls.set('rep-done', done);
  }
  // Spaced repetition: every line that ends where this drill ended gets its next review date.
  const reached = T.mv.map((e) => e.s);
  const ended = db().n[T.path.at(-1)].t.map((i) => db().l[i]).filter((l) => !l.w && l.san.join(' ') === reached.join(' '));
  const lines = ended.length ? ended : T.target ? [{ san: T.target }] : [];
  for (const l of lines) C.reviewLine(T.side, l.san, clean);
  C.log('drill', `${T.side}|${reached.join(' ')}`);
  if (T.session) { T.session.done++; if (clean) T.session.clean++; }
  T.msg = clean ? (lines.length ? `Clean. Next review in ${C.prog.srs[`${T.side}|${lines[0].san.join(' ')}`]?.iv ?? 1} days` : 'Line complete with no mistakes') : `${T.miss} ${T.miss > 1 ? 'mistakes' : 'mistake'}: this line comes back tomorrow`;
  T.cls = clean ? 'ok' : '';
  draw();
  browse();
  if (T.session) setTimeout(() => nextDue(), 1400);
}

/** Start (or continue) a session over the lines due today. */
function nextDue() {
  if (!root?.isConnected) return;
  const next = T.queue.shift();
  if (!next) {
    const s = T.session;
    T.session = null;
    T.target = null;
    T.msg = s ? `Session done: ${s.clean} of ${s.done} clean. Come back tomorrow for the next ones.` : '';
    T.cls = 'ok';
    renderInto();
    return;
  }
  if (next.side !== T.side) { T.side = next.side; ls.set('rep-side', T.side); }
  reset();
  T.flip = false;
  T.target = next.line.san;
  openPath(next.line.san.slice(0, Math.min(next.line.st, next.line.san.length - 1)));
  T.mode = 'drill';
  T.dstart = T.mv.length;
  T.miss = 0;
  renderInto();
}

function startDue() {
  T.queue = C.due();
  T.session = { total: T.queue.length, done: 0, clean: 0 };
  nextDue();
}

function hint() {
  const o = C.lib.book(T.side, T.path.at(-1));
  if (!o.length || !mine()) return;
  T.miss++;
  board.setMarks({ ...board.marks, hint: [o[0].a, o[0].b] });
  T.msg = `The move is ${moveLabel(T.mv.length)}${o[0].s}`;
  T.cls = 'no';
  $('#tStatus').textContent = T.msg;
  $('#tStatus').className = 'status-line no';
}

function tryMove(from, to) {
  const n = node();
  const c = new Chess(fullFen(n));
  let mv;
  try { mv = c.move({ from, to, promotion: 'q' }); } catch { return; }
  const e = n.e.find((x) => x.s === mv.san || (x.a === from && x.b === to));
  if (T.mode === 'drill') {
    if (!mine() || T.busy) return;
    if (e && !e.w) { T.mv.push(e); T.path.push(e.n); T.msg = ''; draw(); drillStep(); return; }
    T.miss++;
    board.setFen(c.fen(), { lastMove: [from, to] });
    board.shake();
    T.msg = 'Not the line. Try again, or tap Hint.';
    T.cls = 'no';
    setTimeout(() => draw(), 650);
    $('#tStatus').textContent = T.msg;
    $('#tStatus').className = 'status-line no';
    return;
  }
  if (e) { apply(e); return; }
  const ok = C.lib.book(T.side, T.path.at(-1));
  board.setFen(c.fen(), { lastMove: [from, to] });
  board.setMarks({ ...board.marks, error: [from, to] });
  setTimeout(() => draw(), 900);
  T.msg = !n.e.length ? 'End of this line. Go back to try another branch.'
    : mine() ? `Not in your library. Your move here is ${ok.map((x) => moveLabel(T.mv.length) + x.s).join(' or ')}.`
      : 'Your library does not cover that reply yet. If it happens in a game, it will show up in Discoveries.';
  T.cls = 'no';
  $('#tStatus').textContent = T.msg;
  $('#tStatus').className = 'status-line no';
}

function draw(animate = true) {
  if (!root.isConnected) return;
  const n = node();
  const drill = T.mode === 'drill';
  const orient = (T.side === 'b') !== T.flip ? 'b' : 'w';
  board.setOrientation(orient);
  const last = T.mv.at(-1);
  board.setFen(fullFen(n), { animate, lastMove: last ? [last.a, last.b] : [] });
  board.interactive({
    canPick: (sq) => { const p = board.pieceAt(sq); return !!p && p[0] === (whiteToMove() ? 'w' : 'b') && (!drill || (mine() && !T.busy)); },
    targets: (sq) => new Chess(fullFen(n)).moves({ square: sq, verbose: true }).map((m) => m.to),
    onMove: tryMove,
  });
  board.setArrows(drill ? [] : n.e.map((e) => ({ from: e.a, to: e.b, color: e.w ? '#b4533a' : mine() ? '#3f7a52' : '#2f6fb3', opacity: mine() ? 0.85 : 0.5, width: 13 })));
  $$('#tMode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === T.mode)));
  const st = $('#tStatus');
  st.textContent = T.msg;
  st.className = `status-line ${T.cls}`;
  $('#tCrumbs').innerHTML = T.mv.length
    ? T.mv.map((e, i) => `<button class="${i === T.mv.length - 1 ? 'cur' : ''}" data-i="${i}">${i % 2 === 0 || i === 0 ? moveLabel(i) : ''}${esc(e.s)}</button>`).join('')
    : '<span class="note">Starting position. Make a move or pick one below.</span>';
  $$('#tCrumbs button').forEach((b) => {
    b.onclick = () => { if (drill) return; const i = +b.dataset.i; while (T.mv.length > i + 1) { T.redo.push(T.mv.pop()); T.path.pop(); } T.msg = ''; draw(); };
  });
  $('#c0').textContent = drill ? 'Restart' : '⏮';
  $('#c0').disabled = !drill && !T.mv.length;
  $('#c1').disabled = drill || !T.mv.length;
  $('#c2').disabled = drill || (!T.redo.length && C.lib.book(T.side, T.path.at(-1)).length !== 1);
  $('#c3').textContent = drill ? 'Hint' : 'Flip';
  let ch = '';
  if (!drill && n.e.length) {
    ch = `<p class="eyebrow" style="margin:14px 0 6px">${mine() ? 'Your move' : 'Replies your library covers'}</p><div class="choices">${n.e.map((e, i) => `<button class="choice ${e.w ? 'avoid' : ''}" data-e="${i}">${moveLabel(T.mv.length)}${esc(e.s)}<small>${e.w ? 'avoid · a trap' : e.c > 1 ? `${e.c} lines` : '1 line'}</small></button>`).join('')}</div>`;
  }
  $('#tChoices').innerHTML = ch;
  $$('#tChoices [data-e]').forEach((b) => { b.onclick = () => apply(n.e[+b.dataset.e]); });
  const info = $('#tInfo');
  const d = db();
  const lines = n.t.map((i) => ({ i, l: d.l[i] }));
  let html = '';
  const one = lines.length ? lines : T.mv.length && n.p.length === 1 ? [{ i: n.p[0], l: d.l[n.p[0]] }] : [];
  if (one.length && !(drill && C.lib.book(T.side, T.path.at(-1)).length)) {
    html = one.map(({ i, l }) => `<div class="line-info ${l.w ? 'warn' : ''}"><b>${esc(l.t)}</b>${l.custom ? '<span class="new-tag">From your games</span>' : ''}<small>${esc(l.c)}</small><p style="margin:0">${esc(l.p)}</p>${l.custom ? `<button class="btn sm" style="margin-top:10px" data-rm="${i}">Remove this line</button>` : ''}</div>`).join('');
  } else if (T.mv.length && !drill) {
    const cs = [...new Set(n.p.map((i) => d.l[i].c))];
    html = `<div class="line-info"><b>${n.p.length} lines from here</b><p style="margin:4px 0 0">${esc(cs.slice(0, 4).join(' · '))}${cs.length > 4 ? ' and more' : ''}</p></div>`;
  }
  info.innerHTML = html;
  if (!drill) {
    renderExplorerPanel($('#tStats'), C, {
      fen: fullFen(n), libMoves: n.e.filter((e) => !e.w).map((e) => e.s),
      onPick: (san) => { const e = n.e.find((q) => q.s === san); if (e) apply(e); else { const c = new Chess(fullFen(n)); const m = c.move(san); tryMove(m.from, m.to); } },
    });
  } else $('#tStats').innerHTML = '';
  $$('[data-rm]', info).forEach((b) => {
    b.onclick = async () => {
      const l = d.l[+b.dataset.rm];
      if (!confirm(`Remove "${l.t}" from your library?`)) return;
      await C.removeCustom(T.side, l.san);
      done = {};
      ls.set('rep-done', done);
      toast('Line removed');
      openPath(l.san.slice(0, -1));
      renderInto();
    };
  });
}

function browse() {
  const el = $('#tBrowse');
  if (!el) return;
  const d = db();
  const added = d.l.map((l, i) => ({ l, i })).filter(({ l }) => l.custom).sort((a, b) => (b.l.date || 0) - (a.l.date || 0));
  const total = d.l.filter((l) => !l.w).length;
  const drilled = d.l.filter((l, i) => !l.w && done[T.side + i]).length;
  el.innerHTML = `<div class="row" style="margin-top:28px"><h2 class="h2" style="margin:0">All lines</h2><span class="note">${drilled}/${total} drilled clean</span></div>
    ${added.length ? `<p class="eyebrow group-title">Added from your games</p><div class="shelf">${added.slice(0, 12).map(({ l, i }) => `<button data-l="${i}" class="rise">${miniBoard(positionAfter(l.san).fen, T.side)}<span><b>${esc(l.t)}</b><small>${l.from === 'discovery' ? 'Studied discovery' : 'Your line'}${done[T.side + i] ? ' · ✓ drilled' : ''}</small></span></button>`).join('')}</div>` : ''}
    ${d.ch.map((g) => `<p class="eyebrow group-title">${esc(g.t)}</p><div class="chapters">${g.c.map((c) => {
      const dn = c.l.filter((i) => done[T.side + i]).length;
      return `<details class="chapter" data-c="${c.id}" ${T.open[c.id] ? 'open' : ''}><summary>${esc(c.t)}<span class="count">${dn ? `${dn}/` : ''}${c.l.length}</span></summary><div class="lines-list">${c.l.map((i) => `<button class="jump" data-l="${i}">${esc(d.l[i].t)}${d.l[i].custom ? '<span class="new-tag">New</span>' : ''}${done[T.side + i] ? '<span class="tick">✓</span>' : ''}</button>`).join('')}</div></details>`;
    }).join('')}</div>`).join('')}`;
  stagger(el);
  $$('[data-l]', el).forEach((b) => {
    b.onclick = () => {
      const l = d.l[+b.dataset.l];
      openPath(l.san.slice(0, l.st));
      draw(false);
      // Glide through the rest of the line so it reads as a story.
      (async () => {
        const tk = T.tk;
        for (const s of l.san.slice(l.st)) {
          await sleep(420);
          if (tk !== T.tk || !root.isConnected) return;
          const e = node().e.find((q) => q.s === s);
          if (!e) break;
          apply(e);
        }
      })();
      scrollTo({ top: 0, behavior: 'smooth' });
    };
  });
  $$('details', el).forEach((x) => { x.ontoggle = () => { T.open[x.dataset.c] = x.open; }; });
}

function renderInto() {
  const st = C.lib.stats(T.side);
  root.innerHTML = `<div class="row"><div><span class="eyebrow">Library</span><h1 class="h1">Your openings</h1></div><span class="spacer"></span>
      <div class="seg" id="tSide"><button data-v="w" aria-pressed="${T.side === 'w'}">I play White</button><button data-v="b" aria-pressed="${T.side === 'b'}">I play Black</button></div></div>
    <p class="lede">${st.lines} lines${st.custom ? `, ${st.custom} added from your games` : ''}. Explore the tree move by move, or drill it: lines come back on a schedule (1, 3, 7, 16 … days) so they stay learned.</p>
    ${dueBanner()}
    <div class="trainer">
      <div class="trainer-board"><div id="tBoard"></div>
        <div class="board-ctl"><button class="btn icon" id="c0" title="Back to start"></button><button class="btn icon" id="c1" title="Back (←)">◀</button><button class="btn icon" id="c2" title="Forward (→)">▶</button><button class="btn" id="c3"></button></div></div>
      <div class="panel-card">
        <div class="seg" id="tMode"><button data-v="explore">Explore</button><button data-v="drill">Drill</button></div>
        <p class="status-line" id="tStatus"></p>
        <div class="crumbs" id="tCrumbs"></div>
        <div id="tChoices"></div>
        <div id="tInfo"></div>
        <div id="tStats"></div>
      </div>
    </div>
    <div id="tBrowse"></div>`;
  board = new AnimBoard($('#tBoard'), { orientation: T.side });
  const db_ = $('#dueGo');
  if (db_) db_.onclick = startDue;
  const ds = $('#dueStop');
  if (ds) ds.onclick = () => { T.queue = []; T.session = null; T.target = null; reset(); renderInto(); };
  $('#tSide').onclick = (e) => { const v = e.target.dataset.v; if (!v || v === T.side) return; T.side = v; ls.set('rep-side', v); reset(); T.flip = false; renderInto(); };
  $('#tMode').onclick = (e) => { const v = e.target.dataset.v; if (v) setMode(v); };
  $('#c0').onclick = () => (T.mode === 'drill' ? restart() : toStart());
  $('#c1').onclick = back;
  $('#c2').onclick = forward;
  $('#c3').onclick = () => { if (T.mode === 'drill') hint(); else { T.flip = !T.flip; draw(); } };
  draw(false);
  browse();
  if (T.mode === 'drill') drillStep();
}

addEventListener('keydown', (e) => {
  if (!root?.isConnected || T.mode !== 'explore' || e.target.closest?.('input, textarea, select')) return;
  if (e.key === 'ArrowLeft') back();
  if (e.key === 'ArrowRight') forward();
});

function dueBanner() {
  if (T.session) {
    const s = T.session;
    return `<div class="due-banner rise"><div class="due-prog"><i style="width:${(100 * s.done) / Math.max(1, s.total)}%"></i></div><span><b>Drill session</b> · line ${Math.min(s.done + 1, s.total)} of ${s.total}${T.target ? ` · ${esc(sanLine(T.target.slice(-3), T.target.length - 3))}` : ''}</span><button class="btn sm ghost" id="dueStop">End session</button></div>`;
  }
  const due = C.due();
  const old = due.filter((d) => !d.isNew).length;
  const fresh = due.length - old;
  if (!due.length) return `<div class="due-banner done rise"><span class="due-ic">✓</span><span><b>All caught up.</b> No lines are due today.</span></div>`;
  return `<div class="due-banner rise"><span class="due-ic">${due.length}</span><span><b>${due.length} ${due.length === 1 ? 'line' : 'lines'} to drill today</b> · ${[old ? `${old} due for review` : '', fresh ? `${fresh} new` : ''].filter(Boolean).join(' · ')}</span><button class="btn cta sm" id="dueGo">Start drilling <span class="arrow">→</span></button></div>`;
}

/** args: [side, "e4,e5,...", "drill"] or ["due"] */
export function renderLibrary(view, coach, args = []) {
  C = coach;
  root = view;
  if (args[0] === 'due') { renderInto(); startDue(); return; }
  if (args[0] === 'w' || args[0] === 'b') {
    T.side = args[0];
    ls.set('rep-side', T.side);
    T.flip = false;
    openPath(args[1] ? args[1].split(',').filter(Boolean) : []);
    if (args[2] === 'drill') { T.mode = 'drill'; T.dstart = T.mv.length; T.miss = 0; }
  }
  renderInto();
  if (args[3] === 'new') {
    const el = $('.shelf button', view);
    if (el) el.classList.add('flash');
  }
}

export { sanLine };
