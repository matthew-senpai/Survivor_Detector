"""Persistence. SQLite for mission + survivor records (schema is plain SQL, portable to PostgreSQL);
heavy replay data (frames, telemetry) and evidence images live in data/missions/<id>/."""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .config import ROOT

DATA = ROOT / "data"
MISSIONS = DATA / "missions"
DB = DATA / "landsight.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY, name TEXT, mode TEXT, status TEXT, created_at TEXT, error TEXT, summary TEXT
);
CREATE TABLE IF NOT EXISTS survivors (
  mission_id TEXT, id TEXT, lat REAL, lon REAL, priority TEXT, confidence REAL, status TEXT, record TEXT,
  PRIMARY KEY (mission_id, id)
);
"""
SURVIVOR_STATUSES = ("new", "verified", "dispatched", "rescued", "false_positive")


def _db():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con


def init():
    MISSIONS.mkdir(parents=True, exist_ok=True)
    with _db() as con:
        con.executescript(SCHEMA)


def mission_dir(mission_id: str) -> Path:
    return MISSIONS / mission_id


def create_mission(mission_id: str, name: str, mode: str, status: str = "processing"):
    with _db() as con:
        con.execute("INSERT OR REPLACE INTO missions VALUES (?,?,?,?,?,?,?)",
                    (mission_id, name, mode, status, datetime.now(timezone.utc).isoformat(), None, None))
    mission_dir(mission_id).mkdir(parents=True, exist_ok=True)


def set_status(mission_id: str, status: str, error: str | None = None):
    with _db() as con:
        con.execute("UPDATE missions SET status=?, error=? WHERE id=?", (status, error, mission_id))


def save_bundle(bundle: dict):
    """Persist a (possibly partial, for live missions) bundle. Keeps operator-set survivor statuses."""
    m = bundle["mission"]
    with _db() as con:
        old = {r["id"]: r["status"] for r in con.execute("SELECT id, status FROM survivors WHERE mission_id=?", (m["id"],))}
        con.execute("DELETE FROM survivors WHERE mission_id=?", (m["id"],))
        for s in bundle["survivors"]:
            s["status"] = old.get(s["id"], s.get("status", "new"))
            con.execute("INSERT INTO survivors VALUES (?,?,?,?,?,?,?,?)",
                        (m["id"], s["id"], s["lat"], s["lon"], s["priority"]["level"], s["confidence"], s["status"],
                         json.dumps(s)))
        con.execute("UPDATE missions SET status=?, summary=? WHERE id=?",
                    (m["status"], json.dumps(bundle["metrics"]), m["id"]))
    rest = {k: v for k, v in bundle.items() if k != "survivors"}
    (mission_dir(m["id"]) / "bundle.json").write_text(json.dumps(rest, separators=(",", ":")))


def list_missions() -> list[dict]:
    with _db() as con:
        rows = con.execute("SELECT id, name, mode, status, created_at, error, summary FROM missions "
                           "ORDER BY created_at DESC").fetchall()
    return [{**dict(r), "summary": json.loads(r["summary"]) if r["summary"] else None} for r in rows]


def get_mission(mission_id: str) -> dict | None:
    return next((m for m in list_missions() if m["id"] == mission_id), None)


def load_bundle(mission_id: str) -> dict | None:
    path = mission_dir(mission_id) / "bundle.json"
    if not path.exists():
        return None
    bundle = json.loads(path.read_text())
    with _db() as con:
        rows = con.execute("SELECT record, status FROM survivors WHERE mission_id=?", (mission_id,)).fetchall()
    bundle["survivors"] = sorted(({**json.loads(r["record"]), "status": r["status"]} for r in rows),
                                 key=lambda s: s["id"])
    return bundle


def set_survivor_status(mission_id: str, survivor_id: str, status: str) -> bool:
    with _db() as con:
        cur = con.execute("UPDATE survivors SET status=? WHERE mission_id=? AND id=?", (status, mission_id, survivor_id))
    return cur.rowcount > 0
