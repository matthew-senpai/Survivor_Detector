# Landsight: AI landslide survivor detection & rescue coordination

Drone footage → person detection → ground-plane tracking → geolocation → deduplication → transparent
priority → evidence → rescue command center.

Software-first prototype. The full pipeline runs on recorded data (synthetic aerial footage, a noisy
telemetry CSV, pre-recorded detections) and is designed so a real UAV, camera and edge computer replace
the inputs without touching anything downstream. Every simulated element is labelled as such in the UI.

## Run it

Requirements: Python 3.11+ and Node 20+.

```bash
# backend
cd backend
python -m venv .venv
.venv/Scripts/activate            # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt

# frontend (one-time build; the API then serves the whole site on :8000)
cd ../frontend
npm install
npm run build

cd ../backend
uvicorn app.main:app --port 8000
```

Open http://localhost:8000. On first start the API runs the sample mission through the pipeline (about 5 s)
and stores it, so the demo works immediately.

**Development mode** (hot reload): run `uvicorn app.main:app --port 8000 --reload` in `backend/` and
`npm run dev` in `frontend/`, then open http://localhost:5173 (Vite proxies `/api` to :8000).

> **Windows long paths:** if `pip`/Pillow fails with *"The filename or extension is too long"*, put the venv
> on a short path (e.g. `python -m venv C:\lsv`) or enable long-path support.

**No backend?** The frontend ships a cached copy of the processed sample mission
(`frontend/public/sample/`) and falls back to it automatically, labelled "API OFFLINE · CACHED".

## Guided demo (for judges)

1. Landing page → **Launch Rescue Command Center** (opens `/command?demo=1`).
2. The mission replays at 4× with a step-by-step walkthrough: footage → detection → tracking → geolocation →
   prioritisation → map → evidence → command center.
3. Click any survivor (map marker, list, or box in the feed) for location, uncertainty, the priority
   points breakdown, tracking history, evidence images and rescue status.
4. **Simulation** (header) → re-run the sample mission, upload video + telemetry, and see pipeline metrics
   against the configured targets.
5. **Hardware Integration** (navbar) → how this connects to a real drone.

## What the sample mission demonstrates

Sector B-3, 200 × 150 m, 30 m AGL lawnmower survey, 254 s, 1,271 frames at 5 fps. 12 people (waving,
crawling, motionless, partly/deeply buried, under branches) plus 3 person-sized decoys (tarp, clothing,
sack), GPS drift, compass/baro error and a 4 s GPS dropout.

Scored automatically against ground truth (`backend/tests/test_pipeline.py`):

| Metric | Result | Target (config) |
|---|---|---|
| Recall | 12/12 people | ≥ 90 % |
| Duplicate survivors | 0 (3 cross-pass duplicates merged) | ≤ 5 % |
| Location error, mean / max | ≈ 0.65 m / 1.2 m | ≤ 5 m |
| Decoys | 3 detected, all rated LOW | n/a |

## Architecture

```
backend/app/
  telemetry.py      TelemetrySample, CSV parsing + validation, per-frame pose interpolation
  detection.py      Detector interface: ReplayDetector (recorded) | YoloDetector (ultralytics)
  geolocation.py    Geolocator protocol; NadirPinholeGeolocator (replaceable: DEM, oblique, RTK)
  tracking.py       GroundTracker: ByteTrack-style two-stage association in the ground plane
  analysis.py       movement, persistence, location confidence, deduplication → survivors
  priority.py       transparent points table → HIGH / MEDIUM / LOW + reasons
  evidence.py       annotated frame + crop + metadata per survivor
  pipeline.py       SurvivorPipeline (frame-by-frame, same code for replay and live), coverage, bundle
  simulation.py     synthetic camera renderer + ground-truth scoring (simulation only)
  store.py          SQLite (portable SQL) + per-mission files
  main.py           FastAPI: missions, bundles, assets, survivor status, upload
  edge.py           deployment entrypoint: RTSP/CSI camera + MAVLink → pipeline → records
  hardware/         video_source.py (OpenCV/GStreamer), mavlink_source.py (pymavlink)
backend/scripts/
  generate_sample.py  builds data/sample/ (terrain, scene, telemetry.csv, detections.json)
  export_static.py    refreshes the frontend's cached sample mission
config/pipeline.json  camera, tracker, dedup, movement, location, priority thresholds, perf targets
frontend/src/
  pages/            Landing, CommandCenter, Hardware
  sections/         landing page sections
  components/       DroneFeed (canvas), RescueMap (Leaflet), SurvivorPanel, SimControls
  lib/              API client + offline fallback, replay clock, mission helpers, scene renderer
```

Why geolocate *before* tracking: a drone moves ~1 m per frame, so image-space IoU between frames collapses for
small people. Geolocating each detection first lets the tracker associate on the ground, which is the same
idea as BoT-SORT's camera-motion compensation, using telemetry instead of image registration.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | component status (DB, sample data, YOLO / OpenCV / MAVLink availability) |
| GET | `/api/missions` | mission list with status |
| POST | `/api/missions/sample` | re-run the sample mission (async; poll `/api/missions`) |
| POST | `/api/missions/upload` | multipart `video` + `telemetry` (CSV), needs `requirements-deploy.txt` |
| GET | `/api/missions/{id}/bundle` | everything the dashboard needs to replay a mission |
| GET | `/api/missions/{id}/assets/{path}` | evidence images, terrain, uploaded video |
| PATCH | `/api/missions/{id}/survivors/{sid}` | `{"status": "new / verified / dispatched / rescued / false_positive"}` |

Telemetry CSV: `t, lat, lon, alt_m, heading_deg` required; `speed_mps, gimbal_pitch_deg, gps_fix, sats, hdop,
battery_pct` optional. `t` = seconds from video start. Invalid files are rejected with row-level reasons.

## Real hardware

```bash
pip install -r requirements-deploy.txt
python -m app.edge --video rtsp://192.168.144.25:8554/main --mavlink /dev/ttyTHS1 --baud 921600
```

Wiring, flight-controller parameters, camera calibration and a pre-flight checklist are on the
**Hardware Integration & Setup** page (`/hardware`).

## Honest limitations

- The MAVLink, RTSP/CSI and edge-runner code follows the pymavlink/OpenCV APIs but has **not been tested on
  physical hardware**.
- YOLO with generic COCO weights is weak on small aerial people; fine-tune on aerial SAR data (e.g. VisDrone,
  SARD) before field use. The sample mission replays recorded detections, so it measures tracking/analysis,
  not detector accuracy.
- Geolocation assumes a nadir camera over locally flat ground; steep slopes need the DEM-based geolocator the
  interface is designed for.
- Movement detection uses box-shape change and ground velocity; it can miss an arm waving inside the box of
  a diagonally lying person. Deployment should add motion-compensated frame differencing.
- Location shown is illustrative and not linked to any real incident. Satellite basemap © Esri; the drone
  mosaic, people and teams are synthetic.

## Tests

```bash
cd backend && python tests/test_pipeline.py      # or: python -m pytest tests
```
