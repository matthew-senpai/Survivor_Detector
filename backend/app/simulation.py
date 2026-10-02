"""Simulation: stands in for the drone's camera when no hardware is attached.

The synthetic world (terrain + people + true flight path) lives in data/sample/scene.json. It is
only used to *render footage* (evidence frames here, the live feed in the browser) and to *score*
the pipeline against ground truth. The pipeline itself never sees it: it only gets the recorded
detections and the noisy telemetry CSV, exactly like real hardware data.
NOTE: person geometry is mirrored in frontend/src/lib/scene.ts; keep the two in sync.
"""
import json
import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

from .geolocation import NadirPinholeGeolocator, distance_m, offset_latlon
from .telemetry import parse_csv, TelemetryTrack
from .detection import ReplayDetector
from .pipeline import SurvivorPipeline, run_batch, build_bundle
from . import evidence

SKIN, HAIR, MUD, LEAF = "#b07a55", "#1d1611", "#6e5236", "#2f4a22"


def _ellipse(cf, cr, sf, sr, n=14):
    return [(cf + sf * math.cos(2 * math.pi * k / n), cr + sr * math.sin(2 * math.pi * k / n)) for k in range(n)]


def person_parts(p: dict, t: float):
    """Body parts in world metres (x east, y south) at time t.
    Each part: (kind, geometry, colour, alpha, counts_for_bbox). kind: 'poly' | 'line' | 'circle'."""
    a = math.radians(p["heading"])
    f, r = (math.sin(a), -math.cos(a)), (math.cos(a), math.sin(a))
    x0, y0 = p["x"], p["y"]
    m = p.get("motion", {})
    wave = math.sin(2 * math.pi * m.get("rate", 1.0) * t) if m.get("type") == "wave" else None
    if m.get("type") == "crawl":
        off = m["amp"] * math.sin(2 * math.pi * t / m["period"])
        x0, y0 = x0 + f[0] * off, y0 + f[1] * off
    W = lambda lf, lr: (x0 + lf * f[0] + lr * r[0], y0 + lf * f[1] + lr * r[1])
    poly = lambda pts, c, al=1.0, bb=True: ("poly", [W(*q) for q in pts], c, al, bb)
    line = lambda p1, p2, w, c: ("line", (W(*p1), W(*p2), w), c, 1.0, True)
    circ = lambda q, rad, c: ("circle", (W(*q), rad), c, 1.0, True)
    shirt, pants, pose = p["shirt"], p.get("pants", "#2b2f3a"), p["pose"]
    parts = [poly(_ellipse(-0.25, 0.12, 0.85, 0.42), "#000000", 0.28, False)] if pose in ("lying", "occluded") else []

    if pose in ("lying", "occluded"):
        parts += [line((-0.28, -0.1), (-1.1, -0.16), 0.15, pants), line((-0.28, 0.1), (-1.1, 0.16), 0.15, pants),
                  poly(_ellipse(0, 0, 0.32, 0.2), shirt), line((0.2, -0.2), (-0.3, -0.3), 0.1, shirt)]
        if wave is not None:
            phi = 0.5 + 1.1 * wave
            end = (0.2 + 0.62 * math.cos(phi), 0.2 + 0.62 * math.sin(phi))
        elif m.get("type") == "crawl":
            end = (0.2 + 0.55 * (0.7 + 0.3 * math.sin(t * 2)), 0.32)
        else:
            end = (-0.3, 0.3)
        parts += [line((0.2, 0.2), end, 0.1, shirt), circ(end, 0.05, SKIN),
                  circ((0.47, 0), 0.11, SKIN), circ((0.5, 0), 0.085, HAIR)]
        if pose == "occluded":
            parts += [("circle", (W(-0.6, 0.1), 0.5), LEAF, 0.92, False), ("circle", (W(-0.1, -0.35), 0.38), "#3c5a2a", 0.9, False),
                      ("line", (W(-1.4, 0.6), W(0.4, -0.6), 0.12), "#5a4a38", 1.0, False)]
    elif pose == "sitting":
        parts += [poly(_ellipse(0.25, 0.3, 0.7, 0.4), "#000000", 0.28, False),
                  line((0, -0.1), (0.7, -0.13), 0.15, pants), line((0, 0.1), (0.7, 0.13), 0.15, pants),
                  poly(_ellipse(-0.05, 0, 0.16, 0.22), shirt)]
        for s in (-1, 1):
            if wave is not None:
                L = 0.25 + 0.4 * abs(wave)
                end = (0.05 + 0.1 * wave, s * (0.22 + L))
            else:
                end = (0.3, s * 0.18)
            parts += [line((0, s * 0.2), end, 0.1, shirt), circ(end, 0.05, SKIN)]
        parts += [circ((-0.02, 0), 0.11, HAIR)]
    elif pose == "standing":
        sd = (0.62, 0.5)  # sun from the north-west: shadows fall south-east
        sx, sy = x0 + sd[0] * 0.8, y0 + sd[1] * 0.8
        ang = math.atan2(sd[1], sd[0])
        shadow = [(sx + 0.85 * math.cos(ang) * math.cos(k) - 0.2 * math.sin(ang) * math.sin(k),
                   sy + 0.85 * math.sin(ang) * math.cos(k) + 0.2 * math.cos(ang) * math.sin(k))
                  for k in [2 * math.pi * i / 14 for i in range(14)]]
        parts += [("poly", shadow, "#000000", 0.38, False), poly(_ellipse(0, 0, 0.13, 0.23), shirt)]
        for s in (-1, 1):
            L = 0.15 + 0.45 * abs(wave) if wave is not None else 0.05
            end = (0.05, s * (0.22 + L))
            parts += [line((0, s * 0.2), end, 0.09, shirt), circ(end, 0.045, SKIN)]
        parts += [circ((0, 0), 0.1, HAIR)]
    elif pose == "buried":
        deep = p.get("deep", False)
        if not deep:
            parts += [poly(_ellipse(0.05, 0, 0.22, 0.2), shirt)]
        end = (0.2 + 0.4 * math.cos(0.9 + 0.5 * wave), 0.2 + 0.4 * math.sin(0.9 + 0.5 * wave)) if wave is not None else (0.55, 0.45)
        parts += [line((0.2, 0.2), end, 0.1, shirt), circ(end, 0.05, SKIN),
                  circ((0.4, 0), 0.11, SKIN), circ((0.43, 0), 0.085, HAIR),
                  poly(_ellipse(-0.25 if not deep else 0.0, 0, 0.36, 0.4), MUD, 1.0, False)]
    return parts


