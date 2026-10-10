// Interactive chessboard: click-to-move, drag-and-drop, and an SVG arrow layer.
const FILES = 'abcdefgh';
const SVG_NS = 'http://www.w3.org/2000/svg';

export class Board {
  /**
   * @param {HTMLElement} root
   * @param {{
   *   canPick:(sq:string)=>boolean,
   *   targets:(sq:string)=>string[],
   *   onMove:(from:string,to:string)=>void,
   * }} hooks
   */
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.orientation = 'w';
    this.position = [];
    this.selected = null;
    this.drag = null;
    this.lastMove = null;
    this.check = null;
    this.arrows = [];

    root.classList.add('board');
    this.squaresEl = document.createElement('div');
    this.squaresEl.className = 'board-squares';
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 800 800');
    this.svg.setAttribute('class', 'board-arrows');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.innerHTML = '<defs></defs><g class="arrows"></g>';
    root.append(this.squaresEl, this.svg);

    this.squares = new Map();
    for (let i = 0; i < 64; i++) {
      const el = document.createElement('div');
      el.className = 'sq';
      this.squaresEl.append(el);
    }
    root.addEventListener('pointerdown', (e) => this.#down(e));
    window.addEventListener('pointermove', (e) => this.#move(e));
    window.addEventListener('pointerup', (e) => this.#up(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.#layout();
  }

  setOrientation(color) {
    if (color === this.orientation) return;
    this.orientation = color;
    this.#layout();
    this.render();
    this.#drawArrows();
  }

  /** squares: chess.js board() output; lastMove {from,to}; check: square|null */
  setPosition(board, lastMove = null, check = null) {
    this.position = board;
    this.lastMove = lastMove;
    this.check = check;
    this.selected = null;
    this.render();
  }

  setArrows(arrows) {
    this.arrows = arrows;
    this.#drawArrows();
  }

  #layout() {
    this.squares.clear();
    const els = this.squaresEl.children;
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(i / 8);
      const c = i % 8;
      const file = this.orientation === 'w' ? c : 7 - c;
      const rank = this.orientation === 'w' ? 7 - r : r;
      const sq = FILES[file] + (rank + 1);
      const el = els[i];
      el.dataset.sq = sq;
      el.className = `sq ${(file + rank) % 2 ? 'light' : 'dark'}`;
      el.innerHTML = '';
      if (c === 0) el.insertAdjacentHTML('beforeend', `<span class="coord rank">${rank + 1}</span>`);
      if (r === 7) el.insertAdjacentHTML('beforeend', `<span class="coord file">${FILES[file]}</span>`);
      this.squares.set(sq, el);
    }
  }

  pieceAt(sq) {
    const file = FILES.indexOf(sq[0]);
    const rank = +sq[1] - 1;
    return this.position[7 - rank]?.[file] ?? null;
  }

  render() {
    const targets = this.selected ? new Set(this.hooks.targets(this.selected)) : new Set();
    for (const [sq, el] of this.squares) {
      const p = this.pieceAt(sq);
      el.classList.toggle('last', !!this.lastMove && (sq === this.lastMove.from || sq === this.lastMove.to));
      el.classList.toggle('selected', sq === this.selected);
      el.classList.toggle('in-check', sq === this.check);
      el.classList.toggle('target', targets.has(sq));
      el.classList.toggle('capture', targets.has(sq) && !!p);
      let img = el.querySelector('img.piece');
      if (p) {
        const src = `pieces/${p.color}${p.type.toUpperCase()}.svg`;
        if (!img) {
          img = document.createElement('img');
          img.className = 'piece';
          img.draggable = false;
          img.alt = '';
          el.append(img);
        }
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.classList.toggle('dragging', this.drag?.from === sq && this.drag.active);
      } else if (img) {
        img.remove();
      }
    }
  }

