// Runs the four-player bot off the UI thread:  postMessage({ id, state, level })  ->  { id, move, value, depth, nodes }
import { deserialize } from './rules.js';
import { chooseMove } from './bot.js';

self.onmessage = (e) => {
  const { id, state, level } = e.data;
  try {
    const r = chooseMove(deserialize(state), level);
    self.postMessage({ id, move: r ? r.move : null, value: r?.value ?? 0, depth: r?.depth ?? 0, nodes: r?.nodes ?? 0 });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
