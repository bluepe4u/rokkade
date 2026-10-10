// Minimal UCI client that runs the bundled Stockfish WASM engine in a Node child process.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseInfo } from '../public/js/engine.js';

const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/engine/stockfish-19-lite-single.js');

export class NodeEngine {
  constructor() {
    this.proc = spawn(process.execPath, [ENGINE], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.listeners = new Set();
    let buf = '';
    this.proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        for (const fn of [...this.listeners]) fn(line);
      }
    });
  }
  send(cmd) { this.proc.stdin.write(`${cmd}\n`); }
  waitFor(pred) {
    return new Promise((resolve) => {
      const fn = (l) => { if (pred(l)) { this.listeners.delete(fn); resolve(l); } };
      this.listeners.add(fn);
    });
  }
  async init() {
    const ok = this.waitFor((l) => l === 'uciok');
    this.send('uci');
    await ok;
    this.send('setoption name Hash value 32');
    const ready = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    await ready;
    return this;
  }
  /** Returns MultiPV lines (best first) for the final depth reached. */
  async analyse(fen, { multipv = 1, depth = 10, movetime = 0 } = {}) {
    const lines = new Map();
    const fn = (l) => { const info = parseInfo(l); if (info && !(info.bound && lines.has(info.multipv))) lines.set(info.multipv, info); };
    this.listeners.add(fn);
    const done = this.waitFor((l) => l.startsWith('bestmove'));
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}${movetime ? ` movetime ${movetime}` : ''}`);
    await done;
    this.listeners.delete(fn);
    return [...lines.values()].sort((a, b) => a.multipv - b.multipv);
  }
  quit() { this.send('quit'); setTimeout(() => this.proc.kill(), 200); }
}