  #squareFromPoint(x, y) {
    const rect = this.squaresEl.getBoundingClientRect();
    const c = Math.floor(((x - rect.left) / rect.width) * 8);
    const r = Math.floor(((y - rect.top) / rect.height) * 8);
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    return this.squaresEl.children[r * 8 + c].dataset.sq;
  }

  #down(e) {
    if (e.button !== 0) return;
    const sq = this.#squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    if (this.selected && this.selected !== sq && this.hooks.targets(this.selected).includes(sq)) {
      const from = this.selected;
      this.selected = null;
      this.render();
      this.hooks.onMove(from, sq);
      return;
    }
    if (this.pieceAt(sq) && this.hooks.canPick(sq)) {
      e.preventDefault();
      const wasSelected = this.selected === sq;
      this.selected = sq;
      this.drag = { from: sq, x: e.clientX, y: e.clientY, active: false, wasSelected, ghost: null };
      this.render();
    } else {
      this.selected = null;
      this.render();
    }
  }

  #move(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) {
      d.active = true;
      const p = this.pieceAt(d.from);
      const size = this.squaresEl.getBoundingClientRect().width / 8;
      d.ghost = document.createElement('img');
      d.ghost.src = `pieces/${p.color}${p.type.toUpperCase()}.svg`;
      d.ghost.className = 'drag-ghost';
      d.ghost.style.width = d.ghost.style.height = `${size}px`;
      document.body.append(d.ghost);
      this.render();
    }
    if (d.active) {
      const size = parseFloat(d.ghost.style.width);
      d.ghost.style.transform = `translate(${e.clientX - size / 2}px, ${e.clientY - size / 2}px)`;
      const over = this.#squareFromPoint(e.clientX, e.clientY);
      for (const [sq, el] of this.squares) el.classList.toggle('hover', sq === over);
    }
  }

  #up(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.ghost) d.ghost.remove();
    for (const el of this.squares.values()) el.classList.remove('hover');
    const to = this.#squareFromPoint(e.clientX, e.clientY);
    if (d.active) {
      if (to && to !== d.from && this.hooks.targets(d.from).includes(to)) {
        this.selected = null;
        this.render();
        this.hooks.onMove(d.from, to);
        return;
      }
      this.render();
    } else if (d.wasSelected && to === d.from) {
      this.selected = null;
      this.render();
    }
  }

  #center(sq) {
    const file = FILES.indexOf(sq[0]);
    const rank = +sq[1] - 1;
    const c = this.orientation === 'w' ? file : 7 - file;
    const r = this.orientation === 'w' ? 7 - rank : rank;
    return [c * 100 + 50, r * 100 + 50];
  }

  #drawArrows() {
    const g = this.svg.querySelector('g.arrows');
    g.innerHTML = '';
    // Draw weakest first so the best arrow ends up on top.
    for (const a of [...this.arrows].reverse()) {
      const [x1, y1] = this.#center(a.from);
      const [x2, y2] = this.#center(a.to);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (!len) continue;
      const ux = dx / len;
      const uy = dy / len;
      const w = a.width ?? 16;
      const head = w * 2.4;
      const sx = x1 + ux * 22;
      const sy = y1 + uy * 22;
      const ex = x2 - ux * 8;
      const ey = y2 - uy * 8;
      const bx = ex - ux * head;
      const by = ey - uy * head;
      const nx = -uy;
      const ny = ux;
      const pts = [
        [sx + (nx * w) / 2, sy + (ny * w) / 2],
        [bx + (nx * w) / 2, by + (ny * w) / 2],
        [bx + nx * head * 0.62, by + ny * head * 0.62],
        [ex, ey],
        [bx - nx * head * 0.62, by - ny * head * 0.62],
        [bx - (nx * w) / 2, by - (ny * w) / 2],
        [sx - (nx * w) / 2, sy - (ny * w) / 2],
      ];
      const poly = document.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' '));
      poly.setAttribute('fill', a.color);
      poly.setAttribute('opacity', a.opacity ?? 0.85);
      if (a.dashed) poly.setAttribute('class', 'dashed');
      g.append(poly);
      if (a.label) {
        const lx = bx - ux * 6;
        const ly = by - uy * 6;
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', lx);
        circle.setAttribute('cy', ly);
        circle.setAttribute('r', 15);
        circle.setAttribute('class', 'arrow-badge');
        circle.setAttribute('fill', a.color);
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', lx);
        text.setAttribute('y', ly + 6);
        text.setAttribute('class', 'arrow-label');
        text.textContent = a.label;
        g.append(circle, text);
      }
    }
  }
}
