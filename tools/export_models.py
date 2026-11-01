# /// script
# requires-python = "==3.12.*"
# dependencies = [
#     "beat-this==1.1.0",
#     "torch==2.14.1",
#     "onnx==1.23.2",
#     "onnxruntime==1.31.0",
#     "numpy",
# ]
# ///
"""The two models the browser app runs, as ONNX files for its site build.

    uv run tools/export_models.py OUT_DIR

- beat-this (CPJKU, MIT): the "final0" checkpoint, exported without its log-mel front end (the app
  computes that itself, src/engine/listen/beats.ts), with fp16 weights cast back to fp32 at load,
  which halves the download and keeps the arithmetic fp32. Checked against PyTorch before it's written.
- basic-pitch (Spotify, Apache-2.0): its own nmp.onnx from its v0.3.0 release, checked by its hash.

The first run installs PyTorch and beat-this (a few GB) and downloads the checkpoint. The site build
downloads both files from the repository's "models" release (.github/workflows/pages.yml), so they
never enter the git history. To publish new ones:

    gh release upload models OUT_DIR/*.onnx --clobber

To use them while developing, make OUT_DIR public/models.
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from beat_this.inference import load_model
from onnx import TensorProto, helper, numpy_helper

BASIC_PITCH = ("https://raw.githubusercontent.com/spotify/basic-pitch/v0.3.0/"
               "basic_pitch/saved_models/icassp_2022/nmp.onnx")
BASIC_PITCH_SHA256 = "2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec"


class Logits(torch.nn.Module):
    """(batch, frames, 128 mel bands) -> beat and downbeat logits (batch, frames)."""

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, spect):
        out = self.model(spect)
        return out["beat"], out["downbeat"]


def fp16_weights(path):
    """Every large float initializer stored as fp16 plus a Cast back to fp32 (folded by ORT at load)."""
    m = onnx.load(str(path))
    g = m.graph
    inits, casts = [], []
    for init in g.initializer:
        if init.data_type == TensorProto.FLOAT and np.prod(init.dims) >= 64:
            h = numpy_helper.from_array(numpy_helper.to_array(init).astype(np.float16), init.name + "_fp16")
            inits.append(h)
            casts.append(helper.make_node("Cast", [h.name], [init.name], to=TensorProto.FLOAT, name=init.name + "_cast"))
        else:
            inits.append(init)
    del g.initializer[:]
    g.initializer.extend(inits)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(casts + nodes)
    onnx.save(m, str(path))


def beat_this(out):
    model = Logits(load_model("final0", "cpu")).eval()
    x = torch.rand(1, 1500, 128) * 4
    path = out / "beat_this-final0-fp16w.onnx"
    with torch.inference_mode():
        torch.onnx.export(model, (x,), str(path), dynamo=False, opset_version=17, input_names=["spect"],
                          output_names=["beat", "downbeat"],
                          dynamic_axes={"spect": {0: "B", 1: "T"}, "beat": {0: "B", 1: "T"}, "downbeat": {0: "B", 1: "T"}})
    fp16_weights(path)
    onnx.checker.check_model(str(path))
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    with torch.inference_mode():
        ref, _ = model(x)
    got, _ = sess.run(None, {"spect": x.numpy()})
    err = float(np.abs(got - ref.numpy()).max())
    # fp16 weights move the logits a little; the beat positions don't change (spikes, Oct 2026)
    assert err < 0.5, f"beat-this export differs from PyTorch by {err}"
    print(f"{path.name}: {path.stat().st_size / 1e6:.0f} MB, max logit difference {err:.3f}")


def basic_pitch(out):
    with urllib.request.urlopen(BASIC_PITCH) as r:
        data = r.read()
    if hashlib.sha256(data).hexdigest() != BASIC_PITCH_SHA256:
        sys.exit(f"{BASIC_PITCH} isn't the model the app was checked with")
    (out / "basic_pitch-nmp.onnx").write_bytes(data)
    print(f"basic_pitch-nmp.onnx: {len(data) / 1e3:.0f} kB")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    beat_this(out)
    basic_pitch(out)


if __name__ == "__main__":
    main()
