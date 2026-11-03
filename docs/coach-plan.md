# Coach integration plan

The Chess Coach (repertoire trainer, chess.com game import, game review, engine insights, guide) is merged
into the Stockfish Elo Terminal as one product. The terminal stays the main app; the coach becomes its
**Coach** space. The headline new feature is **Discoveries**: every time an opponent answers your opening
with a move your library doesn't cover, the app catches it, analyses it deeply in the background, turns it
into a short animated lesson ("how you answered vs how the engine sees it"), and, once you have studied it,
adds the line to your library.

## 1. Principles

- **One product, one look.** Same header, tokens, type (Sora / Onest / JetBrains Mono), board, pieces,
  arrows and engine on every page. The coach's old visual language is replaced, its logic is kept.
- **Calm by default, rich on demand.** Lists are quiet; the depth (charts, engine lines, animations) lives
  inside a Discovery's story, opened deliberately.
- **Motion explains, never decorates.** Every animation answers a question: where did the position come from
  (pieces glide through the line), how often (bars grow), how good (eval needle moves), what's the idea
  (engine line plays out). Springy ease-out curves, 200–600 ms, staggered by 40–80 ms. Everything respects
  `prefers-reduced-motion` (instant states, no glides).
- **Nothing is added behind your back.** The old coach silently appended engine lines to the repertoire.
  Now a line is added only after you study it, and you choose the move (engine's, or your own when it holds).
- **Local-first.** Data stays in the app's `data/` folder (same layout as Chess Coach, so an existing coach
  `data/` folder can be copied over and keeps working).

## 2. Information architecture

```
Header (every page):  [♞ STOCKFISH ELO TERMINAL]   ( Play | Coach • 3 | 4-Player )   ● engine status  ☾
```

- **Play**: the existing terminal (index.html). New: an *opening chip* under the board (“In your library ·
  Italian Game, Two Knights”) and *live catch* (when the opponent leaves your library: “3…Bc5 is new for you —
  saved to Discoveries”).
- **Coach** (coach.html), a second-level segmented control:

| Section | Was (coach) | Contents |
| --- | --- | --- |
| **Discoveries** *(new, default when anything is waiting)* | — | Inbox of caught positions; each opens a story |
| **Library** | Trainer | Repertoire tree, explore & drill; lines added from discoveries marked *New* |
| **Games** | My games | chess.com import, stats, recommendations, repertoire fit, habits |
| **Review** | Review | Per-game review with move classes and eval graph |
| **Insights** | Engine | Batch engine analysis: blunders, missed punishments, sacrifices |
| **Guide** | Guide | Game plan, patterns, training |

- The **Coach tab carries a badge** with the number of discoveries ready to study. It updates live across
  pages and tabs (storage events).

## 3. Discoveries

### 3.1 What counts
A *discovery* is a position from one of your games where **the opponent played a move your library has no
answer to**, inside the first 12 moves (24 plies). Sources: imported chess.com games, and games you play in
the terminal. Positions are merged across games (same library node + same opponent move), so “they played
4…Bc5 against me 7 times” is one discovery with 7 games behind it.

Each discovery holds:
- the line up to the opponent's move, the resulting position, side (White/Black library), opening name;
- every game behind it: date, opponent and rating, time control, result, **your reply**;
- your replies grouped: count, wins/draws/losses, score, expected score from ratings;
- the engine verdict (background): top 4 moves with evaluations and lines, the evaluation of each of your
  replies, the win-chance each reply gives up, and a move class (best … blunder);
- status: `new` → `analysing` → `ready` → `studied` (or `dismissed`).

### 3.2 Pipeline
1. **Catch.** After every games sync (and at start-up) the games are walked against the library; new or
   grown discoveries are written to the store. In Play, the game in progress is walked after each move.
2. **Analyse in the background.** A dedicated Stockfish worker takes the queue, most frequent first:
   MultiPV 4 at depth 20 (time-capped), then each of your replies that isn't in the top 4 at depth 18.
   Progress is shown on the card (ring + depth). Only one tab analyses at a time (a localStorage lease).
