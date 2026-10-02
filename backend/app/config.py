"""Paths and configuration (config/pipeline.json). Override the file with LANDSIGHT_CONFIG=/path/to.json."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(os.environ.get("LANDSIGHT_CONFIG", ROOT / "config" / "pipeline.json"))
SAMPLE_DIR = ROOT / "data" / "sample"


def load_config() -> dict:
    return json.loads(CONFIG_PATH.read_text())
