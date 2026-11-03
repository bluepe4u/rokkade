// Analyse → Prepare: type any chess.com username (or pick a recent opponent) and get a report on
// how they play and what to expect against your library.
import { $, $$, esc, miniBoard, countUp, stagger, when } from './ui.js';
import { api } from './store.js';
import { buildPrep } from './prep.js';
import { moveLabel, sanLine, positionAfter } from './library.js';
import { pct, plural } from './games.js';
import { ls } from './store.js';

const PR = { name: '', months: 3, report: null, profile: null, busy: false, err: '' };

function recentOpponents(C) {
  const seen = new Map();
  for (const x of C.games.slice().reverse()) {
    if (!x.opp) continue;
    const k = x.opp.toLowerCase();
    if (!seen.has(k)) seen.set(k, { name: x.opp, n: 0, t: x.t });
    seen.get(k).n++;
  }
  return [...seen.values()].slice(0, 30).sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 10);
}

const wdl = (a) => (a.n ? `<span class="wdl"><i class="w" style="width:${(100 * a.w) / a.n}%"></i><i class="d" style="width:${(100 * a.d) / a.n}%"></i><i class="l" style="width:${(100 * a.l) / a.n}%"></i></span>` : '');
const choiceRows = (list, max = 5) => list.slice(0, max).map((c) => `<div class="pc-row"><b>${esc(c.san)}</b><span class="lx-share"><i style="width:${Math.round(c.share * 100)}%"></i></span><span class="pc-n">${Math.round(c.share * 100)}% · ${c.n}</span><span class="pc-wdl">${wdl(c.a)}</span><span class="pc-sc">${pct(c.a.sc)}</span></div>`).join('') || '<p class="note">No games.</p>';

export function renderPrep(view, C, args = []) {
  if (args[0] && args[0].toLowerCase() !== PR.name.toLowerCase()) { PR.name = args[0]; load(view, C); }
  const opps = recentOpponents(C);
  const recent = ls.get('sfet.prep.recent', []);
  view.innerHTML = `<span class="eyebrow">Analyse</span><h1 class="h1">Prepare for an opponent</h1>
    <p class="lede">Enter any chess.com username. Outpost downloads their recent public games and shows what they play, how they score, how their games end, and what to expect against your library.</p>
    <div class="prep-search rise"><input class="input lg" id="prName" placeholder="chess.com username" value="${esc(PR.name)}" autocomplete="off" spellcheck="false">
      <select class="select" id="prMonths">${[[1, 'Last month'], [3, 'Last 3 months'], [6, 'Last 6 months']].map(([v, t]) => `<option value="${v}" ${v === PR.months ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="btn cta lg" id="prGo" ${PR.busy ? 'disabled' : ''}>${PR.busy ? 'Loading…' : 'Prepare'} <span class="arrow">→</span></button></div>
    ${opps.length || recent.length ? `<div class="prep-chips">${[...recent.map((n) => ({ name: n, recent: true })), ...opps.filter((o) => !recent.some((r) => r.toLowerCase() === o.name.toLowerCase()))].slice(0, 12).map((o) => `<button class="chip" data-n="${esc(o.name)}">${esc(o.name)}${o.n ? ` <small>${o.n}×</small>` : ''}</button>`).join('')}</div>` : ''}
    <p class="${PR.err ? 'err-text' : 'note'}" id="prMsg">${esc(PR.err || '')}</p>
    <div id="prOut"></div>`;
  const go = (name) => { if (!name) return; location.hash = `prepare/${encodeURIComponent(name.trim())}`; };
  $('#prGo').onclick = () => go($('#prName').value);
  $('#prName').onkeydown = (e) => { if (e.key === 'Enter') go($('#prName').value); };
  $('#prMonths').onchange = (e) => { PR.months = +e.target.value; if (PR.name) load(view, C); };
  $$('.prep-chips [data-n]', view).forEach((b) => { b.onclick = () => go(b.dataset.n); });
  if (PR.report && !PR.busy) paint(view, C);
}

async function load(view, C) {
  const name = PR.name;
  PR.busy = true;
  PR.err = '';
  PR.report = null;
  const msg = () => $('#prMsg');
  try {
    const [pro, raw] = await Promise.all([
      api(`/api/player?user=${encodeURIComponent(name)}`).catch(() => null),
      C.playerGames(name, PR.months, (i, n) => { const m = msg(); if (m) m.textContent = `Downloading ${name}'s games: month ${i} of ${n}…`; }),
    ]);
    if (name !== PR.name) return;
    PR.profile = pro;
    PR.report = buildPrep(name, raw, { lib: C.lib, myGames: C.games });
    const recent = ls.get('sfet.prep.recent', []).filter((n) => n.toLowerCase() !== name.toLowerCase());
    ls.set('sfet.prep.recent', [name, ...recent].slice(0, 6));
  } catch (e) {
    PR.err = e.message;
  }
  PR.busy = false;
  if (location.hash.startsWith('#prepare')) renderPrep(view, C);
}

