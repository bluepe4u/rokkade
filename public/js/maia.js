// Maia-2 (https://github.com/CSSLab/maia2, MIT) running in the browser via onnxruntime-web.
//
// Maia-2 predicts which move a human of a given rating would play. The network
// always looks at the board from White's point of view, so Black-to-move
// positions are mirrored on the way in and the move list is mirrored on the way
// out. Ratings are bucketed into 11 categories (<1100, 1100-1199, ..., 1900-1999,
// >=2000) and both players' categories condition the prediction.

const FILES = 'abcdefgh';
const PIECE_CHANNEL = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };

export const ELO_CATEGORY_MIN = 1100;
export const ELO_CATEGORY_MAX = 2000;
export const ELO_CATEGORIES = 11;

/** Bucket a rating the way the original model does (maia2.utils.map_to_category). */
export function eloCategory(elo) {
  if (elo < ELO_CATEGORY_MIN) return 0;
  if (elo >= ELO_CATEGORY_MAX) return ELO_CATEGORIES - 1;
  return 1 + Math.floor((elo - ELO_CATEGORY_MIN) / 100);
}

export function mirrorSquare(sq) {
  return sq[0] + (9 - Number(sq[1]));
}

export function mirrorMove(uci) {
  return mirrorSquare(uci.slice(0, 2)) + mirrorSquare(uci.slice(2, 4)) + uci.slice(4);
}

/**
 * Encode a FEN as the model's 18x8x8 input (flattened, channel-major).
 * Channels: 0-5 white P N B R Q K, 6-11 black, 12 side to move, 13-16 castling
 * (white K, white Q, black K, black Q), 17 en-passant target.
 * @returns {{tensor: Float32Array, mirrored: boolean}}
 */
export function encodeBoard(fen) {
  const [placement, turn, castling = '-', ep = '-'] = fen.split(' ');
  const mirrored = turn === 'b';
  const tensor = new Float32Array(18 * 64);
  const rows = placement.split('/');
  for (let r = 0; r < 8; r++) {
    const rank = 7 - r; // rows[0] is rank 8
    let file = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') { file += Number(ch); continue; }
      const white = ch === ch.toUpperCase();
      const isWhite = mirrored ? !white : white;
      const row = mirrored ? 7 - rank : rank;
      const channel = PIECE_CHANNEL[ch.toLowerCase()] + (isWhite ? 0 : 6);
      tensor[channel * 64 + row * 8 + file] = 1;
      file++;
    }
  }
  tensor.fill(1, 12 * 64, 13 * 64); // the side to move is always "white" after mirroring
  const has = (c) => castling.includes(c);
  const flags = mirrored ? [has('k'), has('q'), has('K'), has('Q')] : [has('K'), has('Q'), has('k'), has('q')];
  flags.forEach((on, i) => { if (on) tensor.fill(1, (13 + i) * 64, (14 + i) * 64); });
  if (ep !== '-') {
    const file = FILES.indexOf(ep[0]);
    const rank = Number(ep[1]) - 1;
    tensor[17 * 64 + (mirrored ? 7 - rank : rank) * 8 + file] = 1;
  }
  return { tensor, mirrored };
}

/** Softmax of `logits` restricted to `indices`; returns probabilities in the same order. */
export function maskedSoftmax(logits, indices) {
  let max = -Infinity;
  for (const i of indices) if (logits[i] > max) max = logits[i];
  const exps = indices.map((i) => Math.exp(logits[i] - max));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / total);
}

export class Maia {
  /**
   * @param {object} session an onnxruntime InferenceSession
   * @param {object} ort the onnxruntime module (for Tensor)
   * @param {string[]} moves the 1880-entry policy index (maia2-moves.json)
   */
  constructor(session, ort, moves) {
    this.session = session;
    this.ort = ort;
    this.moves = moves;
    this.index = new Map(moves.map((m, i) => [m, i]));
  }

  /**
   * Download and initialise the model.
   * @param {{base?: string, onProgress?: (fraction:number)=>void, ortModule?: object, wasmPaths?: string, readBytes?: (url:string)=>Promise<Uint8Array>}} opts
   */
  static async load({ base = new URL('../models/', import.meta.url).href, onProgress, ortModule, wasmPaths, readBytes } = {}) {
    const ort = ortModule || (await import('../vendor/ort/ort.wasm.min.mjs'));
    ort.env.wasm.wasmPaths = wasmPaths || new URL('../vendor/ort/', import.meta.url).href;
    ort.env.wasm.numThreads = 1; // single-threaded: works without cross-origin isolation
    ort.env.wasm.proxy = false;
    const fetchBytes = readBytes || ((url) => fetchWithProgress(url, onProgress));
    const [moves, bytes] = await Promise.all([
      (readBytes ? readBytes(`${base}maia2-moves.json`).then((b) => JSON.parse(new TextDecoder().decode(b)))
        : fetch(`${base}maia2-moves.json`).then((r) => r.json())),
      fetchBytes(`${base}maia2-blitz.onnx`),
    ]);
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return new Maia(session, ort, moves);
  }

  /**
   * Probability that a player rated `eloSelf` (facing `eloOppo`) plays each legal move.
   * @param {string} fen position, side to move is the player being modelled
   * @param {string[]} legalUci legal moves in UCI (e.g. from chess.js)
   * @returns {Promise<{probs: Map<string, number>, value: number}>} value = side-to-move win chance (0-1)
   */
  async predict(fen, eloSelf, eloOppo, legalUci) {
    const { tensor, mirrored } = encodeBoard(fen);
    const { Tensor } = this.ort;
    const out = await this.session.run({
      boards: new Tensor('float32', tensor, [1, 18, 8, 8]),
      elo_self: new Tensor('int64', BigInt64Array.from([BigInt(eloCategory(eloSelf))]), [1]),
      elo_oppo: new Tensor('int64', BigInt64Array.from([BigInt(eloCategory(eloOppo))]), [1]),
    });
    const logits = out.logits.data;
    const keys = legalUci.map((m) => (mirrored ? mirrorMove(m) : m));
    const indices = keys.map((k) => {
      const i = this.index.get(k);
      if (i === undefined) throw new Error(`Move ${k} is not in the Maia-2 policy index`);
      return i;
    });
    const p = maskedSoftmax(logits, indices);
    const probs = new Map(legalUci.map((m, i) => [m, p[i]]));
    const value = Math.min(1, Math.max(0, out.value.data[0] / 2 + 0.5));
    return { probs, value };
  }
}

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total) onProgress(loaded / total);
  }
  const bytes = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  return bytes;
}
