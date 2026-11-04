// Shared Coach state for every page: the library (with your added lines), discoveries, and the
// background analyser. One tab analyses at a time (a localStorage lease); all tabs hear about changes.
import { Engine } from '../engine.js';
import { Library, moveLabel } from './library.js';
import { EngineQueue, reviewGame, bookPlies, reviewDocName, insightFromReview, reviewSummary } from './analysis.js';
import { store, ls } from './store.js';
import { prepGames } from './games.js';
import * as P from './progress.js';
import { buildPuzzles } from './puzzles.js';
import { journalDoc, emptyJournal, mergeJournal } from './journal.js';
import { fitCalibration, applyCalibration, paramAccuracy, DEFAULT_PARAMS } from './calibration.js';
import { Chess } from '../../vendor/chess.js';
import { DOC, DEPTH, catchDiscoveries, mergeDocs, mergeItem, summarize, analyseDiscovery, statusOf, studiedLine } from './discoveries.js';

const LEASE = 'sfet.coach.lease';
const BADGE = 'sfet.coach.ready';
const LEASE_MS = 12000;
const ENGINE_URL = new URL('../../engine/stockfish-19-lite-single.js', import.meta.url).href;
const TAB = Math.random().toString(36).slice(2);

/** Analysis depths; ?depth=N (or localStorage sfet.coach.depth) lowers them for quick tests. */
function depthConfig() {
  let d = Number(new URLSearchParams(location.search).get('depth')) || Number(ls.get('sfet.coach.depth', 0));
  if (!d) return { ...DEPTH, review: 12, deep: 16 };
  d = Math.max(4, Math.min(DEPTH.main, d));
  return { main: d, mainTime: 8000, reply: Math.max(4, d - 2), replyTime: 4000, idea: Math.max(4, d - 4), ideaTime: 1500, review: Math.min(12, d), deep: Math.min(16, d + 2) };
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
    this.reviewIdx = {}; // game id → reviewSummary (accuracy, sparkline, class counts)
    this.an = {}; // game id → Insights record
    this.journal = emptyJournal(); // game id → {note, tags, mood, at}
    this.depth = depthConfig();
    this.progress = null; // {id, stage, depth}
    this.channel = 'BroadcastChannel' in self ? new BroadcastChannel('sfet-coach') : null;
    this.channel?.addEventListener('message', (e) => this.#onMessage(e.data));
    this.ready = this.#init();
  }

  async #init() {
    this.lib = new Library();
    if (!this.user) {
      const prof = await store.get('profile').catch(() => null);
      if (prof?.user) { this.user = prof.user; ls.set('coach-user', this.user); }
    }
    this.custom = (await store.get('custom').catch(() => null)) || [];
    this.lib.applyCustom(this.custom);
    this.doc = mergeDocs({ items: {} }, (await store.get(DOC).catch(() => null)) || {});
    this.prog = P.mergeProgress(P.emptyProgress(), (await store.get(P.DOC).catch(() => null)) || {});
    // Accuracy formula fitted on public chess.com games (tools/calibrate-accuracy.mjs).
    try {
      const r = await fetch(new URL('../../models/accuracy-calibration.json', import.meta.url), { cache: 'no-cache' });
      if (r.ok) { const j = await r.json(); if (typeof j.k === 'number') this.accParams = j; }
    } catch { /* fall back to the default formula */ }
    this.#publishBadge();
    return this;
  }

  // ───── practice log and spaced repetition ─────
  async #saveProgress() {
    const latest = (await store.get(P.DOC).catch(() => null)) || {};
    this.prog = P.mergeProgress(latest, this.prog);
    await store.set(P.DOC, this.prog).catch((e) => console.warn(e));
    this.channel?.postMessage({ type: 'progress-doc', from: TAB });
    this.dispatchEvent(new Event('practice'));
  }

  /** Count an activity toward today (kind: drill | study | review | game | insight). */
  async log(kind, id = null) {
    await this.ready;
    const latest = (await store.get(P.DOC).catch(() => null)) || {};
    this.prog = P.mergeProgress(latest, this.prog);
    if (P.logActivity(this.prog, kind, { id })) await this.#saveProgress();
  }

  /** A drill of a library line finished; clean = no mistakes. */
  async reviewLine(side, san, clean) {
    P.reviewLine(this.prog, P.lineKey(side, san), clean);
    await this.#saveProgress();
  }

  due() { return P.dueLines(this.prog, this.lib); }

  /** Puzzles from your reviewed games (rebuilt when reviews change). */
  puzzles() {
    const n = Object.keys(this.an).length * 1000 + this.games.length;
    if (this.pzCache?.n !== n) this.pzCache = { n, list: buildPuzzles(this.games, this.an) };
    return this.pzCache.list;
  }

  // ───── journal and plans ─────
  /** Save the journal entry for a game (merged with what other tabs saved). */
  async saveJournal(id, entry) {
    const name = journalDoc(this.user);
    const latest = (await store.get(name).catch(() => null)) || {};
    const t = this.games.find((x) => x.id === id)?.t || null;
    this.journal = mergeJournal(latest, this.journal);
    this.journal.e[id] = { ...entry, t, at: Date.now() };
    await store.set(name, this.journal).catch((e) => console.warn(e));
    this.channel?.postMessage({ type: 'journal', from: TAB });
    if (!entry.skip && P.logActivity(this.prog, 'journal', { id })) await this.#saveProgress();
    this.dispatchEvent(new Event('journal'));
  }

  async setPlans(plans) {
    this.prog.plans = plans;
    this.prog.plansAt = Date.now();
    await this.#saveProgress();
  }

  async setGoals(goals) {
    this.prog.goals = goals;
    this.prog.goalsAt = Date.now();
    await this.#saveProgress();
  }

  /** A training exercise finished (key: eg|id or calc|id). */
  async trainResult(key, clean) {
    P.reviewLine(this.prog, key, clean);
    P.logActivity(this.prog, 'train', { id: key });
    await this.#saveProgress();
  }

  /** A puzzle attempt finished; clean = solved without a mistake or hint. */
  async solvePuzzle(id, clean) {
    P.reviewLine(this.prog, P.puzzleKey(id), clean);
    P.logActivity(this.prog, 'puzzle', { id });
    await this.#saveProgress();
  }

  /**
   * The moves a chess.com opponent actually plays, from their own public games (last 3 months):
   * Map(position key → {total, moves: Map(san → {n, score})}) for positions where they were to move.
   */
  /** A chess.com player's public games from the last `months` months (cached in data/users). */
  async playerGames(name, months = 3, onStep) {
    const { api } = await import('./store.js');
    const ar = await api(`/api/archives?user=${encodeURIComponent(name)}`);
    const want = ar.months.slice(-months);
    let i = 0;
    for (const ym of want) {
      if (ar.todo.includes(ym)) await api(`/api/month?user=${encodeURIComponent(name)}&ym=${ym}`);
      onStep?.(++i, want.length);
    }
    const r = await api(`/api/games?user=${encodeURIComponent(name)}`);
    const recent = new Set(want);
    return r.games.filter((g) => { const d = new Date(g.end_time * 1000); return recent.has(`${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`); });
  }

  async opponentBook(name, onStep) {
    const key = String(name || '').toLowerCase();
    this.oppBooks ||= new Map();
    if (this.oppBooks.has(key)) return this.oppBooks.get(key);
    const raw = await this.playerGames(name, 3, onStep);
    const book = new Map();
    let games = 0;
    for (const g of raw) {
      if (g.rules !== 'chess') continue;
      const col = (g.white?.username || '').toLowerCase() === key ? 'w' : (g.black?.username || '').toLowerCase() === key ? 'b' : null;
      if (!col) continue;
      games++;
      const me = col === 'w' ? g.white : g.black;
      const sc = me.result === 'win' ? 1 : ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(me.result) ? 0.5 : 0;
      const c = new Chess();
      const sans = (await import('./games.js')).pgnSans(g.pgn);
      for (let ply = 0; ply < Math.min(30, sans.length); ply++) {
        const k = c.fen().split(' ').slice(0, 4).join(' ');
        if (c.turn() === col) {
          let e = book.get(k);
          if (!e) { e = { total: 0, moves: new Map() }; book.set(k, e); }
          e.total++;
          const m = e.moves.get(sans[ply]) || { n: 0, score: 0 };
          m.n++;
          m.score += sc;
          e.moves.set(sans[ply], m);
        }
        try { c.move(sans[ply]); } catch { break; }
      }
    }
    const out = { name, games, book };
    this.oppBooks.set(key, out);
    return out;
  }

  // ───── games ─────
  async loadGames() {
    if (!this.user) return [];
    const { api } = await import('./store.js');
    const r = await api(`/api/games?user=${encodeURIComponent(this.user)}`);
    this.games = prepGames(r.games, this.user);
    const u = this.user.toLowerCase();
    this.reviewIdx = (await store.get(`rvidx-${u}`).catch(() => null)) || {};
    this.an = (await store.get(`an-${u}`).catch(() => null)) || {};
    this.journal = mergeJournal(emptyJournal(), (await store.get(journalDoc(u)).catch(() => null)) || {});
    this.#emit();
    this.kick();
    return this.games;
  }

  /** Download new months from chess.com. onStep(i, total) after each month. */
  async sync(user, onStep) {
    const { api } = await import('./store.js');
    this.user = user;
    ls.set('coach-user', user);
    store.set('profile', { user }).catch(() => null);
    const ar = await api(`/api/archives?user=${encodeURIComponent(user)}`);
    let i = 0;
    for (const ym of ar.todo) {
      await api(`/api/month?user=${encodeURIComponent(user)}&ym=${ym}`);
      onStep?.(++i, ar.todo.length);
    }
    const before = new Set(this.games.map((g) => g.id));
    await this.loadGames();
    ls.set('sfet.lastSync', Date.now());
    const added = await this.ingest(this.games);
    const fresh = before.size ? this.games.filter((g) => !before.has(g.id)).length : 0;
    this.dispatchEvent(new CustomEvent('synced', { detail: { fresh, discoveries: added } }));
    return { games: this.games.length, months: ar.todo.length, discoveries: added, fresh };
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
    const title = `${s.label} ${moveLabel(it.ply + 1)}${chosenSan}`;
    if (!this.lib.hasLine(it.side, san)) {
      const entry = { side: it.side, san, title, plan, from: 'discovery', disc: id, date: Date.now() };
      this.custom.push(entry);
      this.lib.applyCustom([entry]);
      await store.set('custom', this.custom);
    }
    it.studied = { at: Date.now(), move: chosenSan, line: san };
    this.log('study', id);
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
    if (m.type === 'progress-doc') {
      this.prog = P.mergeProgress(this.prog, (await store.get(P.DOC).catch(() => null)) || {});
      this.dispatchEvent(new Event('practice'));
      return;
    }
    if (m.type === 'journal') {
      this.journal = mergeJournal(this.journal, (await store.get(journalDoc(this.user)).catch(() => null)) || {});
      this.dispatchEvent(new Event('journal'));
      return;
    }
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
    if (m.type === 'progress') {
      this.progress = m.progress;
      if (m.progress?.kind === 'review' && m.progress.i === m.progress.n) setTimeout(() => this.#refreshReviews(), 600);
      this.dispatchEvent(new Event('progress'));
    }
  }

  async #refreshReviews() {
    if (!this.user) return;
    const u = this.user.toLowerCase();
    this.reviewIdx = { ...this.reviewIdx, ...((await store.get(`rvidx-${u}`).catch(() => null)) || {}) };
    this.an = { ...this.an, ...((await store.get(`an-${u}`).catch(() => null)) || {}) };
    this.dispatchEvent(new CustomEvent('reviewed', { detail: {} }));
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
    const d = this.list().find((s) => s.status === 'new' && !s.analysis?.over);
    if (d) return { kind: 'disc', s: d };
    if (this.reviewsOff) return null;
    const legacy = this.games.find((x) => this.reviewIdx[x.id] && (!this.reviewIdx[x.id].s || !this.reviewIdx[x.id].l) && !this.legacyDone?.has(x.id));
    if (legacy) return { kind: 'legacy', x: legacy };
    for (let i = this.games.length - 1; i >= 0; i--) {
      const x = this.games[i];
      if (x.sans.length >= 2 && !this.reviewIdx[x.id]) return { kind: 'review', x };
    }
    if (this.deepOff) return null;
    const now = Date.now() / 1000;
    const deep = this.games.filter((x) => x.sans.length >= 2 && (this.reviewIdx[x.id]?.d || 0) < this.depth.deep && !this.deepDone?.has(x.id));
    if (!deep.length) return null;
    const prio = (x) => (now - x.t < 60 * 86400 ? 2 : 0) + (x.sc === 0 ? 1 : 0) + (x.sc === 0.5 ? 0.5 : 0) + x.t / 1e10;
    deep.sort((a, b) => prio(b) - prio(a));
    return { kind: 'review', x: deep[0], deep: true };
  }

  /** Accuracy before your personal adjustment: the publicly fitted formula on per-move losses. */
  baseAcc(id, side) {
    const r = this.reviewIdx[id];
    if (!r) return null;
    return r.l ? paramAccuracy(r.l, side, this.accParams || DEFAULT_PARAMS) : r[side];
  }

  /** Your personal adjustment toward chess.com's numbers, once enough of your games have both. */
  get cal() {
    const n = Object.keys(this.reviewIdx).length;
    if (this.calCache?.n !== n || this.calCache.g !== this.games.length) {
      const pairs = [];
      for (const x of this.games) {
        const cc = x.g?.accuracies;
        if (!cc || !this.reviewIdx[x.id]) continue;
        if (typeof cc.white === 'number') pairs.push({ raw: this.baseAcc(x.id, 'w'), ref: cc.white });
        if (typeof cc.black === 'number') pairs.push({ raw: this.baseAcc(x.id, 'b'), ref: cc.black });
      }
      // A personal fit only adds to the public one when it clearly helps.
      let cal = fitCalibration(pairs);
      if (cal && cal.maeRaw - cal.maeFit < 1) cal = null;
      this.calCache = { n, g: this.games.length, cal, pairs: pairs.length };
    }
    return this.calCache.cal;
  }

  calAcc(raw) { return applyCalibration(raw, this.cal); }

  /** Accuracy shown for a reviewed game and side. */
  accOf(id, side) { const b = this.baseAcc(id, side); return b == null ? null : this.calAcc(b); }

  /** Accuracy from a full review's per-ply losses. */
  accFromLosses(loss, side) { return this.calAcc(paramAccuracy(loss, side, this.accParams || DEFAULT_PARAMS)); }

  /** Background review progress: {done, total, deep}. */
  reviewProgress() {
    const total = this.games.filter((x) => x.sans.length >= 2).length;
    return { done: this.games.filter((x) => this.reviewIdx[x.id]).length, total, deep: this.games.filter((x) => (this.reviewIdx[x.id]?.d || 0) >= this.depth.deep).length };
  }

  /** Store a finished review (also used when the Review screen computes one itself). */
  async saveReview(x, R) {
    if ((this.reviewIdx[x.id]?.d || 0) > R.d && this.reviewIdx[x.id]?.l) return;
    await store.set(reviewDocName(x.id), R);
    this.reviewIdx[x.id] = reviewSummary(R);
    const ins = insightFromReview(x, R);
    if (!this.an[x.id] || (this.an[x.id].d || 0) <= ins.d) this.an[x.id] = ins;
    const u = this.user.toLowerCase();
    const now = Date.now();
    if (!this.lastIdxSave || now - this.lastIdxSave > 4000) {
      this.lastIdxSave = now;
      await store.set(`rvidx-${u}`, this.reviewIdx);
      await store.set(`an-${u}`, this.an);
    } else {
      clearTimeout(this.idxTimer);
      this.idxTimer = setTimeout(() => { this.lastIdxSave = Date.now(); store.set(`rvidx-${u}`, this.reviewIdx); store.set(`an-${u}`, this.an); }, 4200);
    }
    this.dispatchEvent(new CustomEvent('reviewed', { detail: { id: x.id } }));
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
      for (let job = this.#next(); job && !this.paused; job = this.#next()) {
        if (job.kind === 'legacy') {
          (this.legacyDone ||= new Set()).add(job.x.id);
          const R = await store.get(reviewDocName(job.x.id)).catch(() => null);
          if (R?.ev) await this.saveReview(job.x, R); else delete this.reviewIdx[job.x.id];
          continue;
        }
        if (job.kind === 'review') {
          const { x } = job;
          let i = 0;
          const n = x.sans.length + 1;
          const R = await reviewGame(this.queue, x.sans, {
            depth: job.deep ? this.depth.deep : this.depth.review,
            bookPlies: bookPlies(x, this.lib.walk(x.col, x.sans).ply),
            isCancelled: () => this.paused,
            tick: () => {
              i++;
              if (i % 4 && i !== n) return;
              this.progress = { kind: 'review', deep: !!job.deep, id: x.id, i, n, label: `${x.opp} (${x.col === 'w' ? 'White' : 'Black'})` };
              this.dispatchEvent(new Event('progress'));
              this.channel?.postMessage({ type: 'progress', from: TAB, progress: this.progress });
            },
          });
          if (!R) break;
          if (job.deep) (this.deepDone ||= new Set()).add(x.id);
          await this.saveReview(x, R);
          this.progress = null;
          this.dispatchEvent(new Event('progress'));
          continue;
        }
        const { s } = job;
        const item = this.doc.items[s.id];
        const report = (p) => {
          this.progress = { kind: 'disc', id: s.id, ...p };
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

  /** Re-sync chess.com games every `minutes` (0 = off) while a page is open. */
  autoSyncMinutes() { return Number(ls.get('sfet.autoSync', 60)); }

  setAutoSync(minutes) { ls.set('sfet.autoSync', minutes); }

  startAutoSync() {
    clearInterval(this.autoTimer);
    const tick = async () => {
      const m = this.autoSyncMinutes();
      if (!m || !this.user || this.syncing) return;
      const last = Number(ls.get('sfet.lastSync', 0));
      if (Date.now() - last < m * 60000) return;
      ls.set('sfet.lastSync', Date.now()); // claim it so other tabs don't sync too
      this.syncing = true;
      try { await this.sync(this.user); } catch (e) { console.warn('auto sync failed', e); } finally { this.syncing = false; }
    };
    this.autoTimer = setInterval(tick, 60000);
    setTimeout(tick, 4000);
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
