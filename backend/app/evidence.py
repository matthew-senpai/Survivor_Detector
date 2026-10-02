"""Evidence package per survivor: annotated original frame + zoomed crop + metadata.

`frame_provider(frame_idx) -> PIL.Image` is the only dependency: SceneFrameProvider in simulation,
VideoFrameProvider (below) for recorded/live video.
"""
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

COLORS = {"HIGH": (255, 77, 61), "MEDIUM": (255, 176, 32), "LOW": (120, 190, 255)}


class VideoFrameProvider:
    def __init__(self, path: str, fps: float):
        import cv2  # optional dependency, only for real video
        self.cv2, self.cap, self.fps = cv2, cv2.VideoCapture(path), fps

    def __call__(self, frame_idx: int) -> Image.Image:
        self.cap.set(self.cv2.CAP_PROP_POS_MSEC, frame_idx / self.fps * 1000)
        ok, frame = self.cap.read()
        if not ok:
            raise ValueError(f"Could not read video frame {frame_idx}")
        return Image.fromarray(self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2RGB))


def _font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def write_all(bundle: dict, frame_provider, out_dir: Path):
    ev_dir = out_dir / "evidence"
    ev_dir.mkdir(parents=True, exist_ok=True)
    frames = dict((f, dets) for f, dets in bundle["frames"])
    m = bundle["mission"]
    start = datetime.fromisoformat(m["start_time"].replace("Z", "+00:00"))
    small, big = _font(15), _font(20)

    for s in bundle["survivors"]:
        b = s["best"]
        try:
            img = frame_provider(b["frame"]).convert("RGB")
        except Exception as e:  # evidence is best-effort; never fail the mission over it
            s["evidence"] = {"error": str(e)}
            continue
        ts = (start + timedelta(seconds=b["t"])).strftime("%Y-%m-%d %H:%M:%S UTC")
        crop = _crop(img, b["bbox"], COLORS[s["priority"]["level"]])

        d = ImageDraw.Draw(img)
        for x1, y1, x2, y2, conf, _tid, sid in frames.get(b["frame"], []):
            if sid != s["id"]:
                d.rectangle([x1, y1, x2, y2], outline=(230, 230, 230), width=1)
        col = COLORS[s["priority"]["level"]]
        x1, y1, x2, y2 = b["bbox"]
        d.rectangle([x1 - 3, y1 - 3, x2 + 3, y2 + 3], outline=col, width=3)
        label = f"{s['id']}  {b['conf'] * 100:.0f}%  {s['priority']['level']}"
        tw = d.textlength(label, font=big)
        ly = y1 - 32 if y1 > 40 else y2 + 8
        d.rectangle([x1 - 3, ly, x1 + tw + 9, ly + 26], fill=col)
        d.text((x1 + 3, ly + 3), label, fill=(10, 10, 10), font=big)
        W, H = img.size
        d.rectangle([0, H - 30, W, H], fill=(0, 0, 0))
        d.text((10, H - 23), f"{m['id']} | FRAME {b['frame']} | {ts} | EST {s['lat']:.6f}, {s['lon']:.6f} "
                             f"±{s['uncertainty_m']:.1f} m | TRK {','.join(map(str, s['track_ids']))} | ALT {b['alt_m']} m",
               fill=(220, 220, 220), font=small)

        img.save(ev_dir / f"{s['id']}_frame.jpg", quality=82)
        crop.save(ev_dir / f"{s['id']}_crop.jpg", quality=88)
        s["evidence"] = {"frame": f"evidence/{s['id']}_frame.jpg", "crop": f"evidence/{s['id']}_crop.jpg",
                         "timestamp": ts, "frame_index": b["frame"], "mission_id": m["id"]}


def _crop(img: Image.Image, bbox, col, out=320):
    x1, y1, x2, y2 = bbox
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    half = max(x2 - x1, y2 - y1) * 1.4 + 12
    box = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
    c = img.crop(box).resize((out, out), Image.LANCZOS)
    k = out / (2 * half)
    d = ImageDraw.Draw(c)
    d.rectangle([(x1 - box[0]) * k - 4, (y1 - box[1]) * k - 4, (x2 - box[0]) * k + 4, (y2 - box[1]) * k + 4],
                outline=col, width=2)
    return c
