// Small view helpers shared by the Coach screens: escaping, static mini boards, count-ups, rings.
import { reducedMotion } from './animboard.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FILES = 'abcdefgh';

/** Static board as HTML (cards, thumbnails). opts: {last:[from,to], arrows:[{from,to,color}], size} */
export function miniBoard(fen, orientation = 'w', opts = {}) {
  const rows = fen.split(' ')[0].split('/');
  const grid = [];
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { for (let k = 0; k < +ch; k++) grid.push({ sq: FILES[f++] + (8 - r), p: null }); continue; }
      grid.push({ sq: FILES[f++] + (8 - r), p: (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase() });
    }
  });
  const cells = orientation === 'w' ? grid : grid.slice().reverse();
  const last = opts.last || [];
  const center = (sq) => {
    const f = FILES.indexOf(sq[0]);
    const rk = +sq[1] - 1;
    const c = orientation === 'w' ? f : 7 - f;
    const r = orientation === 'w' ? 7 - rk : rk;
    return [c * 100 + 50, r * 100 + 50];
  };
  const arrows = (opts.arrows || []).map((a) => {
    const [x1, y1] = center(a.from);
    const [x2, y2] = center(a.to);
    const L = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / L;
    const uy = (y2 - y1) / L;
    const ex = x2 - ux * 40;
    const ey = y2 - uy * 40;
    return `<path d="M${x1 + ux * 22} ${y1 + uy * 22} L${ex} ${ey}" stroke="${a.color}" stroke-width="16" stroke-linecap="round"/><polygon fill="${a.color}" points="${ex - uy * 20},${ey + ux * 20} ${x2 - ux * 8},${y2 - uy * 8} ${ex + uy * 20},${ey - ux * 20}"/>`;
  }).join('');
  return `<div class="mini" aria-hidden="true">${cells.map((c, i) => {
    const dark = (FILES.indexOf(c.sq[0]) + +c.sq[1]) % 2 === 1;
    return `<i class="${dark ? 'd' : 'l'}${last.includes(c.sq) ? ' lm' : ''}">${c.p ? `<img src="pieces/${c.p}.svg" alt="" loading="lazy">` : ''}</i>`;
  }).join('')}${arrows ? `<svg viewBox="0 0 800 800" opacity=".85">${arrows}</svg>` : ''}</div>`;
}

/** Animate the numbers inside `root` that carry data-count (to that value) and data-fmt. */
export function countUp(root, duration = 700) {
  for (const el of $$('[data-count]', root)) {
    const to = +el.dataset.count;
    const fmt = el.dataset.fmt || 'int';
    const show = (v) => { el.textContent = fmt === 'pct' ? `${Math.round(v)}%` : fmt === 'dec' ? v.toFixed(1) : fmt === 'signed' ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}` : String(Math.round(v)); };
    if (reducedMotion()) { show(to); continue; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - (1 - k) ** 4;
      show(to * e);
      if (k < 1) requestAnimationFrame(step);
    };
    show(0);
    requestAnimationFrame(step);
  }
}

/** Progress ring (0-1) as SVG; animates via CSS on --p. */
export const ring = (p, label = '') => `<span class="ring" style="--p:${Math.max(0, Math.min(1, p))}"><svg viewBox="0 0 36 36"><circle class="ring-bg" cx="18" cy="18" r="15"/><circle class="ring-fg" cx="18" cy="18" r="15" pathLength="100"/></svg>${label ? `<b>${label}</b>` : ''}</span>`;

export function toast(msg, ms = 2600) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

export const when = (t) => (t ? new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const since = (t) => (t ? new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

/** Stagger the entrance of `.rise` children. */
export function stagger(root, step = 45) {
  $$('.rise', root).forEach((el, i) => { el.style.animationDelay = `${Math.min(i, 14) * step}ms`; });
}
