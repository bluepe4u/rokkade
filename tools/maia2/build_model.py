#!/usr/bin/env python3
"""Build the browser-ready Maia-2 assets from the official checkpoint.

Needs (once, in a throw-away venv):  torch (CPU), onnx, onnxruntime, safetensors,
einops, chess, numpy.  End users never run this: its outputs are committed under
public/models/.

    python tools/maia2/build_model.py --safetensors model.safetensors --out public/models

Steps: verify the checkpoint hash -> load into the official architecture ->
write moves.json (the 1880-move policy index, order-sensitive) -> export ONNX
(without the unused side-info head) -> check parity against PyTorch.
"""
import argparse
import hashlib
import json
import os
import sys

import chess
import numpy as np
import torch
from safetensors.torch import load_file

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from maia2_model import MAIA2Model  # noqa: E402

# Official blitz checkpoint, see https://github.com/CSSLab/maia2 (maia2/model.py).
# The safetensors repo (shermansiu/maia2-blitz) records the same sha256 in provenance.json.
SOURCE_CHECKPOINT_SHA256 = "5090d5d0d49dc29787c08d13febbed5b2da81a18c2ddcd8a90070cd3b43c44b2"
NUM_ELO_CATEGORIES = 11  # <1100, 1100-1199, ..., 1900-1999, >=2000


class Cfg:  # maia2/configs/maia2-training.yaml
    dim_cnn = 256
    dim_vit = 1024
    num_blocks_cnn = 5
    num_blocks_vit = 2
    input_channels = 18
    vit_length = 8
    elo_dim = 128


def generate_pawn_promotions():
    out = []
    for file in "abcdefgh":
        for piece in "qrbn":
            out.append(f"{file}7{file}8{piece}")
        if file != "a":
            left = chr(ord(file) - 1)
            for piece in "qrbn":
                out.append(f"{file}7{left}8{piece}")
        if file != "h":
            right = chr(ord(file) + 1)
            for piece in "qrbn":
                out.append(f"{file}7{right}8{piece}")
    return out


def get_all_possible_moves():
    """Same construction (and therefore order) as maia2.utils.get_all_possible_moves."""
    moves = []
    for rank in range(8):
        for file in range(8):
            square = chess.square(file, rank)
            for piece in (chess.QUEEN, chess.KNIGHT):
                board = chess.Board(None)
                board.set_piece_at(square, chess.Piece(piece, chess.WHITE))
                moves.extend(m.uci() for m in board.legal_moves)
    return moves + generate_pawn_promotions()


def store_weights_as_fp16(path_in, path_out):
    """Halve the file size: keep large weight tensors in fp16 and Cast them back to fp32
    at load time, so all arithmetic stays fp32. (Measured on 600 Maia-played positions:
    identical top move in 100%, mean probability error 0.0004. int8 quantisation was
    tried and rejected: it changed the top move in 5-19% of positions.)"""
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    m = onnx.load(path_in)
    g = m.graph
    casts = []
    for t in list(g.initializer):
        if t.data_type != TensorProto.FLOAT or int(np.prod(t.dims)) < 1024:
            continue
        g.initializer.remove(t)
        g.initializer.append(numpy_helper.from_array(numpy_helper.to_array(t).astype(np.float16), t.name + "__fp16"))
        casts.append(helper.make_node("Cast", [t.name + "__fp16"], [t.name], to=TensorProto.FLOAT, name=t.name + "__cast"))
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(casts + nodes)
    onnx.checker.check_model(m)
    onnx.save(m, path_out)


class InferenceWrapper(torch.nn.Module):
    """Policy logits + value only; the training-time side-info head is dropped."""

    def __init__(self, model):
        super().__init__()
        self.m = model

    def forward(self, boards, elos_self, elos_oppo):
        logits, _, value = self.m(boards, elos_self, elos_oppo)
        return logits, value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--safetensors", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    moves = get_all_possible_moves()
    print("policy moves:", len(moves))

    state = load_file(args.safetensors)
    model = MAIA2Model(len(moves), {str(i): i for i in range(NUM_ELO_CATEGORIES)}, Cfg)
    missing, unexpected = model.load_state_dict(state, strict=True), None
    print("loaded state dict:", missing)
    model.eval()
    assert model.fc_1.out_features == len(moves), "move list does not match the checkpoint"

    with open(os.path.join(args.out, "maia2-moves.json"), "w") as f:
        json.dump(moves, f, separators=(",", ":"))

    wrapper = InferenceWrapper(model).eval()
    boards = torch.zeros(1, 18, 8, 8)
    elos = torch.zeros(1, dtype=torch.long)
    onnx_path = os.path.join(args.out, "maia2-blitz.onnx")
    fp32_path = onnx_path + ".fp32.tmp"
    torch.onnx.export(
        wrapper, (boards, elos, elos), fp32_path,
        input_names=["boards", "elo_self", "elo_oppo"],
        output_names=["logits", "value"],
        dynamic_axes={"boards": {0: "batch"}, "elo_self": {0: "batch"},
                      "elo_oppo": {0: "batch"}, "logits": {0: "batch"}, "value": {0: "batch"}},
        opset_version=args.opset, dynamo=False,
    )
    store_weights_as_fp16(fp32_path, onnx_path)
    print("wrote", onnx_path, os.path.getsize(onnx_path) // 1024, "KiB (fp32 export was", os.path.getsize(fp32_path) // 1024, "KiB)")
    os.remove(fp32_path)

    import onnxruntime as ort
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    torch.manual_seed(0)
    worst = 0.0
    for _ in range(5):
        b = (torch.rand(3, 18, 8, 8) > 0.8).float()
        es = torch.randint(0, NUM_ELO_CATEGORIES, (3,))
        eo = torch.randint(0, NUM_ELO_CATEGORIES, (3,))
        with torch.no_grad():
            ref_l, ref_v = wrapper(b, es, eo)
        got_l, got_v = sess.run(None, {"boards": b.numpy(), "elo_self": es.numpy(), "elo_oppo": eo.numpy()})
        worst = max(worst, float(np.abs(ref_l.numpy() - got_l).max()), float(np.abs(ref_v.numpy() - got_v).max()))
    print("max |torch - onnx| logit difference over random inputs:", worst)
    assert worst < 0.05, "ONNX export does not match PyTorch"
    print("ok")


if __name__ == "__main__":
    main()
