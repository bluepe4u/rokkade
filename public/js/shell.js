// The app shell shared by every page: brand, the main navigation (in the order of the
// improvement loop), the theme toggle, the Study badge, and a sliding indicator.
// <header class="topbar" data-shell="play|coach|four"> … children with data-keep stay … </header>
export const BRAND = 'Outpost';
export const TAGLINE = 'Get better at chess, a little every day';

// group → coach section that opens it
export const NAV = [
  { id: 'today', label: 'Today', sec: 'today' },
  { id: 'play', label: 'Play', href: './' },
  { id: 'study', label: 'Study', sec: 'discoveries', badge: true },
  { id: 'analyse', label: 'Analyse', sec: 'games' },
  { id: 'plan', label: 'Plan', sec: 'plan' },
  { id: 'four', label: '4-Player', href: 'four.html' },
];
export const GROUP_OF = { today: 'today', discoveries: 'study', library: 'study', games: 'analyse', review: 'analyse', insights: 'analyse', plan: 'plan', guide: 'plan' };

const header = document.querySelector('header[data-shell]');
const page = header?.dataset.shell;

function moveInk(nav) {
  const cur = nav.querySelector('[aria-current="page"]');
  const ink = nav.querySelector('.nav-ink');
  if (!ink) return;
  if (!cur) { ink.style.opacity = '0'; return; }
  ink.style.opacity = '1';
  ink.style.width = `${cur.offsetWidth}px`;
  ink.style.transform = `translateX(${cur.offsetLeft}px)`;
}

/** Mark a main tab as current (coach.html calls this on every route). */
export function setActive(id) {
  const nav = document.querySelector('.mode-tabs');
  if (!nav) return;
  nav.querySelectorAll('a').forEach((a) => (a.dataset.nav === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  moveInk(nav);
}

if (header) {
  const kept = [...header.querySelectorAll('[data-keep]')];
  const inCoach = page === 'coach';
  const link = (n) => (n.href ? n.href : inCoach ? `#${n.sec}` : `coach.html#${n.sec}`);
  header.innerHTML = `
    <a class="brand" href="${inCoach ? '#today' : 'coach.html#today'}" aria-label="${BRAND}: Today">
      <span class="brand-mark"><img src="pieces/wN.svg" alt="" /></span>
      <span class="brand-name">${BRAND.toUpperCase()}</span>
    </a>
    <nav class="mode-tabs" aria-label="Main">
      ${NAV.map((n) => `<a href="${link(n)}" data-nav="${n.id}">${n.label}${n.badge ? ' <span class="tab-badge" data-badge hidden></span>' : ''}</a>`).join('')}
      <span class="nav-ink" aria-hidden="true"></span>
    </nav>`;
  for (const k of kept) header.append(k);
  if (!header.querySelector('.topbar-status')) header.insertAdjacentHTML('beforeend', '<div class="topbar-status"></div>');
  header.insertAdjacentHTML('beforeend', `<div class="topbar-actions"><button class="icon-btn" id="themeBtn" title="Toggle theme" aria-label="Toggle theme">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button></div>`);
  document.getElementById('themeBtn').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('sfet.theme', root.dataset.theme); } catch { /* private mode */ }
  });
  const nav = header.querySelector('.mode-tabs');
  if (page === 'play') setActive('play');
  if (page === 'four') setActive('four');
  addEventListener('resize', () => moveInk(nav));
  document.fonts?.ready.then(() => moveInk(nav));
  // The badge: positions ready to study (kept in localStorage by the Coach service).
  const paint = () => {
    let n = 0;
    try { n = Number(JSON.parse(localStorage.getItem('sfet.coach.ready'))) || 0; } catch { n = 0; }
    header.querySelectorAll('[data-badge]').forEach((b) => { b.textContent = n > 0 ? String(n) : ''; b.hidden = !(n > 0); });
  };
  paint();
  addEventListener('storage', (e) => { if (e.key === 'sfet.coach.ready') paint(); });
  addEventListener('sfet-badge', paint);
  // Leaving to another page: fade out so page switches feel like one app.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname === location.pathname) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    e.preventDefault();
    document.body.classList.add('page-leave');
    setTimeout(() => { location.href = a.href; }, 160);
  });
  addEventListener('pageshow', () => document.body.classList.remove('page-leave'));
}
