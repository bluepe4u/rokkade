// Opening prior for the first 10 plies.
//
// Maia-2 was trained without the first 10 plies of every game, so its opening
// predictions are unreliable (e.g. it ranks 2.Qh5 above 2.Nf3 after 1.e4 e5).
// For positions in this book the solver uses "how much named opening theory
// continues with this move" (Lichess chess-openings, CC0; see tools/build_book.py)
// as the human prior instead. It is a rough popularity proxy, not real game
// statistics, and deliberately leaves every other legal move a small chance so
// the engine, not the book, decides whether an off-book move is acceptable.

const UNLISTED_WEIGHT = 0.15;

export const positionKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

export class OpeningBook {
  constructor(data) {
    this.data = data;
  }

  static async load(url = new URL('../models/opening-book.json', import.meta.url).href, readJson) {
    return new OpeningBook(readJson ? await readJson(url) : await (await fetch(url)).json());
  }

  /** @returns {Map<string, number>|null} probability per legal move, or null when the position is not in the book */
  prior(fen, legalUci) {
    const entry = this.data[positionKey(fen)];
    if (!entry) return null;
    const weights = legalUci.map((m) => (entry[m] ?? 0) + UNLISTED_WEIGHT);
    const total = weights.reduce((a, b) => a + b, 0);
    return new Map(legalUci.map((m, i) => [m, weights[i] / total]));
  }
}
