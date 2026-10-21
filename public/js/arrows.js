// Numbered move arrows drawn into an SVG <g>; shared by the classic and four-player boards.
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {SVGGElement} g target group (cleared first)
 * @param {Array<{x1:number,y1:number,x2:number,y2:number,color:string,width?:number,opacity?:number,dashed?:boolean,label?:string}>} arrows
 *   in the SVG's own coordinates; later entries are drawn on top of earlier ones
 */
export function renderArrows(g, arrows) {
  g.innerHTML = '';
  for (const a of arrows) {
    const dx = a.x2 - a.x1;
    const dy = a.y2 - a.y1;
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    const ux = dx / len;
    const uy = dy / len;
    const w = a.width ?? 16;
    const head = w * 2.4;
    const sx = a.x1 + ux * 22;
    const sy = a.y1 + uy * 22;
    const ex = a.x2 - ux * 8;
    const ey = a.y2 - uy * 8;
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
