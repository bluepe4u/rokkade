// Today: the home screen. A short daily session built from the data, a streak and goal, a practice
// calendar and progress over time. The point is to make coming back every day obvious and easy.
import { $, $$, esc, countUp, stagger } from './ui.js';
import { dayKey, addDays, dayTotal, streak, learnedCount } from './progress.js';
import { playerProfile, priorities } from './guide.js';
import { plural, pct } from './games.js';
import { puzzleQueue, focusFor } from './puzzles.js';
import { trackedFor } from './progressview.js';
import { goalsHTML, bindGoals, weekHTML } from './goalsview.js';
import { planCardHTML, bindPlanCard } from './journalview.js';
import { journalInbox } from './journal.js';

const WEEKS = 12;

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Days with chess.com games (they count as practice too). */
function gameDays(games) {
  const m = new Map();
  for (const x of games) { const k = dayKey(new Date(x.t * 1000)); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

function spark(values, { w = 120, h = 34, min = null, max = null } = {}) {
  if (values.length < 2) return '';
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i * w) / (values.length - 1)).toFixed(1)},${(h - 3 - ((v - lo) / span) * (h - 6)).toFixed(1)}`);
  return `<svg class="tspark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" pathLength="1"/></svg>`;
}

function bigRing(done, goal) {
  const p = Math.min(1, done / goal);
  return `<div class="goal-ring" style="--p:${p}"><svg viewBox="0 0 120 120"><circle class="gr-bg" cx="60" cy="60" r="52"/><circle class="gr-fg" cx="60" cy="60" r="52" pathLength="100"/></svg>
    <div><b data-count="${done}">${done}</b><span>of ${goal} today</span></div></div>`;
}

export function renderToday(view, C, S, { quiet = false } = {}) {
  const today = dayKey();
  const prog = C.prog;
  const d = prog.days[today] || {};
  const gd = gameDays(C.games);
  const extra = new Set(gd.keys());
  const doneToday = dayTotal(d) + (gd.get(today) || 0);
  const st = streak(prog, extra, today);
  const goal = prog.goal || 3;
  const due = C.due();
  const disc = C.list();
  const waiting = disc.filter((x) => x.status === 'ready' || x.status === 'new');
  const readyD = waiting.find((x) => x.status === 'ready') || waiting[0];
  const latest = C.games.at(-1);
  const p = C.games.length ? playerProfile({ games: C.games, an: C.an, lib: C.lib, discoveries: disc }) : null;
  const focus = p ? priorities(p)[0] : null;

  // ── the session
  const steps = [];
  steps.push({
    key: 'drill', title: due.length ? `Drill ${plural(due.length, 'line')}` : 'Library drills',
    sub: due.length ? `${[due.filter((x) => !x.isNew).length ? `${due.filter((x) => !x.isNew).length} due for review` : '', due.filter((x) => x.isNew).length ? `${due.filter((x) => x.isNew).length} new` : ''].filter(Boolean).join(', ')}. About ${Math.max(2, due.length * 1.5).toFixed(0)} minutes.` : (d.drill ? `${plural(d.drill, 'line')} drilled today.` : 'Nothing is due today.'),
    done: !due.length, href: due.length ? '#library/due' : '#library', cta: due.length ? 'Start' : 'Open',
  });
  const pzq = puzzleQueue(C.puzzles(), prog, { focus: focus ? focusFor(focus.key) : null });
  steps.push({
    key: 'puzzles', title: pzq.length ? `Solve ${plural(Math.min(5, pzq.length), 'puzzle')} from your games` : 'Puzzles from your games',
    sub: pzq.length ? `Positions where you went wrong or let your opponent off${focus && focusFor(focus.key) ? `, focused on: ${esc(focus.title.toLowerCase())}` : ''}.` : d.puzzle ? `${plural(d.puzzle, 'puzzle')} solved today.` : 'They appear as your games are reviewed.',
    done: !pzq.length || (d.puzzle || 0) >= 5, href: '#puzzles', cta: 'Solve',
  });
  steps.push({
    key: 'study', title: readyD ? `Study ${esc(readyD.label)}` : 'Study a new position',
    sub: readyD ? `From ${readyD.n === 1 ? 'one of your games' : `${readyD.n} of your games`}${readyD.status === 'new' ? ' · still being analysed' : ''}. Ends with the line in your library.` : d.study ? 'Done for today.' : 'Nothing waiting: new positions appear after your next games.',
    done: !!d.study || !waiting.length, href: readyD ? `#discoveries/${readyD.id}` : '#discoveries', cta: 'Study',
  });
  steps.push({
    key: 'review', title: latest ? `Review your game against ${esc(latest.opp)}` : 'Review a game',
    sub: latest ? `${latest.sc === 1 ? 'Won' : latest.sc === 0.5 ? 'Drawn' : 'Lost'} · ${esc(latest.fam)}${C.reviewIdx[latest.id] ? ` · your accuracy ${C.accOf(latest.id, latest.col)}%` : ''}. Find your first mistake before you look.` : 'Import your chess.com games in Analyse → Games, or play one here.',
    done: !!d.review, href: latest ? `#review/${encodeURIComponent(latest.id)}` : '#games', cta: 'Review',
  });
  const jq = journalInbox(C.games, C.journal, { days: 3 });
  if (jq.length || d.journal) steps.push({
    key: 'journal', title: jq.length ? `Journal ${jq.length === 1 ? `your game against ${esc(jq[0].opp)}` : plural(jq.length, 'recent game')}` : 'Journal your games',
    sub: jq.length ? 'Ten seconds a game: what you were thinking at the critical moment. The tags are already suggested.' : `${plural(d.journal, 'game')} journaled today.`,
    done: !jq.length, href: '#journal', cta: 'Journal',
  });
  steps.push({
    key: 'play', title: 'Play a serious game',
    sub: (gd.get(today) || d.game) ? `${plural((gd.get(today) || 0) + (d.game || 0), 'game')} today.` : 'A longer time control, using the four-question check on every move. Your library is followed as you play.',
    done: !!((gd.get(today) || 0) + (d.game || 0)), href: './', cta: 'Play',
  });
  const doneSteps = steps.filter((s) => s.done).length;

  // ── calendar
  const start = addDays(today, -(WEEKS * 7 - 1) - new Date().getDay());
  const cells = [];
  for (let i = 0; i < WEEKS * 7 + new Date().getDay() + 1; i++) {
    const k = addDays(start, i);
    if (k > today) break;
    const n = dayTotal(prog.days[k]) + (gd.get(k) || 0);
    cells.push({ k, n, lvl: n === 0 ? 0 : n < 2 ? 1 : n < 4 ? 2 : n < 7 ? 3 : 4 });
  }
  const activeDays = cells.filter((c) => c.n).length;

  // ── progress tiles
  const tc = p?.main?.tc;
  const ratings = tc ? C.games.filter((x) => x.tc === tc).slice(-40).map((x) => x.myR) : [];
  const accs = C.games.filter((x) => C.reviewIdx[x.id]).slice(-30).map((x) => C.accOf(x.id, x.col));
  const accRecent = accs.slice(-10);
  const accAvg = accRecent.length ? accRecent.reduce((a, b) => a + b, 0) / accRecent.length : null;
  const accPrev = accs.slice(-20, -10);
  const accPrevAvg = accPrev.length ? accPrev.reduce((a, b) => a + b, 0) / accPrev.length : null;
  const learned = learnedCount(prog);
  const studied = disc.filter((x) => x.status === 'studied').length;
  const tomorrow = Object.entries(prog.srs).filter(([k, e]) => (k.startsWith('w|') || k.startsWith('b|')) && e.due === addDays(today, 1)).length;
  const tracked = C.games.length ? trackedFor(C) : [];

  view.innerHTML = `
    <section class="today-hero rise">
      <div>
        <span class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <h1 class="h1">${greeting()}${C.user ? `, ${esc(C.user)}` : ''}.</h1>
        <p class="lede">${doneSteps === steps.length ? 'Today\'s session is complete. See you tomorrow.' : `Today's session: ${steps.length - doneSteps} of ${steps.length} steps left.`} ${focus ? `This week's focus: <a class="link" href="#plan">${esc(focus.title.toLowerCase())}</a>.` : ''}</p>
        <div class="streak ${st ? 'on' : ''}"><span class="flame" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3-1-3 0-6 1-9.5z"/></svg></span>
          <span><b data-count="${st}">${st}</b> ${st === 1 ? 'day' : 'days'} in a row</span><span class="note">· ${activeDays} active days in the last ${WEEKS} weeks</span></div>
      </div>
      ${bigRing(Math.min(doneToday, 99), goal)}
    </section>

    <h2 class="h2">Today's session</h2>
    <ol class="session">${steps.map((s, i) => `<li class="step rise ${s.done ? 'done' : ''}" style="--i:${i}">
      <span class="step-n">${s.done ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : i + 1}</span>
      <span class="step-body"><b>${s.title}</b><small>${s.sub}</small></span>
      <a class="btn ${s.done ? 'ghost' : 'cta'} sm" href="${s.href}">${s.done ? 'Again' : s.cta} <span class="arrow">→</span></a></li>`).join('')}</ol>

    ${planCardHTML(C, { compact: true })}
    <div class="today-grid">${goalsHTML(C)}${weekHTML(C)}</div>
    <div class="today-grid">
      <section class="panel-card rise">
        <div class="row"><h2 class="h3" style="margin:0">Practice calendar</h2><span class="spacer"></span><span class="note">less</span><span class="cal-key">${[0, 1, 2, 3, 4].map((l) => `<i class="l${l}"></i>`).join('')}</span><span class="note">more</span></div>
        <div class="cal" style="--weeks:${WEEKS + 1}">${cells.map((c, i) => `<i class="l${c.lvl}${c.k === today ? ' now' : ''}" style="--d:${i}" title="${c.k}: ${c.n ? `${c.n} ${c.n === 1 ? 'activity' : 'activities'}` : 'no practice'}"></i>`).join('')}</div>
        <p class="note" style="margin:10px 0 0">Drills, studied positions, reviews and games all count. A day with any of them keeps the streak going.</p>
      </section>
      <section class="tiles today-tiles">
        <div class="tile rise"><span class="eyebrow">${tc ? esc(tc) : 'Rating'}</span><b ${p ? `data-count="${p.rating}"` : ''}>${p ? p.rating : '–'}</b>${spark(ratings)}<span>${p?.main?.change != null ? `${p.main.change >= 0 ? '+' : '−'}${Math.abs(p.main.change)} in 90 days` : 'Import your games to track it'}</span></div>
        <div class="tile rise"><span class="eyebrow">Accuracy</span><b>${accAvg != null ? `${accAvg.toFixed(1)}` : '–'}</b>${spark(accs, { min: 0, max: 100 })}<span>${accAvg != null ? `last 10 reviewed games${accPrevAvg != null ? ` · ${accAvg >= accPrevAvg ? '+' : '−'}${Math.abs(accAvg - accPrevAvg).toFixed(1)} vs the 10 before` : ''}` : 'Reviews run in the background after import'}</span></div>
        <div class="tile rise"><span class="eyebrow">Lines learned</span><b data-count="${learned}">${learned}</b><span>${tomorrow ? `${plural(tomorrow, 'line')} due tomorrow` : 'in spaced repetition'}</span></div>
        <div class="tile rise"><span class="eyebrow">Positions studied</span><b data-count="${studied}">${studied}</b><span>${waiting.length ? `${waiting.length} waiting in Discoveries` : 'from your own games'}</span></div>
        ${tracked.length ? `<a class="tile rise tile-link" href="#progress"><span class="eyebrow">Your positions</span><b>${tracked.filter((t) => t.status === 'improving').length}<small> improving</small></b><span>${tracked.filter((t) => t.status === 'slipping').length} slipping · ${tracked.filter((t) => t.worked).length} worked on · see Progress →</span></a>` : ''}
      </section>
    </div>
    ${!C.user ? `<section class="panel-card rise" style="margin-top:16px"><h2 class="h3">Connect your chess.com games</h2><p class="note">Rokade reviews every game in the background, finds the moves that surprise you, and builds your plan from them. <a class="link" href="#games">Import in Analyse → Games →</a></p></section>` : ''}`;
  bindGoals(view, C);
  bindPlanCard(view, C);
  if (!quiet) { stagger(view, 55); countUp(view); }
  // goal ring fills after paint
  const r = $('.goal-ring', view);
  if (r && !quiet) { const target = r.style.getPropertyValue('--p'); r.style.setProperty('--p', 0); requestAnimationFrame(() => requestAnimationFrame(() => r.style.setProperty('--p', target))); }
  $$('.cal i', view).forEach((i) => { if (quiet) i.style.animation = 'none'; });
}
