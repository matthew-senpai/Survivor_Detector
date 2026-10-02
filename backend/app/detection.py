"""Person detectors. Both produce the same `Detection` list, so the rest of the pipeline can't tell them apart.

- ReplayDetector: pre-recorded detections (prototype / simulation mode, no GPU needed).
- YoloDetector:   YOLO-family model via `ultralytics` (uploaded video, or live on a Jetson-class edge computer).
"""
import json
from dataclasses import dataclass


@dataclass
class Detection:
    x1: float
    y1: float
    x2: float
    y2: float
    conf: float

    @property
    def center(self):
        return (self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2

    @property
    def area(self):
        return max(0.0, self.x2 - self.x1) * max(0.0, self.y2 - self.y1)


class DetectorUnavailable(RuntimeError):
    pass


class ReplayDetector:
    name = "replay (pre-recorded detections)"

    def __init__(self, path: str, min_conf: float = 0.15):
        try:
            with open(path) as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            raise DetectorUnavailable(f"Pre-recorded detection file unreadable: {e}") from e
        self.fps = data["fps"]
        self.total_frames = data["total_frames"]
        self.frames = {fr["i"]: [Detection(*d["bbox"], d["conf"]) for d in fr["dets"] if d["conf"] >= min_conf]
                       for fr in data["frames"]}

    def detect(self, frame_idx: int, image=None) -> list[Detection]:
        return self.frames.get(frame_idx, [])


class YoloDetector:
    name = "YOLO (ultralytics)"

    def __init__(self, weights: str = "yolov8n.pt", person_class: int = 0, min_conf: float = 0.15, **_):
        try:
            from ultralytics import YOLO  # optional heavy dependency
        except ImportError as e:
            raise DetectorUnavailable(
                "YOLO detector unavailable: the 'ultralytics' package is not installed. "
                "Run `pip install ultralytics` (or use the sample mission, which uses pre-recorded detections)."
            ) from e
        try:
            self.model = YOLO(weights)
        except Exception as e:  # weights missing / corrupt / no network to download
            raise DetectorUnavailable(f"Could not load model weights '{weights}': {e}") from e
        self.person_class, self.min_conf = person_class, min_conf
        self.name = f"YOLO ({weights})"

    def detect(self, frame_idx: int, image=None) -> list[Detection]:
        res = self.model.predict(image, conf=self.min_conf, classes=[self.person_class], verbose=False)[0]
        return [Detection(*map(float, b.xyxy[0].tolist()), float(b.conf[0])) for b in res.boxes]
