"""Multi-object tracker: ByteTrack-style two-stage association, done in the ground plane.

A drone camera moves ~1 m per frame, so image-space IoU between frames collapses for small,
distant people (this is why BoT-SORT adds camera-motion compensation). We compensate with
telemetry instead: every detection is geolocated first, then associated by ground distance.
Stage 1 matches confident detections, stage 2 lets low-confidence detections (partly buried,
occluded) keep an existing track alive, exactly as in ByteTrack.
"""
from dataclasses import dataclass, field


@dataclass
class Observation:
    frame: int
    t: float
    conf: float
    bbox: tuple[float, float, float, float]
    e: float          # local east (m) from mission origin
    n: float          # local north (m)
    lat: float
    lon: float
    gsd: float
    hdop: float
    alt: float


@dataclass
class Track:
    id: int
    e: float
    n: float
    last_frame: int
    obs: list[Observation] = field(default_factory=list)
    confirmed_t: float | None = None


class GroundTracker:
    def __init__(self, high_thresh=0.5, low_thresh=0.15, new_track_thresh=0.3, gate_m=1.6,
                 max_age_frames=15, min_hits=3, ema=0.35, **_):
        self.high, self.low, self.new = high_thresh, low_thresh, new_track_thresh
        self.gate, self.max_age, self.min_hits, self.ema = gate_m, max_age_frames, min_hits, ema
        self.tracks: list[Track] = []
        self._next = 1

    def _match(self, tracks, dets, frame):
        pairs = []
        for ti, tr in enumerate(tracks):
            gate = self.gate + 0.1 * (frame - tr.last_frame)  # widen slightly while a track coasts
            for di, (_, d) in enumerate(dets):
                dist = ((tr.e - d.e) ** 2 + (tr.n - d.n) ** 2) ** 0.5
                if dist <= gate:
                    pairs.append((dist, ti, di))
        used_t, used_d, out = set(), set(), []
        for _, ti, di in sorted(pairs):  # ponytail: greedy nearest-first, Hungarian if crowds get dense
            if ti not in used_t and di not in used_d:
                used_t.add(ti)
                used_d.add(di)
                out.append((ti, di))
        return out

    def _add(self, tr: Track, o: Observation):
        tr.e += (o.e - tr.e) * self.ema
        tr.n += (o.n - tr.n) * self.ema
        tr.last_frame = o.frame
        tr.obs.append(o)
        if tr.confirmed_t is None and len(tr.obs) >= self.min_hits:
            tr.confirmed_t = o.t

    def update(self, frame: int, obs: list[Observation]) -> list[int | None]:
        """Associate this frame's observations; returns the track id for each (None = discarded)."""
        active = [t for t in self.tracks if frame - t.last_frame <= self.max_age]
        ids: list[int | None] = [None] * len(obs)
        high = [(i, o) for i, o in enumerate(obs) if o.conf >= self.high]
        low = [(i, o) for i, o in enumerate(obs) if self.low <= o.conf < self.high]

        matched_tracks = set()
        for stage_dets in (high, low):
            pool = [t for t in active if t.id not in matched_tracks]
            for ti, di in self._match(pool, stage_dets, frame):
                tr, (oi, o) = pool[ti], stage_dets[di]
                self._add(tr, o)
                matched_tracks.add(tr.id)
                ids[oi] = tr.id

        for i, o in enumerate(obs):
            if ids[i] is None and o.conf >= self.new:
                tr = Track(self._next, o.e, o.n, frame)
                self._next += 1
                self._add(tr, o)
                self.tracks.append(tr)
                ids[i] = tr.id
        return ids

    def confirmed(self) -> list[Track]:
        return [t for t in self.tracks if t.confirmed_t is not None]
