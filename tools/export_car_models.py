# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "tesla-model-extractor @ git+https://github.com/koenhendriks/tesla-model-extractor@v0.4.2",
# ]
# ///
"""Tesla's own car models from the Tesla app, for the 3D preview (src/viewer/car/appBody.ts).

    uv run tools/export_car_models.py ~/Downloads/Tesla_4.61.6-4647.apkm OUT_DIR

The Tesla Android app carries Tesla's 3D models of every car, with Tesla's own animations for the
frunk, liftgate, doors, windows, mirrors and charge port. tesla-model-extractor (MIT,
github.com/koenhendriks/tesla-model-extractor) turns an app bundle you have (.apkm, .apks, .xapk or
.apk) into GLB files. This runs it for every light-show car (MODELS) and writes the nine .glb files and
the app's paint table (paints.json, the same for every car) side by side into OUT_DIR, as the site
serves them from models/tesla-app/. The first run takes a few minutes (the extractor unpacks the app).

The models are Tesla's: they never enter the git history. The site build downloads them from the
repository's "car-models" release (.github/workflows/pages.yml). To publish new ones:

    gh release upload car-models OUT_DIR/* --clobber

To use them while developing, make OUT_DIR public/models/tesla-app.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

MODELS = {
    "s_palladium": "S_Palladium.glb",       # Model S 2021+
    "model3_high": "3_High.glb",            # Model 3 2017-23
    "poppyseed": "Poppyseed.glb",           # Model 3 2024+
    "x_palladium": "X_Palladium.glb",       # Model X 2021+
    "y_high": "Y_High.glb",                 # Model Y 2020-24
    "bayberry": "Bayberry.glb",             # Model Y 2025+ Premium / Performance
    "bayberry_e41": "BayberryE41.glb",      # Model Y 2025+ Standard
    "bayberry_e80": "BayberryE80.glb",      # Model Y L
    "cybertruck": "Cybertruck.glb",
}
PAINTS = "paints.json"


def extractor():
    """The extractor's command, as uv installed it next to this script's Python."""
    cli = os.environ.get("TESLA_MODEL_EXTRACT") or shutil.which("tesla-model-extract",
                                                                path=str(Path(sys.executable).parent))
    if not cli:
        sys.exit("tesla-model-extract isn't installed: run this with uv run (see the top of this file)")
    return cli


def gdre_args():
    """The extractor's macOS download of GDRE Tools unpacks as "Godot RE Tools.app" without its
    executable bit (extractor 2026-10); point it at the binary and make it runnable."""
    if sys.platform != "darwin":
        return []
    cache = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "tesla-model-extractor" / "gdre"
    found = sorted(cache.glob("v*/Godot RE Tools.app/Contents/MacOS/Godot RE Tools"))
    if not found:
        return []
    found[-1].chmod(0o755)
    return ["--gdre", str(found[-1])]


def main(bundle, out):
    bundle = Path(bundle).expanduser().resolve()
    if not bundle.exists():
        sys.exit(f"{bundle} not found")
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    cli = extractor()
    with tempfile.TemporaryDirectory() as tmp:
        cmd = [cli, "unreal", *gdre_args(), "--models", ",".join(MODELS), "--variant", "plate_us", "--yes",
               "-o", tmp, str(bundle)]
        print("extracting the car models (a few minutes the first time)...")
        r = subprocess.run(cmd)
        if r.returncode and not gdre_args():           # the first run downloads GDRE Tools; retry with it
            r = subprocess.run([cmd[0], "unreal", *gdre_args(), *cmd[2:]])
        if r.returncode:
            sys.exit("tesla-model-extract failed (see above)")
        for model, glb in MODELS.items():
            src = Path(tmp) / model / glb
            if not src.exists():
                print(f"  {model}: not in this app bundle")
                continue
            shutil.copyfile(src, out / glb)
            if (src.parent / PAINTS).exists():
                shutil.copyfile(src.parent / PAINTS, out / PAINTS)
            print(f"  {glb}: {src.stat().st_size / 1e6:.0f} MB")
    print(f"done: {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
