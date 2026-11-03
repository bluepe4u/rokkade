// Animated chessboard for the Coach: pieces glide between positions (FLIP-style transforms on
// persistent piece elements), arrows draw themselves, squares pulse, move-class badges pop in.
// Also interactive (click or drag) for drills and practice.
const FILES = 'abcdefgh';
const SVG_NS = 'http://www.w3.org/2000/svg';
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const sleep = (ms) => new Promise((r) => setTimeout(r, reducedMotion() ? Math.min(ms, 30) : ms));

function parseFen(fen) {
  const out = new Map();
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      out.set(FILES[f] + (8 - r), color + ch.toUpperCase());
      f++;
    }
  });
  return out;
}

const sqXY = (sq) => [FILES.indexOf(sq[0]), +sq[1] - 1];

export class AnimBoard {
  constructor(root, { orientation = 'w', coords = true, glide = 260 } = {}) {
    this.root = root;
    this.orientation = orientation;
    this.glide = glide;
    this.pieces = []; // {el, code, sq}
    this.arrowKeys = new Map();
    this.hooks = null;
    this.selected = null;
    this.marks = {};
    root.classList.add('aboard');
    root.innerHTML = `<div class="ab-squares"></div><div class="ab-pieces"></div>
      <svg class="ab-arrows" viewBox="0 0 800 800" aria-hidden="true"></svg><div class="ab-fx"></div>`;
    this.sqLayer = root.querySelector('.ab-squares');
    this.pcLayer = root.querySelector('.ab-pieces');
    this.svg = root.querySelector('.ab-arrows');
    this.fx = root.querySelector('.ab-fx');
    this.squares = new Map();
    for (let i = 0; i < 64; i++) this.sqLayer.append(document.createElement('div'));
    root.classList.toggle('no-coords', !coords);
    this.#layout();
    root.addEventListener('pointerdown', (e) => this.#down(e));
    this.onMoveEv = (e) => this.#move(e);
    this.onUpEv = (e) => this.#up(e);
  }

  get fen() { return this.currentFen; }

  setOrientation(o) {
    if (o === this.orientation) return;
    this.orientation = o;
    this.#layout();
    for (const p of this.pieces) this.#place(p.el, p.sq, false);
    this.#redrawArrows();
    this.setMarks(this.marks);
  }

  #layout() {
    this.squares.clear();
    [...this.sqLayer.children].forEach((el, i) => {
      const r = Math.floor(i / 8);
      const c = i % 8;
      const file = this.orientation === 'w' ? c : 7 - c;
      const rank = this.orientation === 'w' ? 7 - r : r;
      const sq = FILES[file] + (rank + 1);
      el.className = `ab-sq ${(file + rank) % 2 ? 'light' : 'dark'}`;
      el.dataset.sq = sq;
      el.innerHTML = (c === 0 ? `<span class="coord rank">${rank + 1}</span>` : '') + (r === 7 ? `<span class="coord file">${FILES[file]}</span>` : '');
      this.squares.set(sq, el);
    });
  }

  /** Grid cell (0-7, from top-left in view) for a square. */
  cell(sq) {
    const [f, r] = sqXY(sq);
    return this.orientation === 'w' ? [f, 7 - r] : [7 - f, r];
  }

  center(sq) { const [c, r] = this.cell(sq); return [c * 100 + 50, r * 100 + 50]; }

