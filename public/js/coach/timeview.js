// Analyse → Time: how you use your clock, and how thinking time relates to move quality.
import { $$, countUp, stagger } from './ui.js';
import { clockReport, clockAdvice } from './clock.js';
import { pct } from './games.js';

const fmt = (s) => (s == null ? '–' : s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

export function renderTime(view, C, { quiet = false } = {}) {
  const r = clockReport(C.games, C.reviewIdx, C.lib);
  if (!r) {
    view.innerHTML = `<span class="eyebrow">Analyse</span><h1 class="h1">Your clock</h1><p class="lede">This needs a few imported games with clock times (chess.com includes them in live games).</p>`;
    return;
  }
  const adv = clockAdvice(r);
  const curve = r.curve.slice(0, 40);
  const mx = Math.max(1, ...curve.filter((v) => v != null));
  const W = 640, H = 150;
  const pts = curve.map((v, i) => (v == null ? null : [(i * W) / 39, H - 8 - ((H - 20) * v) / mx])).filter(Boolean);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const bmax = Math.max(0.01, ...r.buckets.map((b) => b.blunderRate || 0));
  view.innerHTML = `<span class="eyebrow">Analyse</span><h1 class="h1">Your clock</h1>
    <p class="lede">From the clock times in ${r.games} of your games (mostly ${r.mainTc}${r.tc ? `, ${Math.round(r.tc.base / 60)}+${r.tc.inc}` : ''}). Thinking time is matched to the reviews, so you can see which moves you rush and what it costs.</p>
    ${adv.length ? `<div class="recs">${adv.map((a) => `<div class="rec hi rise"><p style="margin:0;color:var(--foreground)">${a}</p></div>`).join('')}</div>` : ''}
    <div class="tiles">
      <div class="tile rise"><b>${fmt(r.phase.Opening)}</b><span>per move, moves 1–10</span></div>
      <div class="tile rise"><b>${fmt(r.phase.Middlegame)}</b><span>per move, moves 11–30</span></div>
      <div class="tile rise"><b>${fmt(r.phase.Endgame)}</b><span>per move, after move 30</span></div>
      <div class="tile rise"><b data-count="${Math.round(r.trouble.share * 100)}" data-fmt="pct">${pct(r.trouble.share)}</b><span>games in time trouble (under 10% left)</span></div>
      <div class="tile rise"><b>${r.timeouts}</b><span>of ${r.losses} losses on time</span></div>
    </div>
    <div class="numbers">
      <div class="panel-card rise"><span class="eyebrow">Time per move, by move number (${r.mainTc})</span>
        <svg class="time-curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H - 8}" y2="${H - 8}"/><path d="${d}" pathLength="1"/></svg>
        <div class="row" style="justify-content:space-between"><span class="note">move 1</span><span class="note">peak ${fmt(mx)}</span><span class="note">move 40</span></div></div>
      <div class="panel-card rise"><span class="eyebrow">Blunder rate by thinking time</span>
        ${r.buckets.map((b) => `<div class="hbar"><span>${b.label}</span><div><i data-w="${b.blunderRate != null ? (100 * b.blunderRate) / bmax : 0}" style="background:var(--cl-blunder)"></i></div><span>${b.blunderRate != null ? `${(b.blunderRate * 100).toFixed(1)}%` : '–'}</span></div>`).join('')}
        <p class="note" style="margin:8px 0 0">Share of moves that lost 15+ points of win chance, from ${r.buckets.reduce((s, b) => s + b.n, 0)} reviewed moves.</p></div>
      <div class="panel-card rise"><span class="eyebrow">Time trouble</span>
        <div class="rep-acc" style="margin-top:8px"><div><span class="eyebrow">In time trouble</span><b>${r.trouble.n ? pct(r.trouble.score.sc) : '–'}</b><small>score · ${r.trouble.n} games</small></div><div><span class="eyebrow">Otherwise</span><b>${pct(r.trouble.calmScore.sc)}</b><small>score · ${r.trouble.calmScore.n} games</small></div></div>
        <p class="note" style="margin:10px 0 0">${r.bookSpend != null ? `On moves still in your library you spend a median ${fmt(r.bookSpend)}.` : ''} ${r.firstBlunderLeft != null ? `Your first blunder comes with a median ${Math.round(r.firstBlunderLeft * 100)}% of your time left.` : ''}</p></div>
    </div>`;
  if (!quiet) { stagger(view); countUp(view); }
  requestAnimationFrame(() => $$('.hbar i', view).forEach((i) => { i.style.width = `${i.dataset.w}%`; }));
}
