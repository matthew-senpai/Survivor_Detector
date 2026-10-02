"""End-to-end check against simulated ground truth. Run: python -m pytest tests  (or: python tests/test_pipeline.py)"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import SAMPLE_DIR, load_config  # noqa: E402
from app.simulation import run_sample_mission  # noqa: E402
from app.telemetry import TelemetryError, parse_csv  # noqa: E402


def test_sample_mission_meets_targets():
    cfg = load_config()
    with tempfile.TemporaryDirectory() as d:
        b = run_sample_mission(cfg, SAMPLE_DIR, Path(d), "TEST", "/")
        assert (Path(d) / "bundle.json").exists()
        for s in b["survivors"]:
            assert (Path(d) / s["evidence"]["frame"]).exists()
    truth, tg = b["metrics"]["sim_truth"], cfg["targets"]
    assert truth["recall"] >= tg["min_recall"], truth
    assert truth["duplicate_rate"] <= tg["max_duplicate_rate"], truth
    assert truth["max_geo_error_m"] <= tg["max_geo_error_m"], truth
    assert b["metrics"]["duplicates_suppressed"] > 0  # people seen on two passes were merged, not double-counted
    for s in b["survivors"]:
        bd = s["priority"]["breakdown"]
        assert sum(x["points"] for x in bd) == s["priority"]["score"]


def test_invalid_telemetry_is_rejected_with_reasons():
    for bad, needle in (("lat,lon\n1,2", "Missing required"), ("t,lat,lon,alt_m,heading_deg\n0,95,76,30,0", "out of range"),
                        ("t,lat,lon,alt_m,heading_deg\n1,11,76,30,0\n0.5,11,76,30,0", "not increasing")):
        try:
            parse_csv(bad)
            raise AssertionError("expected TelemetryError")
        except TelemetryError as e:
            assert needle in " ".join(e.errors), e.errors


if __name__ == "__main__":
    test_invalid_telemetry_is_rejected_with_reasons()
    test_sample_mission_meets_targets()
    print("ok")