def bbox_points(parts):
    pts = []
    for kind, g, _, _, bb in parts:
        if not bb:
            continue
        if kind == "poly":
            pts += g
        elif kind == "line":
            (x1, y1), (x2, y2), w = g
            pts += [(x1 - w / 2, y1 - w / 2), (x1 + w / 2, y1 + w / 2), (x2 - w / 2, y2 - w / 2), (x2 + w / 2, y2 + w / 2)]
        else:
            (cx, cy), rad = g
            pts += [(cx - rad, cy - rad), (cx + rad, cy + rad)]
    return pts


def draw_parts(overlay: Image.Image, parts, mpp: float, ox: float = 0, oy: float = 0):
    """Draw parts onto an RGBA overlay in terrain pixels, offset by (ox, oy) pixels."""
    d = ImageDraw.Draw(overlay)
    P = lambda q: ((q[0] / mpp) - ox, (q[1] / mpp) - oy)
    for kind, g, c, al, _ in parts:
        rgb = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (int(255 * al),)
        if kind == "poly":
            d.polygon([P(q) for q in g], fill=rgb)
        elif kind == "line":
            a, b, w = g
            d.line([P(a), P(b)], fill=rgb, width=max(1, round(w / mpp)), joint="curve")
            for q in (a, b):  # round caps
                cx, cy = P(q)
                rr = w / mpp / 2
                d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=rgb)
        else:
            (q, rad) = g
            cx, cy = P(q)
            d.ellipse([cx - rad / mpp, cy - rad / mpp, cx + rad / mpp, cy + rad / mpp], fill=rgb)


