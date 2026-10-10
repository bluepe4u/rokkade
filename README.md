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
- **Solver moves are sampled** from the Elo-weighted distribution. The move list tags each one with the line it came from, and the tooltip shows its probability.
- **Parameters:** candidate pool (MultiPV), search depth (auto from Elo, or fixed), max think time, randomness multiplier, material horizon, solver move delay, arrows and hints on/off, coordinates.
- Eval bar, captured pieces, move list with navigation, FEN load/copy, PGN export, flip, pause, promotion picker, drag-and-drop or click-to-move, and keyboard shortcuts.

### Keyboard

`←` / `→` step through moves · `Home` / `End` jump to the start / end · `Space` plays a solver move · `F` flips the board · `P` pauses / resumes · `N` starts a new game

## How the Elo model works

Stockfish's built-in `UCI_Elo` only goes down to about 1320. To cover 0–3000, the solver models a player as follows (`public/js/solver.js`):

1. **Search depth** rises with Elo, from 1 ply at 0 to 18 plies at 3000 (`1 + 17·(elo/3000)^1.3`), unless you set a fixed depth.
2. Stockfish returns the top *k* moves (MultiPV). Each move's **centipawn loss** against the best move is turned into a probability with a **softmax**. The temperature is `400·e^(−elo/600)` cp: about 400 at 0, 76 at 1000, 14 at 2000 and 3 at 3000.
3. A **blunder rate** of `0.25·e^(−elo/500)` (25% at 0, about 3% at 1000, about 0.5% at 2000) is spread evenly over *all* legal moves. That is why weak players sometimes play moves the engine never listed.
4. The **Randomness** slider scales both the temperature and the blunder rate (0 = always play the top move).

Mate scores rank above any centipawn score, so a forced mate gets almost all of the probability at any reasonable Elo.

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
test/                          node --test unit tests (npm test)
```

## Licenses

Stockfish is GPLv3 (see `public/engine/COPYING-stockfish.txt`), so this project is also distributed under GPLv3. chess.js is BSD-2-Clause. The cburnett pieces are by Colin M.L. Burnett, CC BY-SA 3.0.
