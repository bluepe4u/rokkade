# Rebuilding the Maia-2 assets

End users never need this: `public/models/` already contains the files. Run it only to regenerate them
(for example to switch from the blitz to the rapid model).

```bash
python -m venv .venv && . .venv/bin/activate          # any throw-away environment
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install onnx onnxruntime safetensors einops chess numpy

# official blitz checkpoint, converted to safetensors (MIT, bit-identical tensors; hash in provenance.json)
curl -L -o model.safetensors https://huggingface.co/shermansiu/maia2-blitz/resolve/main/model.safetensors

python tools/maia2/build_model.py     --safetensors model.safetensors --out public/models
python tools/maia2/make_fixtures.py   --safetensors model.safetensors --out test/fixtures/maia2-reference.json
python tools/build_book.py a.tsv b.tsv c.tsv d.tsv e.tsv --out public/models/opening-book.json   # lichess-org/chess-openings
npm test
```

What the build does:

| Step | Detail |
| --- | --- |
| `maia2_model.py` | The network classes, copied verbatim from [CSSLab/maia2](https://github.com/CSSLab/maia2) (MIT). |
| `build_model.py` | Loads the checkpoint (`strict=True`), writes `maia2-moves.json` (the 1880-move policy index, whose order matters), exports ONNX without the training-only side-info head, stores the large weights as fp16 with a `Cast` back to fp32 (file size 83 MB → 41 MB; top move unchanged in 100% of 600 test positions, mean probability error 0.0004), and checks parity against PyTorch. |
| `make_fixtures.py` | Runs the PyTorch model through the *official* preprocessing and records move probabilities for 12 hand-picked positions (both colours, castling, en passant, promotions, mate, check) at three Elo pairs. `test/maia.test.mjs` checks the JavaScript encoder + ONNX model against them (max error about 6e-4). |

int8 quantisation was tried and rejected: it changed the top move in 5-19% of positions, which defeats the purpose of a
calibrated human-move model.
