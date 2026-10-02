"""Run the pipeline on the sample mission and write the result into frontend/public/sample/.
The frontend uses this cached copy when the backend is unreachable, so the demo never looks broken.

Run: python backend/scripts/export_static.py
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import SAMPLE_DIR, load_config  # noqa: E402
from app.simulation import run_sample_mission  # noqa: E402

out = ROOT / "frontend" / "public" / "sample"
shutil.rmtree(out, ignore_errors=True)
b = run_sample_mission(load_config(), SAMPLE_DIR, out, "SIM-B3-0001", "/sample/")
print(f"{len(b['survivors'])} survivors -> {out}")
print(b["metrics"])
