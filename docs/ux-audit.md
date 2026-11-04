# UI / UX / naming audit

## What we found

| # | Area | Problem |
| --- | --- | --- |
| 1 | Name | "Stockfish Elo Terminal" describes one feature (the Elo solver) and an engine we don't own. "Coach" and "Chess Coach" are a second name for half the app. Users see three brands: Terminal, Coach, Four-Player Chess. |
| 2 | Navigation | Two navigation rows on the Coach page (Play / Coach / 4-Player, then six Coach sections) and a different header on each page. The 4-Player page renamed the brand. Six flat sections give no sense of what to do first. |
| 3 | Purpose | Every screen is a tool (import, review, drill, analyse). Nothing says "here is what to do today", so improvement depends on the user remembering to come back to each tool. |
| 4 | Retention of learning | Library drills mark a line "done" once and never bring it back, so lines are forgotten. Studied discoveries are not revisited. |
| 5 | Progress | No view of progress over time: rating, accuracy, lines learned, days practised. |
| 6 | Motion | The Coach has a motion system (rise, count-ups, glides, ink). Play and 4-Player have none; the header switch between pages is a hard cut. |
| 7 | Naming inside | "Guide" (static text, now a generated plan), "Insights" vs "Review" vs "Games" (three places for games), "Coach up to date" (internal state in the header). |
| 8 | Status | Background analysis status, engine status and account live in different places on each page. |

## What changes

1. **Name: Outpost.** In chess an outpost is a square that's protected, can't be chased away, and lets a piece work from a strong base. That's the product's promise: a base you improve from. The name is set in one place (`public/js/shell.js`).
2. **One header everywhere**, in the order of the improvement loop:
   **Today · Play · Study · Analyse · Plan · 4-Player**
   - *Today*: new home. Daily session, streak, progress.
   - *Play*: the Elo terminal (unchanged inside).
   - *Study*: Discoveries and Library (things you learn).
   - *Analyse*: Games, Review, Insights (things you look back on).
   - *Plan*: the generated guide.
   - *4-Player*: the variant, last.

   A second row of tabs appears only inside Study and Analyse. A sliding indicator and a shared page transition make every switch feel like one app.
3. **Today**: a short daily session built from the data. Study one discovery, drill the lines due today, review your latest game, play one game, and keep the week's focus from the Plan in view. Each step ticks off as it happens anywhere in the app. Today also shows a goal ring (3 activities a day), a streak, a 12-week activity calendar, and progress tiles (rating, review accuracy, lines learned, discoveries studied).
4. **Spaced repetition for the Library.** A clean drill pushes the line's next review out (1 → 3 → 7 → 16 → 35 → 75 days). A drill with mistakes brings it back tomorrow. New lines added from your games are due at once. Study → Library shows the due count with a *Drill due lines* button that goes through them one by one.
5. **Activity log** (`progress` store document): drills, studied discoveries, reviews, insight runs and games played on Play or chess.com count toward the day. The streak counts consecutive days with at least one activity.
6. **Consistent motion** on Play and 4-Player: the same entrance rise for cards, the same header indicator and the same reduced-motion handling.
7. **Wording.** Guide is renamed Plan. The header status says what is happening ("Analysing 4…Bc5 · depth 14/20", or "All positions analysed").

## Added since: improvement features

- **Puzzles from your own misses** (Study → Puzzles): every blunder you made ("find the better move") and every opponent blunder you didn't punish ("punish it"), taken from the background reviews. Combinations play out over two moves when the solution is forcing. A different move that the engine rates within 3 points also counts. Puzzles are scheduled with spaced repetition, and the queue starts with your current Plan priority (missed punishments, opening blunders, endgames…).
- **Progress in your positions** (Analyse → Progress): for each opponent surprise and each habit position that came up in at least two games, your score before and after you started working on it, the work done (studied, drills, puzzles), a rolling 5-game score with the "since you started" part shaded, and a status (improving, steady, slipping, too early to tell). Today links to it.
- **Explore in Review**: move any piece to try another move. Stockfish lines are drawn live. When it's the opponent's turn, their likely replies show as purple arrows, mixing Maia-2 at their rating with their own recent chess.com games ("opp89 played it 3 of 5").

## Still missing, or not done as well as it should be

Ordered by how much they'd help someone improve.

1. **Calibrated accuracy and move classes.** Our accuracy formula and class thresholds are close to Lichess's but not tuned against chess.com's. Checking against the games' own `accuracies` field and fitting the curve would make the numbers comparable to what users see on chess.com.
2. **Review depth.** Background reviews run at depth 12 for throughput. A second pass at depth 16 for recent and important games (losses, close games) would make "best move" claims more reliable, especially in sharp tactics.
3. **Opening explorer with real statistics.** The library is a fixed repertoire tree. Adding Lichess masters/club statistics per position (move popularity and results) would show which replies opponents actually play most and which lines score well at the user's level.
4. **Endgame and calculation training.** Puzzles only come from your own games, so endgame technique (basic positions such as Lucena, Philidor, opposition) and visualisation have no dedicated drills yet.
5. **Time management analysis.** Clock data from PGNs is parsed but only used for "blunders under a minute". Showing time spent per move, time trouble by phase, and correlating thinking time with move quality would target a very common weakness.
6. **Goals and milestones.** There is a streak and a daily goal, but no user-set target (e.g. "1500 rapid by March") with a projection, and no weekly summary ("this week: 14 drills, accuracy +3, rating +22").
7. **Opponent preparation.** Explore already reads an opponent's games. A "Prepare for an opponent" page (their openings by colour, where they deviate, their results) before a club or online match would build on the same data.
8. **Lichess import.** Only chess.com is supported; the Lichess API is just as open and a sizeable share of players use it.
9. **Mobile ergonomics.** Layouts work at phone width, but drag-and-drop on small boards, a bottom tab bar and installable PWA behaviour (offline, home screen) would make daily use on a phone much better.
10. **Accessibility.** Keyboard play on the board, screen-reader move announcements and a colour-blind-safe palette for move classes are not done yet.
11. **Data portability.** No export or backup button for the `data/` folder, and no way to sync between two computers.
12. **Notifications.** "3 lines due" and "new game reviewed" only show inside the app; a gentle optional browser notification once a day would support the daily habit.

## Product direction: journal and plan accountability

The import → engine review → training plan layer is crowded (Chess.com Insights, Aimchess, Chessy and others). The gap is the player's own reflection joined to engine data, and checking whether a plan actually moved a number. Done so far:

- **Journal card** per game with the critical moment and auto-suggested tags (clock, review, losing streak), so an entry takes seconds.
- **Tag statistics** that mix confirmed and detected tags, plus score after a loss/win from the games alone.
- **Plans** with one measured number, daily tasks and an honest verdict (minimum sample, change must beat the noise).

Next, in order: a weekly report (top 3 problems by tag with example positions), Lichess game import, merging the 13 sections around the loop (Today · Games+Journal · Train · Plan · Insights), and only then a hosted version with sync, which is what a paid tier needs (see the market analysis).
