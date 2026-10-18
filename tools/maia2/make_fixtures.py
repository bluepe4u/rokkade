#!/usr/bin/env python3
"""Reference outputs for testing the JS Maia-2 port.

Runs the PyTorch model through the *official* preprocessing path (board_to_tensor,
mirror for Black, map_to_category; copied from maia2/utils.py, MIT) and records
the resulting move probabilities. test/maia.test.mjs replays the same positions
through the JS encoder + ONNX model and compares.

    python tools/maia2/make_fixtures.py --safetensors model.safetensors \
        --out test/fixtures/maia2-reference.json [--big big.json --n 400]
"""
import argparse
import json
import os
import random
import sys

import chess
import torch
from safetensors.torch import load_file

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_model import Cfg, NUM_ELO_CATEGORIES, get_all_possible_moves  # noqa: E402
from maia2_model import MAIA2Model  # noqa: E402


# ---- copied from maia2/utils.py (MIT) --------------------------------------
def board_to_tensor(board):
    piece_types = [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN, chess.KING]
    tensor = torch.zeros((18, 8, 8), dtype=torch.float32)
    piece_indices = {piece: i for i, piece in enumerate(piece_types)}
    for piece_type in piece_types:
        for color in [True, False]:
            index = piece_indices[piece_type] + (0 if color else 6)
            for square in board.pieces(piece_type, color):
                row, col = divmod(square, 8)
                tensor[index, row, col] = 1.0
    if board.turn == chess.WHITE:
        tensor[12, :, :] = 1.0
    castling_rights = [
        board.has_kingside_castling_rights(chess.WHITE),
        board.has_queenside_castling_rights(chess.WHITE),
        board.has_kingside_castling_rights(chess.BLACK),
        board.has_queenside_castling_rights(chess.BLACK),
    ]
    for i, has_right in enumerate(castling_rights):
        if has_right:
            tensor[13 + i, :, :] = 1.0
    if board.ep_square is not None:
        row, col = divmod(board.ep_square, 8)
        tensor[17, row, col] = 1.0
    return tensor


def map_to_category(elo):
    if elo < 1100:
        return 0
    if elo >= 2000:
        return NUM_ELO_CATEGORIES - 1
    return 1 + (elo - 1100) // 100


def mirror_square(sq):
    return sq[0] + str(9 - int(sq[1]))


def mirror_move(uci):
    return mirror_square(uci[:2]) + mirror_square(uci[2:4]) + uci[4:]
# ---------------------------------------------------------------------------


class Reference:
    def __init__(self, safetensors_path):
        self.moves = get_all_possible_moves()
        self.index = {m: i for i, m in enumerate(self.moves)}
        self.model = MAIA2Model(len(self.moves), {str(i): i for i in range(NUM_ELO_CATEGORIES)}, Cfg)
        self.model.load_state_dict(load_file(safetensors_path), strict=True)
        self.model.eval()

    @torch.no_grad()
    def predict(self, fen, elo_self, elo_oppo):
        black = fen.split(" ")[1] == "b"
        board = chess.Board(fen).mirror() if black else chess.Board(fen)
        legal = [self.index[m.uci()] for m in board.legal_moves]
        logits, _, value = self.model(
            board_to_tensor(board).unsqueeze(0),
            torch.tensor([map_to_category(elo_self)]),
            torch.tensor([map_to_category(elo_oppo)]),
        )
        probs = torch.softmax(logits[0][legal], dim=-1).tolist()
        out = {}
        for i, p in zip(legal, probs):
            uci = self.moves[i]
            out[mirror_move(uci) if black else uci] = p
        # value head: win chance for the side to move (the model sees it as white)
        return out, float((value / 2 + 0.5).clamp(0, 1))


HANDPICKED = [
    ("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "start, white"),
    ("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", "1.e4, black to move (mirrored)"),
    ("r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R w KQkq - 4 9", "both sides may castle either way"),
    ("r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R b Kq - 4 9", "mixed castling rights, black"),
    ("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3", "en passant available (white)"),
    ("rnbqkbnr/pppp1ppp/8/8/3Pp3/5N2/PPP1PPPP/RNBQKB1R b KQkq d3 0 3", "en passant available (black)"),
    ("4k3/P7/8/8/8/8/p7/4K3 w - - 0 1", "white can promote"),
    ("4k3/P7/8/8/8/8/p7/4K3 b - - 0 1", "black can promote"),
    ("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", "mate in one (Qxf7#)"),
    ("rnbqkbnr/ppppp1pp/8/5p1Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2", "black in check, single legal reply"),
    ("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", "rook endgame"),
    ("r2q1rk1/ppp2ppp/2n1bn2/3pp3/1bP5/2NP1NP1/PP2PPBP/R1BQ1RK1 b - - 0 8", "middlegame, black"),
]


def maia_selfplay_positions(ref, n_games, seed):
    rng = random.Random(seed)
    fens = []
    for _ in range(n_games):
        board = chess.Board()
        elo = [rng.choice([900, 1300, 1700, 2100]), rng.choice([900, 1300, 1700, 2100])]
        for ply in range(rng.randint(14, 90)):
            if board.is_game_over():
                break
            side = ply % 2
            probs, _ = ref.predict(board.fen(), elo[side], elo[1 - side])
            if ply >= 10 and rng.random() < 0.35:
                fens.append((board.fen(), elo[side], elo[1 - side]))
            moves, ws = zip(*probs.items())
            board.push_uci(rng.choices(moves, ws)[0])
    return fens


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--safetensors", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--big", help="also write a large evaluation set here (not committed)")
    ap.add_argument("--n", type=int, default=400, help="games for the large set")
    args = ap.parse_args()
    ref = Reference(args.safetensors)

    cases = []
    for fen, note in HANDPICKED:
        for es, eo in [(1000, 1000), (1500, 1700), (2200, 1500)]:
            probs, value = ref.predict(fen, es, eo)
            cases.append({"fen": fen, "note": note, "elo_self": es, "elo_oppo": eo, "value": value,
                          "probs": {m: round(p, 6) for m, p in probs.items()}})
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(cases, f, separators=(",", ":"))
    print("wrote", args.out, len(cases), "cases")

    if args.big:
        data = []
        for fen, es, eo in maia_selfplay_positions(ref, args.n, seed=7):
            probs, value = ref.predict(fen, es, eo)
            data.append({"fen": fen, "elo_self": es, "elo_oppo": eo, "value": value, "probs": probs})
        with open(args.big, "w") as f:
            json.dump(data, f)
        print("wrote", args.big, len(data), "positions")


if __name__ == "__main__":
    main()