class SceneFrameProvider:
    """Renders the synthetic camera frame for any frame index (the 'recorded footage')."""

    def __init__(self, scene_dir: Path, camera: dict):
        self.scene = json.loads((scene_dir / "scene.json").read_text())
        self.terrain = Image.open(scene_dir / "terrain.jpg").convert("RGB")
        self.cam = camera
        self.tan_half = math.tan(math.radians(camera["hfov_deg"]) / 2)

    def __call__(self, frame_idx: int) -> Image.Image:
        sc, W, H = self.scene, self.cam["image_width"], self.cam["image_height"]
        rows = sc["truth"]["rows"]
        t, X, Y, alt, hdg = rows[min(frame_idx, len(rows) - 1)]
        mpp = sc["m_per_px"]
        gsd = 2 * alt * self.tan_half / W
        h = math.radians(hdg)
        a, b = gsd * math.cos(h) / mpp, -gsd * math.sin(h) / mpp
        d, e = gsd * math.sin(h) / mpp, gsd * math.cos(h) / mpp
        cx, cy = X / mpp, Y / mpp
        half = math.hypot(W, H) * gsd / mpp / 2 + 4
        x0, y0 = int(cx - half), int(cy - half)
        crop = self.terrain.crop((x0, y0, int(cx + half), int(cy + half))).convert("RGBA")
        overlay = Image.new("RGBA", crop.size, (0, 0, 0, 0))
        for p in sc["persons"]:
            draw_parts(overlay, person_parts(p, t), mpp, x0, y0)
        crop.alpha_composite(overlay)
        c = cx - x0 - a * W / 2 - b * H / 2
        f = cy - y0 - d * W / 2 - e * H / 2
        return crop.convert("RGB").transform((W, H), Image.AFFINE, (a, b, c, d, e, f),
                                             resample=Image.BILINEAR, fillcolor=(24, 34, 20))


def evaluate_against_truth(survivors: list[dict], scene: dict, match_radius_m: float = 4.0) -> dict:
    """Score the pipeline against simulated ground truth (only possible in simulation)."""
    lat0, lon0 = scene["origin"]
    gt = [(p["id"], offset_latlon(lat0, lon0, p["x"], -p["y"])) for p in scene["persons"]]
    matched, errors, dups, fps = set(), [], 0, 0
    for s in survivors:
        best = min(gt, key=lambda g: distance_m((s["lat"], s["lon"]), g[1]))
        err = distance_m((s["lat"], s["lon"]), best[1])
        if err <= match_radius_m:
            s["sim_truth"] = {"person": best[0], "geo_error_m": round(err, 2)}
            if best[0] in matched:
                dups += 1
            matched.add(best[0])
            errors.append(err)
        else:
            s["sim_truth"] = {"person": None, "geo_error_m": None}  # debris / decoy
            fps += 1
    return {"ground_truth_people": len(gt), "found": len(matched), "recall": round(len(matched) / len(gt), 3),
            "duplicate_survivors": dups, "duplicate_rate": round(dups / max(1, len(survivors)), 3),
            "non_person_detections": fps,
            "mean_geo_error_m": round(sum(errors) / len(errors), 2) if errors else None,
            "max_geo_error_m": round(max(errors), 2) if errors else None}


def run_sample_mission(cfg: dict, sample_dir: Path, out_dir: Path, mission_id: str, asset_base: str) -> dict:
    """Run the full pipeline on the bundled sample data and write bundle + evidence to out_dir."""
    out_dir.mkdir(parents=True, exist_ok=True)
    samples = parse_csv((sample_dir / "telemetry.csv").read_text())
    detector = ReplayDetector(str(sample_dir / "detections.json"), cfg["detector"]["min_conf"])
    pipe = SurvivorPipeline(cfg)
    run_batch(pipe, detector, TelemetryTrack(samples), detector.total_frames, detector.fps)
    survivors = pipe.survivors()
    scene = json.loads((sample_dir / "scene.json").read_text())
    truth_eval = evaluate_against_truth(survivors, scene)

    mission = {
        "id": mission_id, "name": scene["mission_name"], "sector": scene["sector"], "area": scene["area"],
        "mode": "simulation", "status": "complete", "start_time": scene["start_time"],
        "source": {"video": "Synthetic aerial footage (rendered from scene model)", "telemetry": "telemetry.csv (replay)",
                   "detector": detector.name},
        "fps": detector.fps, "frames_total": detector.total_frames, "duration_s": detector.total_frames / detector.fps,
        "asset_base": asset_base,
    }
    bundle = build_bundle(mission, samples, pipe, survivors, pipe.geo)
    bundle["metrics"]["sim_truth"] = truth_eval
    bundle["sim"] = {k: scene[k] for k in ("origin", "m_per_px", "width_px", "height_px", "persons", "decoys",
                                             "truth", "teams", "zone", "sectors")}
    bundle["sim"]["terrain"] = "terrain.jpg"
    shutil.copyfile(sample_dir / "terrain.jpg", out_dir / "terrain.jpg")
    evidence.write_all(bundle, SceneFrameProvider(sample_dir, cfg["camera"]), out_dir)
    (out_dir / "bundle.json").write_text(json.dumps(bundle, separators=(",", ":")))
    return bundle
