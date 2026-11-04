// "What players at your level play here": Lichess explorer statistics in the Library, after
// converting the user's chess.com rating to the Lichess scale.
import { esc } from './ui.js';
import { explore, tokenStatus, saveToken, toLichess } from './lichess.js';
import { playerProfile } from './guide.js';

let tokenKnown = null;
const TOKEN_URL = 'https://lichess.org/account/oauth/token/create?description=Rokade%20opening%20explorer';

function level(C) {
  if (!C.games.length) return { rating: 1500, tc: 'blitz', guessed: true };
  const p = playerProfile({ games: C.games, an: {}, lib: null, discoveries: [] });
  return { rating: p.rating, tc: p.main.tc, guessed: false };
}

/** Fill `el` with explorer stats for `fen`. libMoves: SANs your library has here. */
export async function renderExplorerPanel(el, C, { fen, libMoves = [], onPick }) {
  if (!el) return;
  const tk = (el._tk = (el._tk || 0) + 1);
  if (tokenKnown === null) tokenKnown = await tokenStatus();
  if (tk !== el._tk) return;
  if (!tokenKnown) {
    el.innerHTML = `<div class="lx"><span class="eyebrow">Players at your level</span>
      <p class="note">See what players around your rating play here and how it scores, from the Lichess database. Lichess asks for a free personal token (no permissions needed); it stays on this computer.</p>
      <div class="row"><a class="btn sm" href="${TOKEN_URL}" target="_blank" rel="noopener">Create a token ↗</a><input class="input" id="lxTok" placeholder="Paste the token (lip_…)" autocomplete="off" style="flex:1;min-width:160px;border-radius:999px"><button class="btn sm cta" id="lxSave">Save</button></div><p class="err-text" id="lxErr"></p></div>`;
    el.querySelector('#lxSave').onclick = async () => {
      try { await saveToken(el.querySelector('#lxTok').value.trim()); tokenKnown = true; renderExplorerPanel(el, C, { fen, libMoves, onPick }); } catch (e) { el.querySelector('#lxErr').textContent = e.message; }
    };
    return;
  }
  const lv = level(C);
  const li = toLichess(lv.rating, lv.tc);
  el.innerHTML = `<div class="lx"><span class="eyebrow">Players at your level</span><p class="note lx-sub">Loading Lichess statistics…</p></div>`;
  const r = await explore(fen, lv);
  if (tk !== el._tk) return;
  if (r.error) {
    const bad = r.error === 'bad-token' || r.error === 'no-token';
    if (bad) tokenKnown = false;
    el.innerHTML = `<div class="lx"><span class="eyebrow">Players at your level</span><p class="err-text">${bad ? 'Lichess did not accept the token.' : esc(r.error)}</p>${bad ? '<button class="btn sm" id="lxRe">Enter a new token</button>' : ''}</div>`;
    const re = el.querySelector('#lxRe');
    if (re) re.onclick = () => renderExplorerPanel(el, C, { fen, libMoves, onPick });
    return;
  }
  const top = r.moves.slice(0, 6);
  el.innerHTML = `<div class="lx"><div class="row"><span class="eyebrow">Players at your level</span><span class="spacer"></span><span class="note" title="chess.com ${lv.tc} ${lv.rating} ≈ Lichess ${li}; ratings differ between the sites, most at lower levels">${lv.guessed ? 'Lichess ' : `chess.com ${lv.rating} ≈ Lichess `}${li} · ${r.bands.join('–')} · ${r.total.toLocaleString()} games</span></div>
    ${top.length ? `<div class="lx-rows">${top.map((m) => `<button class="lx-row ${libMoves.includes(m.san) ? 'lib' : ''}" data-san="${esc(m.san)}">
      <b>${esc(m.san)}</b>${libMoves.includes(m.san) ? '<span class="lx-tag">your library</span>' : ''}
      <span class="lx-share"><i style="width:${Math.round(m.share * 100)}%"></i></span><span class="lx-pct">${Math.round(m.share * 100)}%</span>
      <span class="lx-wdl" title="White wins · draws · Black wins"><i class="w" style="width:${(100 * m.white) / m.n}%"></i><i class="d" style="width:${(100 * m.draws) / m.n}%"></i><i class="l" style="width:${(100 * m.black) / m.n}%"></i></span><span class="lx-sc" title="Score for the side to move">${Math.round(m.score * 100)}%</span></button>`).join('')}</div>` : '<p class="note">No games from this position at your level.</p>'}</div>`;
  el.querySelectorAll('[data-san]').forEach((b) => { b.onclick = () => onPick?.(b.dataset.san); });
}
