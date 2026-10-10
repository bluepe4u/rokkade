// Thin UCI wrapper around the Stockfish WASM worker.
// Only one search runs at a time; a newer analyse() call supersedes older ones.

export function parseInfo(line) {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const t = line.split(/\s+/);
  const info = { multipv: 1 };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': info.depth = +t[++i]; break;
      case 'seldepth': info.seldepth = +t[++i]; break;
      case 'multipv': info.multipv = +t[++i]; break;
      case 'nodes': info.nodes = +t[++i]; break;
      case 'nps': info.nps = +t[++i]; break;
      case 'time': info.time = +t[++i]; break;
      case 'score': {
        const kind = t[++i];
        const value = +t[++i];
        info.score = kind === 'mate' ? { mate: value } : { cp: value };
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') info.bound = t[++i];
        break;
      }
      case 'pv': info.pv = t.slice(i + 1); i = t.length; break;
    }
  }
  return info.score && info.pv && info.pv.length ? info : null;
}

export class Engine {
  constructor(url) {
    this.listeners = new Set();
    this.gen = 0;
    this.running = null;
    this.worker = new Worker(url);
    this.worker.onmessage = (e) => {
      const line = String(e.data);
      for (const fn of [...this.listeners]) fn(line);
    };
    this.ready = this.#init();
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  #waitFor(pred) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (pred(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  async #init() {
    const name = new Promise((resolve) => {
      let name = 'Stockfish';
      const fn = (l) => {
        if (l.startsWith('id name ')) name = l.slice(8);
        if (l === 'uciok') { this.listeners.delete(fn); resolve(name); }
      };
      this.listeners.add(fn);
    });
    this.send('uci');
    this.name = await name;
    this.send('setoption name Hash value 32');
    await this.isReady();
    return this.name;
  }

  async isReady() {
    const p = this.#waitFor((l) => l === 'readyok');
    this.send('isready');
    await p;
  }

  async newGame() {
    await this.ready;
    this.cancel();
    if (this.running) await this.running;
    this.send('ucinewgame');
    await this.isReady();
  }

  /** Abort the current search (if any) and invalidate pending callers. */
  cancel() {
    this.gen++;
    if (this.running) this.send('stop');
  }

  /**
   * Search `fen` with MultiPV. Calls onUpdate(lines) while streaming.
   * Resolves with the final lines, or null when superseded by a newer call.
   */
  async analyse({ fen, multipv = 1, depth = 12, movetime = 0, onUpdate }) {
    const id = ++this.gen;
    await this.ready;
    while (this.running) {
      this.send('stop');
      await this.running;
    }
    if (id !== this.gen) return null;

    const lines = new Map();
    const snapshot = () => [...lines.values()].sort((a, b) => a.multipv - b.multipv);
    let done;
    this.running = new Promise((r) => (done = r));

    const fn = (line) => {
      const info = parseInfo(line);
      if (info) {
        if (info.bound && lines.has(info.multipv)) return; // keep the exact score
        lines.set(info.multipv, info);
        if (id === this.gen && onUpdate) onUpdate(snapshot());
      } else if (line.startsWith('bestmove')) {
        this.listeners.delete(fn);
        done();
      }
    };
    this.listeners.add(fn);

    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}${movetime > 0 ? ` movetime ${movetime}` : ''}`);

    await this.running;
    this.running = null;
    return id === this.gen ? snapshot() : null;
  }
}