function paint(view, C) {
  const P = PR.report;
  const out = $('#prOut');
  if (!P || !out) return;
  if (!P.n) { out.innerHTML = `<p class="note">No standard chess games for ${esc(P.name)} in this period.</p>`; return; }
  const pro = PR.profile?.profile;
  const stats = PR.profile?.stats || {};
  const ratings = ['rapid', 'blitz', 'bullet', 'daily'].map((k) => [k, stats[`chess_${k}`]?.last?.rating]).filter((r) => r[1]);
  const E = P.ends;
  const prepFor = (side) => {
    const Y = P.you?.[side];
    if (!Y) return '';
    const line = Y.lines[0];
    return `<div class="panel-card rise"><span class="eyebrow">When you have ${side === 'w' ? 'White' : 'Black'}</span>
      ${line ? `<div class="prep-line">${miniBoard(positionAfter(line.pre).fen, side, { last: (() => { const m = positionAfter(line.pre).move; return m ? [m.from, m.to] : []; })() })}<div><b>Most likely: ${esc(sanLine(line.pre)) || 'from the start'}</b><p class="note">${line.n ? `${line.n} of their games went this way.` : 'They have no games along your library here yet.'}${line.gap ? ' Their last move here is <b>not in your library</b>.' : ''}</p>
        <a class="btn sm" href="#library/${side}/${encodeURIComponent(line.pre.join(','))}">Open in Library</a></div></div>` : ''}
      ${Y.gaps.length ? `<p class="eyebrow" style="margin-top:12px">Their replies your library doesn't cover</p>${Y.gaps.map((g) => `<div class="pc-row gap"><b>${esc(g.label)}</b><span class="note">${esc(sanLine(g.pre))}</span><span class="pc-n">${plural(g.n, 'game')} · ${Math.round(g.share * 100)}%</span><a class="btn sm" href="#library/${side}/${encodeURIComponent(g.pre.join(','))}">Look</a></div>`).join('')}` : '<p class="note" style="margin-top:10px">Your library covers their usual replies.</p>'}
    </div>`;
  };
  out.innerHTML = `<section class="prep-head rise">
      <div class="prep-id">${pro?.avatar ? `<img src="${esc(pro.avatar)}" alt="">` : `<span class="pav w">${esc(P.name[0].toUpperCase())}</span>`}<div><b>${pro?.title ? `<span class="ttl">${esc(pro.title)}</span> ` : ''}${esc(pro?.username || P.name)}</b><small>${pro?.country ? `${esc(pro.country)} · ` : ''}${plural(P.n, 'game')} since ${when(P.first.t)}${pro?.last_online ? ` · online ${when(pro.last_online)}` : ''}</small></div></div>
      <div class="prep-ratings">${ratings.map(([k, v]) => `<span><b>${v}</b><small>${k}</small></span>`).join('')}</div>
      <div class="prep-score"><b>${pct(P.a.sc)}</b><small>score · ${P.a.w}W ${P.a.d}D ${P.a.l}L</small>${wdl(P.a)}</div>
    </section>
    ${P.h2h.n ? `<div class="rec ok rise" style="margin-bottom:14px"><h3 class="h3">You have played them ${plural(P.h2h.n, 'time')}</h3><p>You scored ${pct(P.h2h.a.sc)}. Last: ${P.h2h.games.map((g) => `${g.sc === 1 ? 'won' : g.sc === 0.5 ? 'drew' : 'lost'} ${when(g.t)}`).join(', ')}.</p></div>` : ''}
    <div class="numbers">
      <div class="panel-card rise"><span class="eyebrow">As White · ${P.asWhite.n} games · ${pct(P.asWhite.a.sc)}</span><p class="note" style="margin:6px 0">First move</p>${choiceRows(P.asWhite.first)}</div>
      <div class="panel-card rise"><span class="eyebrow">As Black · ${P.asBlack.n} games · ${pct(P.asBlack.a.sc)}</span><p class="note" style="margin:6px 0">Against 1.e4</p>${choiceRows(P.asBlack.vsE4, 4)}<p class="note" style="margin:10px 0 6px">Against 1.d4</p>${choiceRows(P.asBlack.vsD4, 4)}</div>
    </div>
    <h2 class="h2">Against your library</h2>
    <div class="numbers">${prepFor('w')}${prepFor('b')}</div>
    <h2 class="h2">Their openings</h2>
    <div class="numbers">${[['White', P.asWhite.fams], ['Black', P.asBlack.fams]].map(([t, F]) => `<div class="panel-card rise"><span class="eyebrow">As ${t}</span>${F.map((f) => `<div class="pc-row"><b class="fam">${esc(f.fam)}</b><span class="pc-n">${f.n}</span><span class="pc-wdl">${wdl(f.a)}</span><span class="pc-sc">${pct(f.a.sc)}</span></div>`).join('') || '<p class="note">–</p>'}</div>`).join('')}</div>
    <h2 class="h2">How their games end</h2>
    <div class="tiles">
      <div class="tile rise"><b>${E.losses ? pct(E.mated / E.losses) : '–'}</b><span>of losses by checkmate</span></div>
      <div class="tile rise"><b>${E.losses ? pct(E.time / E.losses) : '–'}</b><span>of losses on time</span></div>
      <div class="tile rise"><b>${E.losses ? pct(E.early / E.losses) : '–'}</b><span>of losses within 25 moves</span></div>
      <div class="tile rise"><b>${P.clock ? pct(P.clock.trouble) : '–'}</b><span>of games in time trouble</span></div>
    </div>
    <div class="recs">${tips(P).map((t) => `<div class="rec hi rise"><p style="margin:0;color:var(--foreground)">${t}</p></div>`).join('')}</div>`;
  stagger(out, 30);
  countUp(out);
}

function tips(P) {
  const out = [];
  const E = P.ends;
  if (P.clock && P.clock.trouble >= 0.3) out.push(`They get into time trouble in ${pct(P.clock.trouble)} of games: keep the position complicated and the clock running.`);
  if (E.losses >= 5 && E.time / E.losses >= 0.2) out.push(`${pct(E.time / E.losses)} of their losses are on time.`);
  if (E.losses >= 5 && E.early / E.losses >= 0.4) out.push(`Many of their losses come early (${pct(E.early / E.losses)} within 25 moves): they can be hit in the opening.`);
  if (E.losses >= 5 && E.mated / E.losses >= 0.4) out.push(`${pct(E.mated / E.losses)} of their losses are by checkmate: play for the king.`);
  const worstW = P.asWhite.fams.filter((f) => f.n >= 4).sort((a, b) => a.a.sc - b.a.sc)[0];
  if (worstW && worstW.a.sc < 0.45) out.push(`As White they score only ${pct(worstW.a.sc)} in the ${worstW.fam}.`);
  const worstB = P.asBlack.fams.filter((f) => f.n >= 4).sort((a, b) => a.a.sc - b.a.sc)[0];
  if (worstB && worstB.a.sc < 0.45) out.push(`As Black they score only ${pct(worstB.a.sc)} in the ${worstB.fam}.`);
  if (P.asWhite.a.sc - P.asBlack.a.sc >= 0.15 && P.asBlack.n >= 5) out.push(`They are much weaker as Black (${pct(P.asBlack.a.sc)}) than as White (${pct(P.asWhite.a.sc)}).`);
  return out;
}

export { moveLabel };