3. **Study.** The story (below). Finishing it **adds the line to your library** (your chosen move plus the
   engine's next moves) in the chapter it belongs to (or *Other lines from your games*), shows it on the Library's
   *Added from your games* shelf, and marks the discovery studied.

### 3.3 Inbox (Discoveries section)
```
 Discoveries                                              [White ▾] [Black ▾] [All | To study | Studied]
 ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
 │  3 new positions from your games                                        [ Start studying → ]   │
 │  Caught from 41 games since 1 Oct · analysed in the background                                  │
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌──────────┬──────────────────────┐  ┌──────────┬──────────────────────┐  ┌──────────┬──────────
 │  [board] │ ITALIAN · TWO KNIGHTS│  │  [board] │ SICILIAN · ALAPIN     │  │  [board] │ …
 │          │ 4…Bc5                │  │          │ 2…d5                  │  │          │
 │          │ 7 games · you 43%    │  │          │ 3 games · you 67%     │  │          │
 │          │ usually 5.Nxe5  ◔ 64%│  │          │ Ready to study  ●     │  │          │
 └──────────┴──────────────────────┘  └──────────┴──────────────────────┘  └──────────┴──────────
```
Cards are sorted by impact (games × score shortfall), enter with a staggered rise, and the analysis ring fills
in place.

### 3.4 The story (full-screen, five scenes)
Board on the left (animated), narrative on the right, progress pills at the bottom, ← → keys, Esc closes.

1. **The moment.** The board replays your library line from move 1 (pieces glide, ~220 ms per move), then
   the opponent's move lands with a soft pulse ring. Eyebrow: opening name. Title: “They played 4…Bc5.”
   Counters count up: *games*, *your score*, *since*. Line: “This position isn't in your library yet.”
2. **Your answers.** One bar per reply you played, growing from zero; each bar is a stacked win/draw/loss
   strip with the score at the end. Matching arrows appear on the board, thickness by frequency.
   Hovering a bar lights its arrow.
3. **The engine's view.** A horizontal win-chance scale (0–100%). The engine's top moves and each of your
   replies slide onto it as labelled dots; your replies carry their move-class chip (Best, Inaccuracy, …).
   The best-move arrow draws itself on the board; the eval figure counts to its value; “depth 20 · 4 lines”.
4. **The idea.** The engine's main line plays out on the board, move by move, with a caption per move and an
   eval sparkline drawing alongside. Then a side-by-side: *your usual reply* (games, score, eval) vs
   *the engine's move*. If your own move is within 5 points of win chance, a **Keep my move** choice appears.
5. **Practice.** “Your move.” You play the chosen answer on the board, the opponent's reply follows, and you
   play the next engine move (two of your moves). Wrong moves shake softly and you can ask for a hint.
   Success: the position card shrinks and flies to the Library, “Added to your library”.

### 3.5 Motion system
| Token | Value | Used for |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(.16, 1, .3, 1)` | entrances, glides, bars |
| `--ease-spring` | `cubic-bezier(.34, 1.56, .64, 1)` | chips, success pop |
| glide | 220–320 ms per move | board replays (FLIP translate of piece images) |
| arrow draw | 450 ms stroke-dashoffset | engine and reply arrows |
| bar grow | 600 ms, 70 ms stagger | answer bars, scale dots |
| count-up | 700 ms ease-out | big numbers |
| scene change | 380 ms fade + 16 px rise | story scenes |

## 4. Play integration
- The human's side(s) are matched against the library for that colour. While in book: a chip shows the line's
  name. On the first opponent move outside the library: a toast, the chip turns to “New for you”, and the
  position is caught as a discovery (source *terminal*), analysed in the background like any other.
- The badge on the Coach tab updates immediately.
- While a game is in progress the background analyser is paused (the solver needs the CPU); it resumes when the
  game ends, or in any open Coach tab.

## 5. Data and compatibility
| Store document (`data/store/*.json`) | Content |
| --- | --- |
| `custom` | lines you added (same format as Chess Coach: `{side, san, title, plan, …}`) |
| `discoveries` | all discoveries, keyed by id |
| `an-<user>`, `rv-…`, `rvidx-<user>` | Insights and Review results (unchanged) |

Games cache: `data/users/<user>/<yyyy-mm>.json` (unchanged). Copying an old `chess-coach/data` folder into
this app keeps games, added lines and reviews.

## 6. Server
`server.js` (Node) and `serve.py` (Python fallback) both serve `public/` and the coach API:
`/api/archives`, `/api/month`, `/api/games`, `/api/store` (GET/POST). Localhost only, Host-header and Origin
checks (as in Chess Coach), chess.com rate-limit retries. `CHESSCOM_API_BASE` lets tests point at a mock.

## 7. Engine budgets
- Interactive (Library, Review retry): depth 14.
- Discoveries (background): MultiPV 4, depth 20, ≤ 25 s per position; replies outside the top 4: depth 18, ≤ 12 s.
- Insights batch: depth 8–12 as before.
All share `public/engine/stockfish-19-lite-single.*` (identical to the coach's copy).

## 8. Testing
- Unit: library walk and discovery detection on synthetic games; aggregation of replies and results; line
  building from engine output; store merging.
- Server: both servers against a mock chess.com (archives, month, games, store, security checks).
- Browser (Playwright): import from the mock, discoveries appear, background analysis completes (fast depth in
  test mode), story scenes advance, practice adds the line to the Library; Play shows the opening chip and
  catches a deviation. Screenshots in light and dark, desktop and phone.

## 9. Build order
1. Server API in both servers + tests.
2. Core modules: library, games, store, engine adapter.
3. Discoveries: detection, background analysis, persistence, badge.
4. Coach page: Library, Games, Review, Insights, Guide in the new design.
5. Story with animations, practice, auto-add.
6. Play integration, E2E, README.
