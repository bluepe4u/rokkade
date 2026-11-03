# Stockfish Elo Terminal

A browser chess terminal built around an **Elo-weighted Stockfish solver**. Set the solver's strength anywhere from **0 to 3000 Elo**, let it or a human play each side, and watch it highlight its **n best moves**: how likely a player of that Elo is to choose each one, and how each line changes the material balance.

The header switches between three spaces: **Play** (the classic terminal, below), **[Coach](#coach)** (your opening library, your chess.com games, and lessons built from the moves that surprised you) and **[4-Player](#four-player-chess)** chess.

Strength in the classic game comes from **Maia-2**, a neural network that predicts which move a human of a given rating plays, combined with **Stockfish** so that mistakes happen where players of that rating actually make them.

The design takes its cues from [aidachess.com](https://aidachess.com): a warm parchment/navy palette, terracotta accents, and Sora, Onest and JetBrains Mono type. Light and dark themes are both included.

## Run it (Windows, macOS, Linux; no Docker, no `npm install`)

Everything is bundled: the Stockfish 19 WASM engine, chess.js and the piece set. You only need **Node.js** *or* **Python 3**.

| OS | How |
| --- | --- |
| **Windows** | Double-click **`start.bat`** (uses Node if installed, otherwise Python) |
| macOS / Linux | `./start.sh` |
| Any | `node server.js` or `python serve.py` (optional port: `node server.js 9000`) |

Your browser opens at <http://localhost:8080>. The page has to be served over HTTP because browsers won't load the WASM engine from `file://`. The servers listen on this computer only; the Coach's chess.com import is the only outside connection, and your games and progress are saved in the `data/` folder next to the app.

## Features

- **Per-side control:** White and Black can each be *Human* or *Solver*, so you can play human vs. solver, solver vs. solver, or move for both sides yourself with hints.
- **Per-side Elo (0–3000)**, with quick presets and a band label (Beginner, Club, Master, …).
- **n-best moves (1–8)** drawn as numbered arrows. Arrow thickness and opacity follow the probability that a player of the chosen Elo picks that move.
- **Material outcome per line:** each candidate's principal variation is played out to the *material horizon*. The panel then shows the net change (`+3`, `−1`, `±0`), a short description ("Wins a knight", "Even trade", "Mates in 2"), and the pieces won and lost. If the horizon would cut an exchange in half, it is extended until the captures stop.
- **Hover a line** to see its continuation as a numbered arrow sequence. **Click a line** to play it.
- **Solver moves are sampled** from the blended Maia-2 + Stockfish distribution over all legal moves. The move list tags each one with the line it came from, and the tooltip shows its probability.
- **Few controls:** the Elo of each side, how many best moves to show, and display toggles. Search depth, thinking time and how human the play feels are derived from the Elo; an *Advanced → Human slips* slider is the one override.
- Eval bar, captured pieces, move list with navigation, FEN load/copy, PGN export, flip, pause, promotion picker, drag-and-drop or click-to-move, and keyboard shortcuts.

### Keyboard

`←` / `→` step through moves · `Home` / `End` jump to the start / end · `Space` plays a solver move · `F` flips the board · `P` pauses / resumes · `N` starts a new game

## How the Elo model works

Each move gets three numbers: **Maia-2's** probability that a player of that Elo plays it, **Stockfish's** win-% lost against the best move (searching every legal move), and the blend of the two (`public/js/solver.js`):

```
q(m) = Maia(m | elo)^alpha                human prior (the opening book stands in for the first 10 plies)
s(m) = exp(-winLoss(m) / tau)             soundness
g    = sum_m Maia(m) * s(m)               how likely a typical player of this Elo is to find a sound move HERE
beta = cap(elo) * g^kappa                 how strictly the engine vetoes unsound moves
p(m) ~ q(m) * s(m)^beta
```

Where a sound move is easy to find (`g` high) bad moves are pruned; where the sound moves are ones a typical player would miss (`g` low), `beta` collapses and Maia's own human mistake comes through. Errors therefore cluster in the positions where that rating actually goes wrong. The hint cards rank moves by this blended probability and show the human likelihood next to the engine's view.

The Elo axis has three regimes, because **Maia-2 only distinguishes ratings from "under 1100" to "2000+"** (Lichess ratings; chess.com ratings usually run lower):

| Elo | What the solver does |
| --- | --- |
| 1100 – 2000 | Maia-2 as is, with a light engine veto (`cap` 0.12 – 0.2). Calibrated: it scores about 50% against a raw Maia-2 of the same rating (measured 48% / 63% / 57% at 1100 / 1500 / 1900, 24 games each, so ±70 Elo of noise). |
| below ~1100 | Extrapolation. The human prior fades, the engine speaks through a *wide* softmax (the best move is barely favoured and standout tactics are found only part of the time), and a growing share of moves are **lapses**: one of the player's top 8 natural-looking moves played without checking it. About 90% lapses at 0–100 Elo, none at 1100. Against a Maia-2 1100 opponent it scores about 8% / 13% / 21% / 29% at 100 / 250 / 500 / 800 Elo. |
| above 2000 | Extrapolation. The prior fades out and the veto tightens until the top engine moves are played near 3000. Not yet measured against anything. |

The Elo label is therefore anchored to Maia-2's Lichess scale, not to chess.com. Chess.com's accuracy-based "game rating" is also lenient at the bottom: once a game is lost nearly every later move counts as fine, so a bot that loses 92% of its games to a 1100 player can still read as ~1050 there. That is why the low end needs errors in equal positions, which the lapses provide.

### Calibration tools

```bash
node tools/match.mjs --elo 100,500,1100 --ref 1100 --games 12 --review 1   # strength: solver vs raw Maia-2, performance rating
node tools/match.mjs --elo 1500 --ref 1500 --games 24                      # label parity with Maia-2
node tools/calibrate.mjs --elo 500,1500 --games 12 --mode blend            # self-play move-class mix (best / excellent / good / ...)
node tools/calibrate.mjs --elo 1500 --mode maia                            # the same for raw Maia-2, as the human reference
```

`--beta-cap`, `--tau`, `--alpha`, `--lambda` and `--humanness` override the model for experiments. Match scores from 12–24 games carry roughly ±70–100 Elo of noise; use more games before moving a curve.

## Coach

`coach.html` (the **Coach** tab) is the former Chess Coach app, merged in and redesigned. Its sections:

| Section | What it does |
| --- | --- |
| **Discoveries** | Positions where an opponent answered your opening with a move your library doesn't cover. Each one becomes a short animated lesson; when you finish it, the line joins your library. |
| **Library** | Your opening tree (32 White and 52 Black lines to start). *Explore* it move by move, or *Drill* it: play your moves from memory while the app plays the replies. Lines added from your games sit on their own shelf and in their chapter, marked *New*. |
| **Games** | Import your public chess.com games (later updates only fetch new months). Score against rating expectation, advice, rating chart, your openings with *Strong* / *Weak* tags (95% margin, 15+ games), and *habits*: where you left the library on your own move, with *Drill the library move* or *Keep my move too*. |
| **Review** | One game, move by move, with move classes (best, excellent, good, inaccuracy, mistake, miss, blunder, brilliant, great), accuracy, an evaluation graph, comments, and *Try this move again*. |
| **Insights** | Stockfish over many games: blunders per game and by phase, the move of your first blunder, missed punishments, and the material you gave up, with puzzles from your own mistakes. |
| **Guide** | A game plan built from your own data: rating and form, your top priorities (blunders, clock, king safety, missed punishments, sacrifices, endgames, opening holes, a weaker colour, results after a loss), how your games are lost, time controls, your library and the openings you actually play, a move-by-move checklist tuned to your rating band, patterns chosen from your mistakes, and a weekly training plan weighted toward your priorities. It updates as you import, analyse and study. |

### Discoveries

1. **Caught automatically.** Every imported chess.com game, and every game you play on the **Play** tab as the only human side, is walked against your library. The first opponent move inside the first 12 moves that the library has no answer to is saved. Games that reach the same position with the same move are merged, so "they played 4...Bc5 against me 7 times" is one discovery with 7 games behind it. On the Play tab a chip under the board shows where you are in your library, and turns into "*1...h5 is new for you · saved to Discoveries*" the moment the solver leaves it.
2. **Analysed in the background.** A separate Stockfish worker takes the queue, most frequent first: the four best moves at depth 20 (up to 25 s), each of your replies that isn't among them at depth 18, and the engine's main line, evaluated move by move. Only one tab analyses at a time; the Coach tab shows a live badge with the number of positions ready to study. On the Play tab, analysis waits until the game is over so the solver keeps the CPU.
3. **Studied as a story** in five scenes:
   - *The moment*: the line replays on the board while a funnel shows how many of your games followed it to this point.
   - *Your answers*: one bar per move you played, with its win/draw/loss split and score; matching arrows on the board, thicker for more frequent moves.
   - *The engine's view*: a win-chance scale with the engine's best moves and your replies, each of yours labelled with its move class, and the best move drawn on the board.
   - *The idea*: the engine's main line plays out move by move with a win-chance sparkline. If your own move is within 5 points of the engine's, you can keep it instead.
   - *Practice*: play your answer, their reply and your follow-up from memory (hints available). Then the line is **added to your library**, and the next discovery is one click away.

Nothing is added to the library behind your back: only lines you have studied. A line added this way can be removed from the Library (its discovery reopens).

Data lives in `data/` (`data/users/<name>/<yyyy-mm>.json` for games, `data/store/*.json` for your added lines, discoveries, reviews and Insights), the same layout as Chess Coach, so an old Chess Coach `data` folder can be copied over. For a quick look at the whole flow, `coach.html?depth=8` lowers the analysis depth.

## Four-player chess

`four.html` (the **4-Player** tab) is four-player chess on the 14×14 cross-shaped board with Red, Blue, Yellow and Green, following the [chess.com rules](https://support.chess.com/en/articles/8614233-4-player-chess-4pc):

- **Free-for-all (FFA)**: everyone against everyone. Points for captures (pawn 1, knight 3, bishop 5, rook 5, queen 9; a promoted queen is worth 1), checkmate +20, stalemate +20 to the stalemated player (who is out), and forking two or three kings with one move (+1 / +5 with a queen, +5 / +20 otherwise). A checkmated player is eliminated and their pieces turn grey and dead (no longer move, attack or score). The game ends after three eliminations or on a draw (each remaining player +10); most points wins.
- **Teams 2v2**: Red + Yellow against Blue + Green (teammates sit opposite and cannot capture each other). The first checkmate wins; stalemate is a draw.
- **Starting position**: chess.com's Old Standard by default, with every king on a light square and facing the opposing queen: Red K h1 / Q g1, Yellow K g14 / Q h14, **Blue K a8 / Q a7, Green K n7 / Q n8**. An *Omatamix* setup (Blue and Green swap king and queen, their kings on dark squares) can be chosen instead. Castling follows the king: it moves two squares toward the rook and the rook hops over.
- Turn order Red → Blue → Yellow → Green. Pawns advance toward the opposite side and promote on the 8th rank (FFA) or the 11th (Teams), counted from your own back rank. In FFA the pawn becomes a queen automatically, as in chess.com's rated rule; in Teams you choose queen, rook, bishop or knight. An *FFA: choose the promotion piece* option gives FFA the same choice. A promoted piece is worth 1 point when captured. Castling is supported (king two squares toward either rook, the rook hops over); there is no en passant. Kings are never captured: you are checkmated when your turn comes and you cannot escape. Draws by threefold repetition, 50 rounds without a capture or pawn move, or insufficient material.
- **Seats**: each colour can be a Human or a Bot, so you can play alone against three bots, share one screen with friends, or watch four bots. Bot strength has four levels:

  | Level | Plays like |
  | --- | --- |
  | Beginner | random moves, usually grabbing a capture when there is one |
  | Casual | looks one move ahead; takes anything that looks good, blind to recaptures |
  | Club | alpha-beta search (about 3 plies plus captures), under a 0.9 s limit |
  | Strong | iterative deepening with a 2.8 s limit and little randomness |

  The bots search "paranoid": from a bot's seat everyone not on its side tries to minimise its evaluation, while its teammate cooperates. Stockfish and Maia-2 only understand two-player chess, so these bots are purpose-built and far weaker than Stockfish is at classic chess; they run in a Web Worker so the page never freezes.
- **Engine hints**, as in the classic game: the *Best moves* panel shows the top *n* moves (1–5) for whoever is to move, each with an evaluation, the principal variation (coloured by player), and what the line does to the material balance for that side ("Wins a queen", "Even trade", …). The best moves are drawn as numbered arrows; hover a card to see its whole line on the board, or click one to play it. Hints are on for human turns by default and can be switched on for bot turns. The "engine" is the same alpha-beta search the bots use (about 2.5 s a turn, depth 5–7 in the middlegame, assuming everyone not on your side plays against you), not Stockfish.
- The board can be viewed from any seat (**Rotate view**, or the *View from* setting); by default it turns to the human's seat when there is exactly one.

Keyboard: `R` rotate the view, `P` pause or resume the bots, `Space` plays one bot move while paused, `N` starts a new game.

The rules live in `public/js/four/rules.js` (pure logic, no DOM) and are covered by `test/four.rules.test.mjs` (checkmate, stalemate, forks, promotion ranks, castling, dead pieces, draws, turn skipping, and a random-playout fuzzer that checks invariants over thousands of moves).

## Project layout

```
public/
  index.html, css/app.css      UI
  js/main.js                   app state, rendering, controls
  js/board.js                  board: drag/click input, SVG arrows
  js/engine.js                 UCI wrapper around the Stockfish worker
  js/solver.js                 Maia-2 + Stockfish blend, per-Elo curves, material outcome
  js/maia.js                   Maia-2 in the browser (onnxruntime-web): board encoding, move index, Elo buckets
  js/book.js                   opening prior for the first 10 plies (Maia-2 never trained on them)
  four.html, js/four/          four-player chess: rules.js (engine), bot.js (+ bot-worker.js), main.js (UI)
  coach.html, css/coach.css    Coach
  js/coach/                    library.js (repertoire tree), games.js (chess.com games, stats, advice),
                               discoveries.js (catch, merge, deep analysis, study line), service.js (shared state,
                               background analyser, badge), analysis.js (engine queue, review, Insights),
                               animboard.js (animated board), story.js (study scenes), page.js / trainer.js /
                               review.js (screens), playlink.js (Play page chip and live catch)
  engine/                      Stockfish 19 lite single-threaded WASM (GPLv3)
  models/                      maia2-blitz.onnx (41 MB, fp16 weights), maia2-moves.json, opening-book.json
  vendor/ort/                  onnxruntime-web 1.27 (WASM, MIT)
  vendor/chess.js              chess.js 1.4.0 (BSD-2)
  pieces/                      cburnett SVG pieces (CC BY-SA 3.0, via lichess)
server.js / serve.py           zero-dependency servers: static files plus the Coach API (chess.com import, store)
start.bat / start.sh           launchers
tools/match.mjs                solver vs Maia-2 matches: strength calibration (Node)
tools/calibrate.mjs            self-play move-class calibration (Node)
tools/maia2/                   rebuild the ONNX model and test fixtures (Python, dev only)
tools/build_book.py            rebuild the opening book
test/                          node --test unit tests (npm test): solver, Maia-2 parity, four-player rules and bots,
                               coach library/games/discoveries, and both servers against a mock chess.com
```

## Licenses

Stockfish is GPLv3 (see `public/engine/COPYING-stockfish.txt`), so this project is also distributed under GPLv3. chess.js is BSD-2-Clause. The cburnett pieces are by Colin M.L. Burnett, CC BY-SA 3.0. Maia-2 (network code and the published blitz checkpoint) is MIT-licensed, from [CSSLab/maia2](https://github.com/CSSLab/maia2); the model file here is the official checkpoint exported to ONNX with fp16 weight storage. onnxruntime-web is MIT (Microsoft). The Coach's repertoire and guide come from the Chess Coach app. The opening book is derived from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) (CC0).
