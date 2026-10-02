"""Telemetry: one sample type shared by CSV replay (prototype) and MAVLink (deployment)."""
import bisect
import csv
import io
import math
from dataclasses import dataclass, asdict

REQUIRED = ["t", "lat", "lon", "alt_m", "heading_deg"]
OPTIONAL = {"speed_mps": 0.0, "gimbal_pitch_deg": -90.0, "gps_fix": 3, "sats": 0, "hdop": 1.0, "battery_pct": -1}


@dataclass
class TelemetrySample:
    t: float            # seconds since mission start (synchronised with video clock)
    lat: float
    lon: float
    alt_m: float        # height above ground at the survey area
    heading_deg: float  # 0 = north, clockwise
    speed_mps: float = 0.0
    gimbal_pitch_deg: float = -90.0
    gps_fix: int = 3    # 0/1 = no fix, 2 = 2D, 3 = 3D, 4+ = DGPS/RTK
    sats: int = 0
    hdop: float = 1.0
    battery_pct: float = -1

    def as_dict(self):
        return asdict(self)


class TelemetryError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors[:5]))
        self.errors = errors


def parse_csv(text: str) -> list[TelemetrySample]:
    """Parse and validate a telemetry CSV. Raises TelemetryError listing every problem found (max 20)."""
    reader = csv.DictReader(io.StringIO(text.strip()))
    cols = [c.strip() for c in (reader.fieldnames or [])]
    missing = [c for c in REQUIRED if c not in cols]
    if missing:
        raise TelemetryError([f"Missing required column(s): {', '.join(missing)}. Required: {', '.join(REQUIRED)}"])

    samples, errors = [], []
    for i, raw in enumerate(reader, start=2):  # row 1 is the header
        row = {k.strip(): (v or "").strip() for k, v in raw.items() if k}
        try:
            vals = {c: float(row[c]) for c in REQUIRED}
            for c, default in OPTIONAL.items():
                vals[c] = float(row[c]) if row.get(c) else default
        except ValueError:
            errors.append(f"Row {i}: non-numeric value")
            continue
        if not (-90 <= vals["lat"] <= 90 and -180 <= vals["lon"] <= 180):
            errors.append(f"Row {i}: lat/lon out of range")
        elif not (0 < vals["alt_m"] < 500):
            errors.append(f"Row {i}: alt_m {vals['alt_m']} outside (0, 500) m")
        elif samples and vals["t"] <= samples[-1].t:
            errors.append(f"Row {i}: timestamp {vals['t']} is not increasing")
        else:
            vals["gps_fix"], vals["sats"] = int(vals["gps_fix"]), int(vals["sats"])
            vals["heading_deg"] %= 360
            samples.append(TelemetrySample(**vals))
        if len(errors) >= 20:
            break
    if not samples and not errors:
        errors.append("Telemetry file contains no data rows")
    if errors:
        raise TelemetryError(errors)
    return samples


def to_csv(samples: list[TelemetrySample]) -> str:
    out = io.StringIO()
    fields = REQUIRED + list(OPTIONAL)
    w = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    w.writeheader()
    for s in samples:
        d = s.as_dict()
        w.writerow({k: (round(d[k], 7) if isinstance(d[k], float) else d[k]) for k in fields})
    return out.getvalue()


class TelemetryTrack:
    """Time-indexed telemetry with interpolation, so each video frame gets the pose at its own timestamp."""

    def __init__(self, samples: list[TelemetrySample]):
        self.samples = samples
        self.times = [s.t for s in samples]

    def append(self, s: TelemetrySample):
        self.samples.append(s)
        self.times.append(s.t)

    def at(self, t: float) -> TelemetrySample | None:
        if not self.samples:
            return None
        i = bisect.bisect_left(self.times, t)
        if i == 0:
            return self.samples[0]
        if i >= len(self.samples):
            return self.samples[-1]
        a, b = self.samples[i - 1], self.samples[i]
        if b.t - a.t > 2.0:  # telemetry gap: don't invent a pose
            return None
        f = (t - a.t) / (b.t - a.t)
        dh = ((b.heading_deg - a.heading_deg + 180) % 360) - 180
        lerp = lambda x, y: x + (y - x) * f
        return TelemetrySample(
            t=t, lat=lerp(a.lat, b.lat), lon=lerp(a.lon, b.lon), alt_m=lerp(a.alt_m, b.alt_m),
            heading_deg=(a.heading_deg + dh * f) % 360, speed_mps=lerp(a.speed_mps, b.speed_mps),
            gimbal_pitch_deg=a.gimbal_pitch_deg, gps_fix=min(a.gps_fix, b.gps_fix), sats=min(a.sats, b.sats),
            hdop=max(a.hdop, b.hdop), battery_pct=lerp(a.battery_pct, b.battery_pct),
        )


def heading_vectors(heading_deg: float):
    """(forward, right) unit vectors in (east, north)."""
    h = math.radians(heading_deg)
    return (math.sin(h), math.cos(h)), (math.cos(h), -math.sin(h))
