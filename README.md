# Stockfish Elo Terminal

A browser chess terminal built around an **Elo-weighted Stockfish solver**. Set the solver's strength anywhere from **0 to 3000 Elo**, let it or a human play each side, and watch it highlight its **n best moves**: how likely a player of that Elo is to choose each one, and how each line changes the material balance.

The design takes its cues from [aidachess.com](https://aidachess.com): a warm parchment/navy palette, terracotta accents, and Sora, Onest and JetBrains Mono type. Light and dark themes are both included.

## Run it (Windows, macOS, Linux; no Docker, no `npm install`)

Everything is bundled: the Stockfish 19 WASM engine, chess.js and the piece set. You only need **Node.js** *or* **Python 3**.

| OS | How |
| --- | --- |
| **Windows** | Double-click **`start.bat`** (uses Node if installed, otherwise Python) |
| macOS / Linux | `./start.sh` |
| Any | `node server.js` or `python serve.py` (optional port: `node server.js 9000`) |

Your browser opens at <http://localhost:8080>. The page has to be served over HTTP because browsers won't load the WASM engine from `file://`.

## Features

- **Per-side control:** White and Black can each be *Human* or *Solver*, so you can play human vs. solver, solver vs. solver, or move for both sides yourself with hints.
- **Per-side Elo (0–3000)**, with quick presets and a band label (Beginner, Club, Master, …).
- **n-best moves (1–8)** drawn as numbered arrows. Arrow thickness and opacity follow the probability that a player of the chosen Elo picks that move.
- **Material outcome per line:** each candidate's principal variation is played out to the *material horizon*. The panel then shows the net change (`+3`, `−1`, `±0`), a short description ("Wins a knight", "Even trade", "Mates in 2"), and the pieces won and lost. If the horizon would cut an exchange in half, it is extended until the captures stop.
- **Hover a line** to see its continuation as a numbered arrow sequence. **Click a line** to play it.
- **Solver moves are sampled** from the Elo-weighted distribution over all legal moves. The move list tags each one with the line it came from, and the tooltip shows its probability.
- **Parameters:** candidate pool (MultiPV, default: every legal move), search depth (auto from Elo, or fixed), max think time, randomness multiplier, material horizon, solver move delay, arrows and hints on/off, coordinates.
- Eval bar, captured pieces, move list with navigation, FEN load/copy, PGN export, flip, pause, promotion picker, drag-and-drop or click-to-move, and keyboard shortcuts.

### Keyboard

`←` / `→` step through moves · `Home` / `End` jump to the start / end · `Space` plays a solver move · `F` flips the board · `P` pauses / resumes · `N` starts a new game

## How the Elo model works

Stockfish's built-in `UCI_Elo` only goes down to about 1320. To cover 0–3000, the solver models a player as follows (`public/js/solver.js`):

1. **Every legal move is scored.** Stockfish searches with MultiPV covering the whole move list (strong levels use the top 10). Search depth grows with Elo: 1 ply at 0, about 10 at 2000, 18 at 3000.
2. **Each move's cost is its drop in winning chances** versus the best move, using the Lichess win-% curve. This is the same quantity that chess.com and Lichess accuracy are computed from.
3. **Moves are picked with a softmax over that loss.** The temperature is high at low Elo, where hanging a piece is a routine event, and falls towards zero near 3000. The *Randomness* slider multiplies it (0 = always the top move).
4. **The temperature curve is calibrated by self-play.** `tools/calibrate.mjs` plays solver-vs-solver games at each level, reviews every move at depth 12, and reports the average Lichess per-move accuracy:

| Elo | 0 | 500 | 1000 | 1500 | 2000 | 2500 | 3000 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Self-play move accuracy | ~52 (random play) | ~62 | ~72 | ~80 | ~87 | ~94 | ~97 |

These numbers are approximate: games at the low end vary a lot from run to run. chess.com's CAPS formula isn't public, so treat the mapping to chess.com ratings as rough. The solver panel also shows the **expected accuracy** of the move it is about to choose.

```bash
node tools/calibrate.mjs --elo 0,1000,2000 --games 12    # measure
node tools/calibrate.mjs --elo 1000 --tau 25             # try a temperature
```

## Project layout

```
public/
  index.html, css/app.css      UI
  js/main.js                   app state, rendering, controls
  js/board.js                  board: drag/click input, SVG arrows
  js/engine.js                 UCI wrapper around the Stockfish worker
  js/solver.js                 Elo model, sampling, material outcome
  engine/                      Stockfish 19 lite single-threaded WASM (GPLv3)
  vendor/chess.js              chess.js 1.4.0 (BSD-2)
  pieces/                      cburnett SVG pieces (CC BY-SA 3.0, via lichess)
server.js / serve.py           zero-dependency static servers
start.bat / start.sh           launchers
tools/calibrate.mjs            self-play accuracy calibration (Node)
test/                          node --test unit tests (npm test)
```

## Licenses

Stockfish is GPLv3 (see `public/engine/COPYING-stockfish.txt`), so this project is also distributed under GPLv3. chess.js is BSD-2-Clause. The cburnett pieces are by Colin M.L. Burnett, CC BY-SA 3.0.
