// Shared Coach state for every page: the library (with your added lines), discoveries, and the
// background analyser. One tab analyses at a time (a localStorage lease); all tabs hear about changes.
import { Engine } from '../engine.js';
import { Library } from './library.js';
import { EngineQueue } from './analysis.js';
import { store, ls } from './store.js';
import { prepGames } from './games.js';
import { DOC, DEPTH, catchDiscoveries, mergeDocs, mergeItem, summarize, analyseDiscovery, statusOf, studiedLine } from './discoveries.js';

const LEASE = 'sfet.coach.lease';
const BADGE = 'sfet.coach.ready';
const LEASE_MS = 12000;
const ENGINE_URL = new URL('../../engine/stockfish-19-lite-single.js', import.meta.url).href;
const TAB = Math.random().toString(36).slice(2);

/** Analysis depths; ?depth=N (or localStorage sfet.coach.depth) lowers them for quick tests. */
function depthConfig() {
  let d = Number(new URLSearchParams(location.search).get('depth')) || Number(ls.get('sfet.coach.depth', 0));
  if (!d) return DEPTH;
  d = Math.max(4, Math.min(DEPTH.main, d));
  return { main: d, mainTime: 8000, reply: Math.max(4, d - 2), replyTime: 4000, idea: Math.max(4, d - 4), ideaTime: 1500 };
}

export const readyCount = () => Number(ls.get(BADGE, 0)) || 0;

/** Keep a badge element in sync with the number of discoveries ready to study (any tab). */
export function bindBadge(el) {
  const paint = (n) => { el.textContent = n > 0 ? String(n) : ''; el.hidden = !(n > 0); };
  paint(readyCount());
  addEventListener('storage', (e) => { if (e.key === BADGE) paint(readyCount()); });
  addEventListener('sfet-badge', () => paint(readyCount()));
}

class CoachService extends EventTarget {
  constructor() {
    super();
    this.lib = null;
    this.custom = [];
    this.doc = { v: 1, items: {} };
    this.user = ls.get('coach-user', '');
    this.games = [];
    this.depth = depthConfig();
    this.progress = null; // {id, stage, depth}
    this.channel = 'BroadcastChannel' in self ? new BroadcastChannel('sfet-coach') : null;
    this.channel?.addEventListener('message', (e) => this.#onMessage(e.data));
    this.ready = this.#init();
  }

  async #init() {
    this.lib = new Library();
    this.custom = (await store.get('custom').catch(() => null)) || [];
    this.lib.applyCustom(this.custom);
    this.doc = mergeDocs({ items: {} }, (await store.get(DOC).catch(() => null)) || {});
    this.#publishBadge();
    return this;
  }

  // ───── games ─────
  async loadGames() {
    if (!this.user) return [];
    const { api } = await import('./store.js');
    const r = await api(`/api/games?user=${encodeURIComponent(this.user)}`);
    this.games = prepGames(r.games, this.user);
    return this.games;
  }

  /** Download new months from chess.com. onStep(i, total) after each month. */
  async sync(user, onStep) {
    const { api } = await import('./store.js');
    this.user = user;
    ls.set('coach-user', user);
    const ar = await api(`/api/archives?user=${encodeURIComponent(user)}`);
    let i = 0;
    for (const ym of ar.todo) {
      await api(`/api/month?user=${encodeURIComponent(user)}&ym=${ym}`);
      onStep?.(++i, ar.todo.length);
    }
    await this.loadGames();
    const added = await this.ingest(this.games);
    return { games: this.games.length, months: ar.todo.length, discoveries: added };
  }

  // ───── discoveries ─────
  list() {
    return Object.values(this.doc.items).map((it) => summarize(it, this.depth.main)).sort((a, b) => b.impact - a.impact || b.last - a.last);
  }

  get(id) { const it = this.doc.items[id]; return it ? summarize(it, this.depth.main) : null; }

