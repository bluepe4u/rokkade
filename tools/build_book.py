#!/usr/bin/env python3
"""Build public/models/opening-book.json from the Lichess opening names database.

Why: Maia-2 never saw the first 10 plies of any game in training, so its opening
predictions are unreliable (after 1.e4 e5 it ranks 2.Qh5 above 2.Nf3). For those
plies the solver instead uses "how much named opening theory continues with this
move" as a stand-in for how popular the move is.

Data: https://github.com/lichess-org/chess-openings (a.tsv ... e.tsv), CC0.
    python tools/build_book.py a.tsv b.tsv c.tsv d.tsv e.tsv --out public/models/opening-book.json
Needs python-chess.
"""
import argparse
import csv
import io
import json
import math

import chess
import chess.pgn

MAX_PLY = 10  # positions before this ply (0-based) are covered; Maia-2 takes over afterwards


def key(board):
    return " ".join(board.fen(en_passant="legal").split(" ")[:4])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tsv", nargs="+")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    counts = {}
    lines = 0
    for path in args.tsv:
        with open(path, newline="") as f:
            for row in csv.DictReader(f, delimiter="\t"):
                game = chess.pgn.read_game(io.StringIO(row["pgn"]))
                board = game.board()
                lines += 1
                for ply, move in enumerate(game.mainline_moves()):
                    if ply >= MAX_PLY:
                        break
                    k = key(board)
                    counts.setdefault(k, {}).setdefault(move.uci(), 0)
                    counts[k][move.uci()] += 1
                    board.push(move)

    # Named-line counts overweight huge families (Sicilian, Ruy Lopez); a square root keeps
    # the ordering but flattens the spread, then round to one decimal to keep the file small.
    book = {k: {m: round(math.sqrt(c), 1) for m, c in v.items()} for k, v in counts.items()}
    with open(args.out, "w") as f:
        json.dump(book, f, separators=(",", ":"), sort_keys=True)
    print(f"{lines} named lines -> {len(book)} positions")


if __name__ == "__main__":
    main()
