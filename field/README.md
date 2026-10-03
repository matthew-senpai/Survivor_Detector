# Landsight Field: real drone, real detection

A field station that runs entirely in the browser. Feed it a drone's video and position. A YOLO11n person
detector runs on the laptop's GPU (WebGPU, CPU fallback). Each person is tracked, located on a satellite map,
ranked for rescue with a transparent points table, and saved with evidence images. Nothing is uploaded, and
it keeps working offline once loaded.

It is a separate app and Vercel project from the main Landsight site (`../frontend`), which is untouched.

## Inputs

| Video | How |
|---|---|
| Capture card / camera | Drone controller HDMI out → USB HDMI capture card (DJI RC Pro, Autel, SIYI…) |
| Screen / app window | Capture the pilot app's live view (QGroundControl, Mission Planner, mirrored phone) |
| Video file | Recorded flight, processed frame by frame (every frame, exact timestamps) |
| Sample clip | Public-domain drone footage of climbers (Thomas Tapp, CC0, Wikimedia Commons) |

| Position | How |
|---|---|
| MAVLink · USB serial | PX4/ArduPilot telemetry radio or FC USB via Web Serial (Chrome/Edge). Read-only. |
| MAVLink · WebSocket | `python ../backend/tools/mavlink_ws_bridge.py --udp 14550` (share the link with QGC) |
| DJI .SRT log | Recorded next to the video when "Video Subtitles" is on. Heading from gimbal yaw if logged, else the flight path |
| CSV log | `t, lat, lon, alt_m, heading_deg[, gimbal_pitch_deg, gps_fix, sats, hdop…]` |
| Fixed position | Hovering drone at a known point |
| None | Detection and tracking only (no map, movement not assessed) |

Geolocation handles oblique gimbal angles (ray / ground-plane intersection), not only straight down.

## Run

```bash
npm install
npm run dev        # http://localhost:5174 (Chrome/Edge for WebGPU + Web Serial)
npm run build && npm run preview
npm test           # 39 tests
```

## How it's verified

- **Pipeline parity:** the TypeScript tracker, analysis, dedup and priority reproduce the Python backend
  exactly on the sample mission: same 15 survivors, track ids frame by frame, priorities and evidence frames
  (`tests/parity.test.ts`). Thresholds must match `../config/pipeline.json`.
- **Detector:** post-processing reproduces Ultralytics' boxes and confidences on the same raw ONNX output
  (`tests/detector.test.ts`). In the app, **Self-test** runs the real model on a CC0 drone frame and compares
  with the reference; it passes in Chrome on WebGPU.
- **MAVLink:** every supported message decoded from frames made by pymavlink (v1/v2, truncation, noise, bad
  CRC) (`tests/mavlink.test.ts`). End to end: the simulated bridge streamed into the app with live heartbeat,
  GPS and position.
- **Flight logs:** DJI SRT variants (Mini 2, Mini 3/4/Air/Mavic 3, Mavic 2/Phantom, enterprise gimbal fields,
  pre-GPS-lock entries) and CSV validation (`tests/telemetry.test.ts`).
- **Real footage:** the sample clip processed end to end on WebGPU (Balanced mode, about 230 ms per frame).

Fixtures are regenerated with `python scripts/make_fixtures.py <work-dir>` (needs ultralytics, pymavlink).

## Limits (be honest with operators)

- YOLO11n is a general (COCO) detector. It finds clearly visible people from altitude; tiny straight-down
  figures (about 20–35 px) are often missed, even with High sensitivity. For real SAR use, fine-tune on aerial data
  (`../backend/scripts/train_aerial.py`, VisDrone; or SARD/HERIDAL) and load the ONNX via **Custom model**.
- Not tested with a physical drone, capture card or telemetry radio. The serial path uses the standard Web
  Serial API, and the same decoder is verified against pymavlink and over WebSocket.
- DJI drones don't expose live telemetry to browsers: live DJI flights run detection-only, then positions come
  from the `.SRT` after landing.
- Heights are relative to take-off; on slopes set an altitude offset. Flat-ground geolocation.

## Licences

YOLO11n weights: AGPL-3.0 (Ultralytics); commercial use needs an Ultralytics licence. Sample clip and
self-test frame: CC0 (Thomas Tapp). Map imagery © Esri.