  /** Walk games against the library and record new or grown discoveries. Returns how many are new. */
  async ingest(games) {
    const found = catchDiscoveries(this.lib, games);
    let fresh = 0;
    let changed = false;
    for (const it of found) {
      const old = this.doc.items[it.id];
      if (!old) fresh++;
      const merged = mergeItem(old, it);
      if (!old || JSON.stringify(old.games) !== JSON.stringify(merged.games)) { this.doc.items[it.id] = merged; changed = true; }
    }
    if (changed) { await this.save(); this.#emit(); this.kick(); }
    return fresh;
  }

  async save() {
    // Merge with what other tabs may have written, then write back.
    const latest = (await store.get(DOC).catch(() => null)) || {};
    this.doc = mergeDocs(latest, this.doc);
    await store.set(DOC, this.doc);
    this.#publishBadge();
    this.channel?.postMessage({ type: 'doc', from: TAB });
  }

  async dismiss(id, on = true) {
    const it = this.doc.items[id];
    if (!it) return;
    it.dismissed = on ? { at: Date.now() } : { at: Date.now(), undone: true };
    await this.save();
    this.#emit();
  }

  /** Finish studying: add the line to the library and mark the discovery studied. */
  async study(id, chosenSan) {
    const it = this.doc.items[id];
    if (!it) throw new Error('Unknown discovery');
    const san = studiedLine(it, chosenSan);
    const s = summarize(it, this.depth.main);
    const mine = s.groups.find((g) => g.san === chosenSan);
    const best = it.analysis?.lines?.[0]?.san;
    const plan = chosenSan === best
      ? `They played ${s.label} in ${s.n === 1 ? 'one of your games' : `${s.n} of your games`}. ${chosenSan} is the engine's choice${mine ? ', and it is also what you played' : ''}.`
      : `They played ${s.label} in ${s.n === 1 ? 'one of your games' : `${s.n} of your games`}. You kept your own ${chosenSan}: it stays within a few points of the engine's ${best}.`;
    const title = `${s.label} ${chosenSan}`;
    if (!this.lib.hasLine(it.side, san)) {
      const entry = { side: it.side, san, title, plan, from: 'discovery', disc: id, date: Date.now() };
      this.custom.push(entry);
      this.lib.applyCustom([entry]);
      await store.set('custom', this.custom);
    }
    it.studied = { at: Date.now(), move: chosenSan, line: san };
    await this.save();
    this.channel?.postMessage({ type: 'custom', from: TAB });
    this.#emit();
    return { san, title };
  }

  /** Remove a line you added (and re-open its discovery). */
  async removeCustom(side, san) {
    const key = san.join(' ');
    const gone = this.custom.filter((c) => c.side === side && c.san.join(' ') === key);
    this.custom = this.custom.filter((c) => !(c.side === side && c.san.join(' ') === key));
    await store.set('custom', this.custom);
    for (const g of gone) if (g.disc && this.doc.items[g.disc]) this.doc.items[g.disc].studied = { at: Date.now(), undone: true };
    await this.save();
    this.lib = new Library();
    this.lib.applyCustom(this.custom);
    this.channel?.postMessage({ type: 'custom', from: TAB });
    this.#emit();
  }

  async addCustom(entry) {
    this.custom.push({ ...entry, date: Date.now() });
    this.lib.applyCustom([entry]);
    await store.set('custom', this.custom);
    this.channel?.postMessage({ type: 'custom', from: TAB });
    this.#emit();
  }

  #publishBadge() {
    const n = Object.values(this.doc.items).filter((it) => statusOf(it, this.depth.main) === 'ready').length;
    if (readyCount() !== n) ls.set(BADGE, n);
    dispatchEvent(new Event('sfet-badge'));
  }

  #emit() { this.dispatchEvent(new Event('change')); }

  async #onMessage(m) {
    if (!m || m.from === TAB) return;
    if (m.type === 'doc' || m.type === 'custom') {
      if (m.type === 'custom') {
        this.custom = (await store.get('custom').catch(() => null)) || [];
        this.lib = new Library();
        this.lib.applyCustom(this.custom);
      }
      this.doc = mergeDocs(this.doc, (await store.get(DOC).catch(() => null)) || {});
      this.#publishBadge();
      this.#emit();
      this.kick();
    }
    if (m.type === 'progress') { this.progress = m.progress; this.dispatchEvent(new Event('progress')); }
  }

  // ───── background analysis ─────
  #lease() {
    const now = Date.now();
    const l = ls.get(LEASE, null);
    if (l && l.owner !== TAB && l.until > now) return false;
    ls.set(LEASE, { owner: TAB, until: now + LEASE_MS });
    return ls.get(LEASE, null)?.owner === TAB;
  }

  #release() {
    const l = ls.get(LEASE, null);
    if (l?.owner === TAB) { try { localStorage.removeItem(LEASE); } catch { /* ignore */ } }
  }

  #next() {
    return this.list().find((s) => s.status === 'new' && !s.analysis?.over);
  }

  /** Start (or nudge) the background analyser. Safe to call often. */
  kick() {
    if (this.running || this.paused) return;
    if (!this.#next()) return;
    if (!this.#lease()) { clearTimeout(this.retry); this.retry = setTimeout(() => this.kick(), LEASE_MS); return; }
    this.running = this.#run().finally(() => { this.running = null; });
  }

  async #run() {
    if (!this.queue) this.queue = new EngineQueue(new Engine(ENGINE_URL));
    const renew = setInterval(() => this.#lease(), LEASE_MS / 3);
    try {
      for (let s = this.#next(); s && !this.paused; s = this.#next()) {
        const item = this.doc.items[s.id];
        const report = (p) => {
          this.progress = { id: s.id, ...p };
          this.dispatchEvent(new Event('progress'));
          this.channel?.postMessage({ type: 'progress', from: TAB, progress: this.progress });
        };
        const a = await analyseDiscovery(this.queue, item, this.depth, report);
        if (!a) break;
        this.doc.items[s.id] = mergeItem(this.doc.items[s.id], { ...this.doc.items[s.id], analysis: a });
        this.progress = null;
        report({ stage: 'done' });
        await this.save();
        this.#emit();
      }
    } catch (e) {
      console.error('Discovery analysis failed', e);
    } finally {
      clearInterval(renew);
      this.progress = null;
      this.#release();
    }
  }

  pause(on = true) {
    this.paused = on;
    if (on) this.queue?.clear(); else this.kick();
  }
}

let instance = null;
/** The page's single CoachService (created on first use). */
export function coach() {
  if (!instance) instance = new CoachService();
  return instance;
}
