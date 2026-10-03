"""Reference outputs the Field app's TypeScript is tested against (vitest, field/tests/).

  1. pipeline_expected.json  Python SurvivorPipeline on the bundled sample mission (port parity)
  2. mavlink.json            frames encoded by pymavlink (v1 + v2, truncation, garbage, bad CRC)
  3. det_*                   Ultralytics YOLO11n on public/selftest.jpg: raw ONNX output + final boxes

Run with the backend venv (needs ultralytics, onnxruntime, pymavlink, opencv):
  python field/scripts/make_fixtures.py <work-dir-containing-yolo11n.onnx-and-ice.webm>
"""
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "field" / "tests" / "fixtures"
FIX.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / "backend"))


def pipeline():
    from app.config import SAMPLE_DIR, load_config
    from app.detection import ReplayDetector
    from app.pipeline import SurvivorPipeline, run_batch
    from app.telemetry import TelemetryTrack, parse_csv
    cfg = load_config()
    det = ReplayDetector(str(SAMPLE_DIR / "detections.json"), cfg["detector"]["min_conf"])
    pipe = SurvivorPipeline(cfg)
    run_batch(pipe, det, TelemetryTrack(parse_csv((SAMPLE_DIR / "telemetry.csv").read_text())), det.total_frames, det.fps)
    stats = {k: v for k, v in pipe.stats.items() if k != "processing_s"}
    out = {"survivors": pipe.survivors(), "frames": pipe.frames, "stats": stats, "warnings": pipe.warnings,
           "confirmed_tracks": len(pipe.tracker.confirmed())}
    (FIX / "pipeline_expected.json").write_text(json.dumps(out))
    print("pipeline:", len(out["survivors"]), "survivors")


def mavlink():
    from pymavlink.dialects.v10 import common as v1
    from pymavlink.dialects.v20 import common as v2

    class Sink:
        def __init__(self):
            self.buf = b""

        def write(self, b):
            self.buf += b

    cases = []

    def enc(mod, name, fields, label):
        link = mod.MAVLink(Sink(), srcSystem=1, srcComponent=1)
        msg = getattr(link, name + "_encode")(**fields)
        cases.append({"label": label, "msgid": msg.get_msgId(), "hex": msg.pack(link).hex(),
                      "fields": {k: (v.decode() if isinstance(v, bytes) else v) for k, v in fields.items()}})

    for mod, ver in ((v2, "v2"), (v1, "v1")):
        enc(mod, "heartbeat", dict(type=2, autopilot=3, base_mode=81, custom_mode=4, system_status=4, mavlink_version=3), f"HEARTBEAT {ver}")
        enc(mod, "global_position_int", dict(time_boot_ms=123456, lat=114762345, lon=761428765, alt=152300, relative_alt=30450,
                                             vx=-512, vy=230, vz=-10, hdg=27150), f"GLOBAL_POSITION_INT {ver}")
        enc(mod, "gps_raw_int", dict(time_usec=987654321, fix_type=3, lat=114762345, lon=761428765, alt=152300, eph=92, epv=140,
                                     vel=503, cog=27100, satellites_visible=15), f"GPS_RAW_INT {ver}")
        enc(mod, "attitude", dict(time_boot_ms=2000, roll=0.01, pitch=-0.02, yaw=-1.5708, rollspeed=0.0, pitchspeed=0.0,
                                  yawspeed=0.1), f"ATTITUDE {ver}")
        enc(mod, "sys_status", dict(onboard_control_sensors_present=1, onboard_control_sensors_enabled=1, onboard_control_sensors_health=1,
                                    load=250, voltage_battery=15800, current_battery=1200, battery_remaining=77, drop_rate_comm=0,
                                    errors_comm=0, errors_count1=0, errors_count2=0, errors_count3=0, errors_count4=0), f"SYS_STATUS {ver}")
        enc(mod, "vfr_hud", dict(airspeed=5.2, groundspeed=5.0, heading=271, throttle=48, alt=152.3, climb=0.1), f"VFR_HUD {ver}")
        enc(mod, "distance_sensor", dict(time_boot_ms=2100, min_distance=20, max_distance=4000, current_distance=2995, type=0, id=0,
                                         orientation=25, covariance=0), f"DISTANCE_SENSOR {ver}")
        enc(mod, "statustext", dict(severity=6, text=b"LANDSIGHT SIMULATED TELEMETRY"), f"STATUSTEXT {ver}")
    enc(v2, "mount_orientation", dict(time_boot_ms=2200, roll=0.0, pitch=-87.5, yaw=3.0, yaw_absolute=274.0), "MOUNT_ORIENTATION v2")
    enc(v2, "gimbal_device_attitude_status", dict(target_system=1, target_component=154, time_boot_ms=2300,
                                                  flags=12, q=[0.7071068, 0.0, -0.7071068, 0.0], angular_velocity_x=0.0,
                                                  angular_velocity_y=0.0, angular_velocity_z=0.0, failure_flags=0),
        "GIMBAL_DEVICE_ATTITUDE_STATUS v2 (pitch -90)")
    (FIX / "mavlink.json").write_text(json.dumps(cases, indent=1))
    print("mavlink:", len(cases), "frames")


def detector(work: Path):
    import cv2
    import numpy as np
    import onnxruntime as ort
    from ultralytics import YOLO
    from ultralytics.data.augment import LetterBox

    cap = cv2.VideoCapture(str(work / "ice.webm"))
    cap.set(cv2.CAP_PROP_POS_MSEC, 36_000)
    ok, frame = cap.read()
    assert ok, "could not read frame from ice.webm"
    img_path = ROOT / "field" / "public" / "selftest.jpg"
    cv2.imwrite(str(img_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    img = cv2.imread(str(img_path))
    h0, w0 = img.shape[:2]

    lb = LetterBox(new_shape=(640, 640), auto=False, stride=32)(image=img)
    x = lb[..., ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    sess = ort.InferenceSession(str(work / "yolo11n.onnx"))
    raw = sess.run(None, {"images": np.ascontiguousarray(x)})[0]
    (FIX / "det_output.bin").write_bytes(raw.astype("<f4").tobytes())

    res = YOLO(str(work / "yolo11n.onnx"), task="detect").predict(img, imgsz=640, conf=0.25, iou=0.7, classes=[0], verbose=False)[0]
    boxes = [[*map(float, b), float(c)] for b, c in zip(res.boxes.xyxy.tolist(), res.boxes.conf.tolist())]
    (FIX / "det_expected.json").write_text(json.dumps({"width": w0, "height": h0, "dims": list(raw.shape), "boxes": boxes}))
    print("detector:", len(boxes), "people on selftest.jpg", (w0, h0))


if __name__ == "__main__":
    pipeline()
    mavlink()
    detector(Path(sys.argv[1]))
