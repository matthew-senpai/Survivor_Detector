"""Landsight API. Run: uvicorn app.main:app --port 8000 (from backend/)."""
import importlib.util
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import evidence, store
from .config import ROOT, SAMPLE_DIR, load_config
from .detection import DetectorUnavailable, YoloDetector
from .pipeline import SurvivorPipeline, build_bundle
from .simulation import run_sample_mission
from .telemetry import TelemetryError, TelemetryTrack, parse_csv

SAMPLE_ID = "SIM-B3-0001"
DIST = ROOT / "frontend" / "dist"


def _run_sample(mission_id: str):
    try:
        bundle = run_sample_mission(load_config(), SAMPLE_DIR, store.mission_dir(mission_id), mission_id,
                                    f"/api/missions/{mission_id}/assets/")
        store.save_bundle(bundle)
    except Exception as e:  # surfaced to the UI via mission status
        store.set_status(mission_id, "failed", f"Sample mission failed: {e}")


def _start_sample(mission_id: str):
    store.create_mission(mission_id, "Landslide SAR · Sector B-3", "simulation")
    threading.Thread(target=_run_sample, args=(mission_id,), daemon=True).start()


@asynccontextmanager
async def lifespan(_app):
    store.init()
    m = store.get_mission(SAMPLE_ID)
    if m is None or m["status"] in ("failed", "processing") or store.load_bundle(SAMPLE_ID) is None:
        _start_sample(SAMPLE_ID)  # demo works immediately after install
    yield


app = FastAPI(title="Landsight API", version="1.0", lifespan=lifespan)


@app.get("/api/health")
def health():
    has = lambda mod: importlib.util.find_spec(mod) is not None
    sample_ok = all((SAMPLE_DIR / f).exists() for f in ("telemetry.csv", "detections.json", "scene.json", "terrain.jpg"))
    try:
        store.list_missions()
        db = "ok"
    except Exception as e:
        db = f"error: {e}"
    return {
        "status": "ok", "time": datetime.now(timezone.utc).isoformat(), "mode": "simulation",
        "components": {
            "api": "ok", "database": db,
            "sample_data": "ok" if sample_ok else "missing: run backend/scripts/generate_sample.py",
            "detector_replay": "ok" if sample_ok else "unavailable",
            "detector_yolo": "available" if has("ultralytics") else "not installed (pip install ultralytics)",
            "video_io": "available" if has("cv2") else "not installed (pip install opencv-python)",
            "mavlink": "available" if has("pymavlink") else "not installed (deployment only)",
        },
    }


@app.get("/api/missions")
def missions():
    return store.list_missions()


@app.post("/api/missions/sample")
def new_sample_mission():
    mid = f"SIM-B3-{uuid.uuid4().hex[:4].upper()}"
    _start_sample(mid)
    return {"id": mid, "status": "processing"}


@app.get("/api/missions/{mission_id}/bundle")
def bundle(mission_id: str):
    m = store.get_mission(mission_id)
    if m is None:
        raise HTTPException(404, {"message": f"Mission {mission_id} not found"})
    b = store.load_bundle(mission_id)
    if b is None:
        raise HTTPException(409, {"message": m["error"] or f"Mission is {m['status']}", "status": m["status"]})
    b["mission"]["status"] = m["status"]
    return b


@app.get("/api/missions/{mission_id}/assets/{path:path}")
def asset(mission_id: str, path: str):
    base = store.mission_dir(mission_id).resolve()
    f = (base / path).resolve()
    if base not in f.parents or not f.is_file():
        raise HTTPException(404, {"message": "Asset not found"})
    return FileResponse(f)


class StatusUpdate(BaseModel):
    status: str


@app.patch("/api/missions/{mission_id}/survivors/{survivor_id}")
def survivor_status(mission_id: str, survivor_id: str, body: StatusUpdate):
    if body.status not in store.SURVIVOR_STATUSES:
        raise HTTPException(422, {"message": f"status must be one of {', '.join(store.SURVIVOR_STATUSES)}"})
    if not store.set_survivor_status(mission_id, survivor_id, body.status):
        raise HTTPException(404, {"message": "Survivor not found"})
    return {"ok": True}