  #place(el, sq, animate, duration = this.glide) {
    const [c, r] = this.cell(sq);
    el.style.transition = animate && !reducedMotion() ? `transform ${duration}ms var(--ease-out), opacity 200ms ease` : 'none';
    el.style.transform = `translate(${c * 100}%, ${r * 100}%)`;
  }

  /** Show a position. Pieces that moved glide; captured ones fade; new ones fade in. */
  setFen(fen, { animate = true, duration = this.glide, lastMove } = {}) {
    this.currentFen = fen;
    const next = parseFen(fen);
    const keep = [];
    const left = [];
    for (const p of this.pieces) {
      if (next.get(p.sq) === p.code) { keep.push(p); next.delete(p.sq); } else left.push(p);
    }
    // Match the remaining pieces of the same kind to the nearest new square.
    const pairs = [];
    for (const p of left) for (const [sq, code] of next) {
      if (code !== p.code) continue;
      const [a, b] = sqXY(p.sq);
      const [x, y] = sqXY(sq);
      pairs.push({ p, sq, d: Math.hypot(a - x, b - y) });
    }
    pairs.sort((u, v) => u.d - v.d);
    const usedP = new Set();
    const usedS = new Set();
    for (const { p, sq } of pairs) {
      if (usedP.has(p) || usedS.has(sq)) continue;
      usedP.add(p); usedS.add(sq);
      p.sq = sq;
      p.el.style.zIndex = 2;
      this.#place(p.el, sq, animate, duration);
      setTimeout(() => { p.el.style.zIndex = ''; }, duration);
      keep.push(p);
      next.delete(sq);
    }
    for (const p of left) {
      if (usedP.has(p)) continue;
      const el = p.el;
      if (animate && !reducedMotion()) {
        el.style.transition = 'opacity 180ms ease, transform 180ms ease';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 200);
      } else el.remove();
    }
    for (const [sq, code] of next) {
      const el = document.createElement('img');
      el.className = 'ab-piece';
      el.src = `pieces/${code}.svg`;
      el.alt = '';
      el.draggable = false;
      this.#place(el, sq, false);
      if (animate && !reducedMotion()) {
        el.style.opacity = '0';
        this.pcLayer.append(el);
        requestAnimationFrame(() => { el.style.transition = 'opacity 220ms ease'; el.style.opacity = '1'; });
      } else this.pcLayer.append(el);
      keep.push({ el, code, sq });
    }
    this.pieces = keep;
    this.selected = null;
    if (lastMove !== undefined) this.setMarks({ ...this.marks, last: lastMove, targets: [], selected: null });
  }

  pieceAt(sq) { return this.pieces.find((p) => p.sq === sq)?.code || null; }

  /** {last:[from,to], check, selected, targets:[], hint:[], error:[]} */
  setMarks(m) {
    this.marks = m;
    for (const [sq, el] of this.squares) {
      el.classList.toggle('last', !!m.last && m.last.includes(sq));
      el.classList.toggle('check', m.check === sq);
      el.classList.toggle('sel', m.selected === sq);
      el.classList.toggle('tgt', !!m.targets?.includes(sq));
      el.classList.toggle('cap', !!m.targets?.includes(sq) && !!this.pieceAt(sq));
      el.classList.toggle('hint', !!m.hint?.includes(sq));
      el.classList.toggle('err', !!m.error?.includes(sq));
    }
  }

  // ───── arrows ─────
  /**
   * arrows: [{from, to, color, width?, opacity?, label?, key?, dashed?}]; arrows whose key is new draw
   * themselves (stroke animation), existing ones stay.
   */
  setArrows(arrows, { draw = true } = {}) {
    this.arrowList = arrows;
    const keys = new Set();
    for (const a of arrows) {
      const key = a.key || `${a.from}${a.to}${a.color}`;
      keys.add(key);
      let g = this.arrowKeys.get(key);
      const fresh = !g;
      if (!g) { g = document.createElementNS(SVG_NS, 'g'); this.arrowKeys.set(key, g); this.svg.append(g); }
      this.#drawArrow(g, a, fresh && draw && !reducedMotion());
    }
    for (const [k, g] of this.arrowKeys) {
      if (keys.has(k)) continue;
      this.arrowKeys.delete(k);
      g.style.transition = 'opacity 200ms ease';
      g.style.opacity = '0';
      setTimeout(() => g.remove(), 220);
    }
  }

  #redrawArrows() {
    const list = this.arrowList || [];
    for (const g of this.arrowKeys.values()) g.remove();
    this.arrowKeys.clear();
    this.setArrows(list, { draw: false });
  }

  #drawArrow(g, a, animate) {
    const [x1, y1] = this.center(a.from);
    const [x2, y2] = this.center(a.to);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const w = a.width ?? 15;
    const head = w * 2.3;
    const sx = x1 + ux * 24;
    const sy = y1 + uy * 24;
    const ex = x2 - ux * (head + 4);
    const ey = y2 - uy * (head + 4);
    const tip = [x2 - ux * 6, y2 - uy * 6];
    const nx = -uy;
    const ny = ux;
    const L = Math.hypot(ex - sx, ey - sy);
    g.setAttribute('opacity', a.opacity ?? 0.88);
    g.innerHTML = `<path d="M${sx.toFixed(1)} ${sy.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}" stroke="${a.color}" stroke-width="${w}" stroke-linecap="round" fill="none" ${a.dashed ? 'stroke-dasharray="2 26"' : ''}/>
      <polygon points="${(ex + nx * head * 0.55).toFixed(1)},${(ey + ny * head * 0.55).toFixed(1)} ${tip[0].toFixed(1)},${tip[1].toFixed(1)} ${(ex - nx * head * 0.55).toFixed(1)},${(ey - ny * head * 0.55).toFixed(1)}" fill="${a.color}"/>
      ${a.label ? `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="17" fill="${a.color}" class="ab-label-bg"/><text x="${ex.toFixed(1)}" y="${(ey + 6).toFixed(1)}" class="ab-label">${a.label}</text>` : ''}`;
    if (animate && !a.dashed) {
      const path = g.querySelector('path');
      const rest = g.querySelectorAll('polygon, circle, text');
      path.style.strokeDasharray = `${L} ${L}`;
      path.style.strokeDashoffset = `${L}`;
      rest.forEach((el) => { el.style.opacity = '0'; });
      path.getBoundingClientRect();
      path.style.transition = 'stroke-dashoffset 450ms var(--ease-out)';
      path.style.strokeDashoffset = '0';
      setTimeout(() => rest.forEach((el) => { el.style.transition = 'opacity 180ms ease'; el.style.opacity = '1'; }), 330);
    }
  }

  // ───── effects ─────
  #fxBox(sq, cls) {
    const [c, r] = this.cell(sq);
    const el = document.createElement('div');
    el.className = cls;
    el.style.left = `${c * 12.5}%`;
    el.style.top = `${r * 12.5}%`;
    this.fx.append(el);
    return el;
  }

  /** Expanding ring on a square (where something new happened). */
  pulse(sq, color = 'var(--cta)') {
    if (reducedMotion()) return;
    const el = this.#fxBox(sq, 'ab-pulse');
    el.style.setProperty('--c', color);
    setTimeout(() => el.remove(), 1300);
  }

  /** Move-class badge in the square's corner. */
  badge(sq, sym, color) {
    this.fx.querySelectorAll('.ab-badge').forEach((b) => b.remove());
    if (!sq) return;
    const el = this.#fxBox(sq, 'ab-badge');
    el.innerHTML = `<span style="background:${color}">${sym}</span>`;
  }

  clearFx() { this.fx.innerHTML = ''; }

  shake() {
    this.root.classList.remove('shake');
    void this.root.offsetWidth;
    this.root.classList.add('shake');
  }

  // ───── interaction ─────
  /** hooks: {canPick(sq), targets(sq), onMove(from, to)} or null to make the board static. */
  interactive(hooks) {
    this.hooks = hooks;
    this.root.classList.toggle('live', !!hooks);
    this.selected = null;
    this.setMarks({ ...this.marks, selected: null, targets: [] });
  }

  #sqAt(x, y) {
    const r = this.sqLayer.getBoundingClientRect();
    const c = Math.floor(((x - r.left) / r.width) * 8);
    const row = Math.floor(((y - r.top) / r.height) * 8);
    if (c < 0 || c > 7 || row < 0 || row > 7) return null;
    return this.sqLayer.children[row * 8 + c].dataset.sq;
  }

  #select(sq) {
    this.selected = sq;
    this.setMarks({ ...this.marks, selected: sq, targets: sq ? this.hooks.targets(sq) : [] });
  }

  #down(e) {
    if (!this.hooks || e.button !== 0) return;
    const sq = this.#sqAt(e.clientX, e.clientY);
    if (!sq) return;
    if (this.selected && sq !== this.selected && this.hooks.targets(this.selected).includes(sq)) {
      const from = this.selected;
      this.#select(null);
      this.hooks.onMove(from, sq);
      return;
    }
    if (this.pieceAt(sq) && this.hooks.canPick(sq)) {
      e.preventDefault();
      const p = this.pieces.find((q) => q.sq === sq);
      this.drag = { from: sq, p, x: e.clientX, y: e.clientY, active: false, was: this.selected === sq };
      this.#select(sq);
      addEventListener('pointermove', this.onMoveEv);
      addEventListener('pointerup', this.onUpEv, { once: true });
    } else if (this.selected) {
      if (this.pieceAt(sq) || this.hooks.targets(this.selected).length) this.hooks.onIllegal?.(this.selected, sq);
      this.#select(null);
    }
  }

  #move(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) { d.active = true; d.p.el.classList.add('dragging'); }
    if (!d.active) return;
    const r = this.pcLayer.getBoundingClientRect();
    const size = r.width / 8;
    const x = ((e.clientX - r.left - size / 2) / size) * 100;
    const y = ((e.clientY - r.top - size / 2) / size) * 100;
    d.p.el.style.transition = 'none';
    d.p.el.style.transform = `translate(${x}%, ${y}%) scale(1.08)`;
  }

  #up(e) {
    removeEventListener('pointermove', this.onMoveEv);
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    d.p.el.classList.remove('dragging');
    const to = this.#sqAt(e.clientX, e.clientY);
    if (d.active) {
      if (to && to !== d.from && this.hooks?.targets(d.from).includes(to)) {
        this.#place(d.p.el, to, false);
        this.#select(null);
        this.hooks.onMove(d.from, to);
        return;
      }
      this.#place(d.p.el, d.from, true, 160);
      if (to && to !== d.from) this.hooks?.onIllegal?.(d.from, to);
    } else if (d.was && to === d.from) {
      this.#select(null);
    }
  }
}
