// Play page ↔ Coach: shows where the game stands in your library, and catches the moment an
// opponent (the solver) leaves it, saving the position to Discoveries.
import { coach } from './service.js';
import { moveLabel } from './library.js';
import { MAX_PLY, discoveryId } from './discoveries.js';
import { esc } from './ui.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function attachPlay({ chip, toast }) {
  const C = coach();
  C.pause(true); // the solver needs the CPU while you play; analysis resumes when the game ends
  let ready = false;
  let last = null;
  C.ready.then(() => { ready = true; if (last) update(last); }).catch(() => {});
  const caught = new Set();

  /**
   * s: {startFen, sans, ctrl: {w, b}, over, result ('1-0'|'0-1'|'1/2-1/2'|null), serial, elo: {w, b}}
   */
  function update(s) {
    last = s;
    const humans = ['w', 'b'].filter((c) => s.ctrl[c] === 'human');
    if (!ready || s.startFen !== START || humans.length !== 1) { chip.hidden = true; return; }
    const col = humans[0];
    const opp = col === 'w' ? 'b' : 'w';
    const w = C.lib.walk(col, s.sans);
    chip.hidden = false;
    chip.classList.remove('out');
    if (!s.sans.length) {
      chip.innerHTML = `<span class="ic">♞</span><span class="txt">Playing ${col === 'w' ? 'White' : 'Black'} from your library · ${C.lib.stats(col).lines} lines</span><a class="link" href="coach.html#library">Library</a>`;
      return;
    }
    if (w.type === 'end') {
      const d = C.lib.describe(col, w.node);
      const inside = w.ply >= s.sans.length && C.lib.book(col, w.node).length;
      const where = d.title || (d.chapters && d.chapters.length > 1 ? `${d.lines} lines continue from here` : d.chapter) || '';
      chip.innerHTML = `<span class="ic">✓</span><span class="txt">${inside ? 'In your library' : 'You reached the end of your line'} · ${esc(where)}</span>`;
      return;
    }
    if (w.type === 'habit') {
      const book = C.lib.book(col, w.node).map((e) => e.s).join(' or ');
      chip.innerHTML = `<span class="ic">↗</span><span class="txt">You left your library with ${esc(moveLabel(w.ply) + w.san)} · it plays ${esc(book)}</span><a class="link" href="coach.html#library/${col}/${encodeURIComponent(s.sans.slice(0, w.ply).join(','))}">Show</a>`;
      return;
    }
    // gap: the solver played something your library doesn't answer
    const label = moveLabel(w.ply) + w.san;
    chip.classList.add('out');
    if (w.ply >= MAX_PLY) {
      chip.innerHTML = `<span class="ic">!</span><span class="txt">${esc(label)} is outside your library</span>`;
      return;
    }
    const id = discoveryId(col, C.lib.node(col, w.node).k, w.san);
    chip.innerHTML = `<span class="ic">!</span><span class="txt"><b>${esc(label)}</b> is new for you · saved to Discoveries</span><a class="link" href="coach.html#discoveries/${id}">Study it</a>`;
    const sc = !s.result ? null : s.result === '1/2-1/2' ? 0.5 : (s.result === '1-0') === (col === 'w') ? 1 : 0;
    const key = `${s.serial}|${s.sans.length > w.ply + 1 ? 'r' : ''}|${sc}`;
    if (caught.has(key)) return;
    const first = ![...caught].some((k) => k.startsWith(`${s.serial}|`));
    caught.add(key);
    C.ingest([{
      id: `term-${s.serial}`, col, sans: s.sans.slice(), t: Math.floor(Date.now() / 1000), src: 'terminal',
      opp: `Solver ${s.elo[opp]}`, opR: s.elo[opp], myR: null, tc: 'terminal', sc, ex: null, url: null,
    }]).then(() => { if (first) toast(`${label} is new for you. Saved to Discoveries.`); }).catch((e) => console.warn(e));
  }

  return {
    update,
    gameOver(serial, humans = true) { C.pause(false); if (humans && serial) C.log('game', `term-${serial}`); },
    playing() { C.pause(true); },
  };
}
