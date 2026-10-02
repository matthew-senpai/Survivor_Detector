import type { Bundle, Det, Priority, Survivor } from "./types";

export const PRIORITY_COLOR: Record<Priority, string> = { HIGH: "#ff4d3d", MEDIUM: "#ffb020", LOW: "#78beff" };
export const STATUS_LABEL = { new: "New", verified: "Verified", dispatched: "Team dispatched", rescued: "Rescued", false_positive: "False positive" } as const;

export const asset = (b: Bundle, path: string) => b.mission.asset_base + path;

function bsearch(arr: number[][], t: number) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid][0] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

const lerpAngle = (a: number, b: number, f: number) => (a + ((((b - a + 540) % 360) - 180) * f) + 360) % 360;

export interface TelemetryNow {
  t: number; lat: number; lon: number; alt_m: number; heading_deg: number; speed_mps: number;
  gps_fix: number; sats: number; hdop: number; battery_pct: number; coverage_m2: number;
}

/** Telemetry sample at mission time t (recorded data, as the operator sees it). */
export function telemetryAt(b: Bundle, t: number): TelemetryNow | null {
  const rows = b.telemetry.rows;
  if (!rows.length) return null;
  const i = bsearch(rows, t);
  const o: Record<string, number> = {};
  b.telemetry.cols.forEach((c, k) => (o[c] = rows[i][k]));
  return o as unknown as TelemetryNow;
}

/** True camera pose (simulation only): what the synthetic camera actually saw. */
export function truthAt(b: Bundle, t: number) {
  const rows = b.sim!.truth.rows;
  const fi = Math.max(0, Math.min(rows.length - 1.001, t * b.mission.fps));
  const i = Math.floor(fi), f = fi - i;
  const a = rows[i], c = rows[Math.min(i + 1, rows.length - 1)];
  return { x: a[1] + (c[1] - a[1]) * f, y: a[2] + (c[2] - a[2]) * f, alt: a[3] + (c[3] - a[3]) * f, heading: lerpAngle(a[4], c[4], f) };
}

export interface Derived {
  frames: Map<number, Det[]>;
  cumDetections: Int32Array;
  survivorsByTime: Survivor[];
  events: { t: number; kind: string; text: string; survivor?: string; level?: Priority }[];
  firstDetection: number;
  firstTrack: number;
}

const cache = new WeakMap<Bundle, Derived>();

/** Indexes computed once per bundle. */
export function derive(b: Bundle): Derived {
  const hit = cache.get(b);
  if (hit) return hit;
  const frames = new Map<number, Det[]>(b.frames);
  const cum = new Int32Array(b.mission.frames_total + 1);
  for (const [f, dets] of b.frames) cum[f] += dets.length;
  for (let i = 1; i < cum.length; i++) cum[i] += cum[i - 1];
  const fps = b.mission.fps;
  const events: Derived["events"] = [];
  const seenTracks = new Set<number>();
  let firstTrack = Infinity;
  for (const [f, dets] of b.frames) {
    for (const d of dets) {
      if (d[5] != null && !seenTracks.has(d[5])) {
        seenTracks.add(d[5]);
        firstTrack = Math.min(firstTrack, f / fps);
        events.push({ t: f / fps, kind: "track", text: `TRK ${String(d[5]).padStart(2, "0")} acquired · conf ${(d[4] * 100).toFixed(0)}%` });
      }
    }
  }
  for (const s of b.survivors) {
    events.push({
      t: s.confirmed_t, kind: "survivor", survivor: s.id, level: s.priority.level,
      text: `${s.id} confirmed · ${s.priority.level} · ${(s.confidence * 100).toFixed(0)}% · ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`,
    });
  }
  let prevFix = 3;
  const fixCol = b.telemetry.cols.indexOf("gps_fix");
  for (const row of b.telemetry.rows) {
    const fix = row[fixCol];
    if ((fix < 2) !== (prevFix < 2)) events.push({ t: row[0], kind: "gps", text: fix < 2 ? "GPS fix lost: geolocation paused" : "GPS 3D fix regained" });
    prevFix = fix;
  }
  events.sort((x, y) => x.t - y.t);
  const d: Derived = {
    frames, cumDetections: cum, events,
    survivorsByTime: [...b.survivors].sort((x, y) => x.confirmed_t - y.confirmed_t),
    firstDetection: b.frames.length ? b.frames[0][0] / fps : Infinity,
    firstTrack,
  };
  cache.set(b, d);
  return d;
}

export function visibleSurvivors(b: Bundle, t: number) {
  return derive(b).survivorsByTime.filter((s) => s.confirmed_t <= t);
}

export function statsAt(b: Bundle, t: number) {
  const d = derive(b);
  const frame = Math.min(b.mission.frames_total, Math.floor(t * b.mission.fps));
  const vis = visibleSurvivors(b, t);
  const count = (lvl: Priority) => vis.filter((s) => s.priority.level === lvl).length;
  return {
    detections: d.cumDetections[Math.min(frame, d.cumDetections.length - 1)],
    survivors: vis.length,
    high: count("HIGH"), medium: count("MEDIUM"), low: count("LOW"),
    areaM2: telemetryAt(b, t)?.coverage_m2 ?? 0,
    frames: frame,
  };
}

export const fmtCoord = (v: number, digits = 6) => v.toFixed(digits);
export function fmtUtc(b: Bundle, t: number, withDate = false) {
  const d = new Date(new Date(b.mission.start_time).getTime() + t * 1000);
  const iso = d.toISOString();
  return withDate ? iso.replace("T", " ").slice(0, 19) + "Z" : iso.slice(11, 19) + "Z";
}
export const fmtT = (t: number) => `T+${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
export const fmtArea = (m2: number) => (m2 >= 1000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2).toLocaleString()} m²`);
