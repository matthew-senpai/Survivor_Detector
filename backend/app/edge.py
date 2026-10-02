"""Deployment-mode entrypoint: live camera + live MAVLink telemetry -> same pipeline -> same records.

Runs on the edge computer (e.g. Jetson Orin) or a ground-station laptop receiving the video downlink.
Writes snapshots into the shared data directory; the command center picks up missions with status 'live'.

  python -m app.edge --video rtsp://192.168.144.25:8554/main --mavlink /dev/ttyTHS1 --baud 921600
  python -m app.edge --video "nvarguscamerasrc ! video/x-raw(memory:NVMM),width=1920,height=1080 ! nvvidconv ! video/x-raw,format=BGRx ! videoconvert ! appsink" --mavlink udpin:0.0.0.0:14550

Not verified on physical hardware in this prototype: the adapters follow the pymavlink / OpenCV APIs.
"""
import argparse
import time
from datetime import datetime, timezone

from . import evidence, store
from .config import load_config
from .detection import YoloDetector
from .hardware.mavlink_source import MavlinkTelemetrySource
from .hardware.video_source import OpenCVVideoSource
from .pipeline import SurvivorPipeline, build_bundle


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True, help="file, RTSP URL, GStreamer pipeline or device index")
    ap.add_argument("--mavlink", required=True, help="serial port or udpin:/udpout: URL")
    ap.add_argument("--baud", type=int, default=921600)
    ap.add_argument("--name", default="Live UAV mission")
    ap.add_argument("--weights", default=None, help="YOLO weights (.pt, or TensorRT .engine on Jetson)")
    ap.add_argument("--snapshot-s", type=float, default=5.0, help="publish survivor records every N seconds")
    args = ap.parse_args()

    import cv2
    from PIL import Image

    cfg = load_config()
    t0 = time.monotonic()  # one clock for video and telemetry
    video = OpenCVVideoSource(args.video, cfg["processing"]["fps"], t0=t0)
    tel = MavlinkTelemetrySource(args.mavlink, args.baud, t0=t0)
    cfg["camera"].update(image_width=video.size[0], image_height=video.size[1])
    detector = YoloDetector(**cfg["detector"] | {"weights": args.weights or cfg["detector"]["yolo_weights"]})
    pipe = SurvivorPipeline(cfg)

    mid = f"LIVE-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"
    store.init()
    store.create_mission(mid, args.name, "deployment", "live")
    kept, last = {}, 0.0
    started = datetime.now(timezone.utc).isoformat()

    def publish(status):
        n = pipe.stats["frames_processed"]
        mission = {"id": mid, "name": args.name, "sector": "-", "area": "Live", "mode": "deployment",
                   "status": status, "start_time": started,
                   "source": {"video": args.video, "telemetry": f"MAVLink {args.mavlink}", "detector": detector.name},
                   "fps": cfg["processing"]["fps"], "frames_total": n, "duration_s": n / cfg["processing"]["fps"],
                   "asset_base": f"/api/missions/{mid}/assets/"}
        b = build_bundle(mission, tel.track.samples, pipe, pipe.survivors(), pipe.geo)
        decode = lambda i: Image.fromarray(cv2.cvtColor(cv2.imdecode(kept[i], cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB))
        evidence.write_all(b, decode, store.mission_dir(mid))
        store.save_bundle(b)
        print(f"[{mid}] {n} frames, {len(b['survivors'])} survivors")

    try:
        for idx, t, frame in video.frames():
            dets = detector.detect(idx, frame)
            pipe.process_frame(idx, t, dets, tel.at(t))
            if dets:
                kept[idx] = cv2.imencode(".jpg", frame)[1]  # ponytail: unbounded; prune to best frames on long flights
            if t - last >= args.snapshot_s:
                publish("live")
                last = t
    except KeyboardInterrupt:
        pass
    publish("complete")


if __name__ == "__main__":
    main()