@app.post("/api/missions/upload")
async def upload(video: UploadFile | None = File(None), telemetry: UploadFile | None = File(None),
                 name: str = Form("Uploaded mission")):
    if telemetry is None:
        raise HTTPException(422, {"message": "Telemetry CSV is required: without the drone's position, detections "
                                             "cannot be geolocated.", "errors": []})
    try:
        samples = parse_csv((await telemetry.read()).decode("utf-8-sig", errors="replace"))
    except TelemetryError as e:
        raise HTTPException(422, {"message": "Telemetry file is invalid", "errors": e.errors})
    if video is None:
        raise HTTPException(422, {"message": "Drone video is required (or run the sample mission).", "errors": []})
    try:
        if importlib.util.find_spec("cv2") is None:
            raise DetectorUnavailable("Video decoding unavailable: `pip install opencv-python`")
        cfg = load_config()
        detector = YoloDetector(**cfg["detector"] | {"weights": cfg["detector"]["yolo_weights"]})
    except DetectorUnavailable as e:
        raise HTTPException(503, {"message": str(e), "errors": []})

    mid = f"UPL-{uuid.uuid4().hex[:6].upper()}"
    store.create_mission(mid, name, "upload")
    suffix = "." + (video.filename or "video.mp4").rsplit(".", 1)[-1].lower()[:5]
    vpath = store.mission_dir(mid) / f"video{suffix}"
    with open(vpath, "wb") as f:
        while chunk := await video.read(1 << 20):
            f.write(chunk)
    threading.Thread(target=_run_video, args=(mid, name, vpath, samples, cfg, detector), daemon=True).start()
    return {"id": mid, "status": "processing"}


def _run_video(mid, name, vpath, samples, cfg, detector):
    try:
        import cv2
        from PIL import Image
        from .hardware.video_source import OpenCVVideoSource
        src = OpenCVVideoSource(str(vpath), cfg["processing"]["fps"])
        cfg["camera"].update(image_width=src.size[0], image_height=src.size[1])
        pipe, tel, kept = SurvivorPipeline(cfg), TelemetryTrack(samples), {}
        for idx, t, frame in src.frames():
            t0 = time.perf_counter()
            dets = detector.detect(idx, frame)
            pipe.stats["processing_s"] += time.perf_counter() - t0
            pipe.process_frame(idx, t, dets, tel.at(t))
            if dets:
                kept[idx] = cv2.imencode(".jpg", frame)[1]
        if pipe.stats["frames_processed"] == 0:
            raise ValueError("Video contains no readable frames")
        survivors = pipe.survivors()
        n = pipe.stats["frames_processed"]
        mission = {"id": mid, "name": name, "sector": "-", "area": "Uploaded footage", "mode": "upload",
                   "status": "complete", "start_time": datetime.now(timezone.utc).isoformat(),
                   "source": {"video": vpath.name, "telemetry": "uploaded CSV", "detector": detector.name},
                   "fps": cfg["processing"]["fps"], "frames_total": n, "duration_s": n / cfg["processing"]["fps"],
                   "asset_base": f"/api/missions/{mid}/assets/"}
        b = build_bundle(mission, samples, pipe, survivors, pipe.geo)
        b["video"] = vpath.name
        decode = lambda i: Image.fromarray(cv2.cvtColor(cv2.imdecode(kept[i], cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB))
        evidence.write_all(b, decode, store.mission_dir(mid))
        store.save_bundle(b)
    except Exception as e:
        store.set_status(mid, "failed", f"Processing failed: {e}")


if DIST.exists():  # serve the built frontend, so one process runs the whole demo
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, {"message": f"Unknown API route /{path}"})
        f = (DIST / path).resolve()
        if path and DIST.resolve() in f.parents and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
