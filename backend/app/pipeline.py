"""The survivor-detection pipeline. Identical for simulation and deployment:

    frame + pose -> detect -> geolocate -> track -> (end/snapshot) analyse + dedup -> prioritise -> records

Simulation feeds it recorded video/detections + CSV telemetry; deployment feeds it an RTSP/CSI
camera + MAVLink telemetry (see app/edge.py). Nothing downstream knows the difference.
"""
import time

import numpy as np

from .analysis import build_survivors
from .geolocation import NadirPinholeGeolocator, to_local
from .telemetry import TelemetrySample, TelemetryTrack
from .tracking import GroundTracker, Observation


class SurvivorPipeline:
    def __init__(self, cfg: dict, geolocator=None):
        self.cfg = cfg
        self.geo = geolocator or NadirPinholeGeolocator(**cfg["camera"])
        self.tracker = GroundTracker(**cfg["tracker"])
        self.origin: tuple[float, float] | None = None
        self.frames: list[list] = []  # [frame_idx, [[x1, y1, x2, y2, conf, track_id], ...]]
        self.stats = {"frames_processed": 0, "raw_detections": 0, "detections_without_location": 0,
                      "processing_s": 0.0}
        self.warnings: list[str] = []

    def _warn(self, msg):
        if msg not in self.warnings:
            self.warnings.append(msg)

    def process_frame(self, frame_idx: int, t: float, dets, pose: TelemetrySample | None):
        t0 = time.perf_counter()
        self.stats["frames_processed"] += 1
        self.stats["raw_detections"] += len(dets)
        if not dets:
            self.stats["processing_s"] += time.perf_counter() - t0
            return
        if pose is None or pose.gps_fix < 2:
            # GPS/telemetry unavailable: keep the detection as evidence but don't invent a location.
            self.stats["detections_without_location"] += len(dets)
            self._warn("GPS/telemetry unavailable for some frames: those detections were kept but not geolocated.")
            ids = [None] * len(dets)
        else:
            if self.origin is None:
                self.origin = (pose.lat, pose.lon)
            gsd = self.geo.gsd(pose)
            obs = []
            for d in dets:
                lat, lon = self.geo.locate(*d.center, pose)
                e, n = to_local(lat, lon, self.origin)
                obs.append(Observation(frame_idx, round(t, 3), d.conf, (d.x1, d.y1, d.x2, d.y2),
                                       e, n, lat, lon, gsd, pose.hdop, pose.alt_m))
            ids = self.tracker.update(frame_idx, obs)
        self.frames.append([frame_idx, [[round(d.x1, 1), round(d.y1, 1), round(d.x2, 1), round(d.y2, 1),
                                         round(d.conf, 3), tid] for d, tid in zip(dets, ids)]])
        self.stats["processing_s"] += time.perf_counter() - t0

    def survivors(self) -> list[dict]:
        survivors = build_survivors(self.tracker.confirmed(), self.cfg)
        if not survivors:
            self._warn("No survivors detected in this footage.")
        return survivors


def run_batch(pipeline: SurvivorPipeline, detector, telemetry: TelemetryTrack, total_frames: int, fps: float,
              frame_source=None):
    """Offline run over recorded footage. frame_source(frame_idx) -> image, or None for replayed detections."""
    for i in range(total_frames):
        t = i / fps
        image = frame_source(i) if frame_source else None
        t0 = time.perf_counter()
        dets = detector.detect(i, image)
        pipeline.stats["processing_s"] += time.perf_counter() - t0  # throughput includes inference
        pipeline.process_frame(i, t, dets, telemetry.at(t))


def coverage_series(samples: list[TelemetrySample], geo: NadirPinholeGeolocator, stride: int = 5) -> list[float]:
    """Cumulative ground area (m²) imaged up to each telemetry sample, on a 1 m grid."""
    if not samples:
        return []
    origin = (samples[0].lat, samples[0].lon)
    pos = np.array([to_local(s.lat, s.lon, origin) for s in samples])
    reach = max(geo.footprint_m(s)[0] for s in samples)
    lo, hi = pos.min(0) - reach, pos.max(0) + reach
    ge, gn = np.meshgrid(np.arange(lo[0], hi[0]), np.arange(lo[1], hi[1]))
    seen = np.zeros(ge.shape, bool)
    out, area = [], 0.0
    for i, s in enumerate(samples):
        if i % stride == 0:
            w, h = geo.footprint_m(s)
            hr = np.radians(s.heading_deg)
            de, dn = ge - pos[i, 0], gn - pos[i, 1]
            fwd = de * np.sin(hr) + dn * np.cos(hr)
            right = de * np.cos(hr) - dn * np.sin(hr)
            seen |= (np.abs(right) <= w / 2) & (np.abs(fwd) <= h / 2)
            area = float(seen.sum())
        out.append(area)
    return out


def build_bundle(mission: dict, samples: list[TelemetrySample], pipeline: SurvivorPipeline,
                 survivors: list[dict], geo: NadirPinholeGeolocator) -> dict:
    """Everything the command center needs to replay a mission, in one JSON document."""
    track_to_survivor = {tid: s["id"] for s in survivors for tid in s["track_ids"]}
    frames = [[f, [d + [track_to_survivor.get(d[5])] for d in dets]] for f, dets in pipeline.frames]
    cov = coverage_series(samples, geo)
    cols = ["t", "lat", "lon", "alt_m", "heading_deg", "speed_mps", "gps_fix", "sats", "hdop", "battery_pct",
            "coverage_m2"]
    rows = [[round(s.t, 2), round(s.lat, 7), round(s.lon, 7), round(s.alt_m, 2), round(s.heading_deg, 1),
             round(s.speed_mps, 2), s.gps_fix, s.sats, round(s.hdop, 2), round(s.battery_pct, 1), round(c)]
            for s, c in zip(samples, cov)]
    st = pipeline.stats
    tracks = pipeline.tracker.confirmed()
    counts = {lvl: sum(1 for s in survivors if s["priority"]["level"] == lvl) for lvl in ("HIGH", "MEDIUM", "LOW")}
    metrics = {
        **{k: v for k, v in st.items() if k != "processing_s"},
        "pipeline_fps": round(st["frames_processed"] / st["processing_s"], 1) if st["processing_s"] else None,
        "confirmed_tracks": len(tracks),
        "unique_survivors": len(survivors),
        "duplicates_suppressed": len(tracks) - len(survivors),
        "priority_counts": counts,
        "area_scanned_m2": cov[-1] if cov else 0,
    }
    return {"mission": mission, "camera": pipeline.cfg["camera"], "telemetry": {"cols": cols, "rows": rows},
            "frames": frames, "survivors": survivors, "metrics": metrics, "warnings": pipeline.warnings,
            "targets": pipeline.cfg["targets"]}
