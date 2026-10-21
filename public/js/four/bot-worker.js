// Runs the four-player bot off the UI thread.
//   { id, state, level }                  -> { id, move, value, depth, nodes }          choose a move
//   { id, type: 'analyse', state, n, timeMs }
//        -> { id, type: 'partial', depth, nodes, lines } after each depth, then { id, type: 'done', ... }
import { deserialize } from './rules.js';
import { chooseMove, analyse } from './bot.js';

self.onmessage = (e) => {
  const { id, type, state, level, n, timeMs } = e.data;
  try {
    if (type === 'analyse') {
      const result = analyse(deserialize(state), {
        n, timeMs, onDepth: (d) => self.postMessage({ id, type: 'partial', ...d }),
      });
      self.postMessage({ id, type: 'done', ...result });
      return;
    }
    const r = chooseMove(deserialize(state), level);
    self.postMessage({ id, move: r ? r.move : null, value: r?.value ?? 0, depth: r?.depth ?? 0, nodes: r?.nodes ?? 0 });
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String((err && err.message) || err) });
  }
};
