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
