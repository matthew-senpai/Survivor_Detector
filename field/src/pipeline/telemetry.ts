// Telemetry: interpolation (port of backend/app/telemetry.py), CSV validation, and DJI .SRT flight logs.
import { toLocal } from "./geo";
import type { TelemetrySample } from "./types";

export class TelemetryError extends Error {
  constructor(public errors: string[]) {
    super(errors.slice(0, 5).join("; "));
  }
}

const REQUIRED = ["t", "lat", "lon", "alt_m", "heading_deg"] as const;
const OPTIONAL: Record<string, number> = { speed_mps: 0, gimbal_pitch_deg: -90, gps_fix: 3, sats: 0, hdop: 1, battery_pct: -1 };

/** Time-indexed telemetry with interpolation, so each video frame gets the pose at its own timestamp. */
export class TelemetryTrack {
  readonly samples: TelemetrySample[] = [];
  private times: number[] = [];

  constructor(samples: TelemetrySample[] = []) {
    samples.forEach((s) => this.append(s));
  }

  append(s: TelemetrySample) {
    this.samples.push(s);
    this.times.push(s.t);
  }

  get length() { return this.samples.length; }
  latest() { return this.samples[this.samples.length - 1]; }

  at(t: number): TelemetrySample | null {
    const n = this.samples.length;
    if (!n) return null;
    let lo = 0, hi = n; // bisect_left
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.times[mid] < t) lo = mid + 1; else hi = mid; }
    if (lo === 0) return this.samples[0];
    if (lo >= n) return this.samples[n - 1];
    const a = this.samples[lo - 1], b = this.samples[lo];
    if (b.t - a.t > 2.0) return null; // telemetry gap: don't invent a pose
    const f = (t - a.t) / (b.t - a.t);
    const dh = (((b.heading_deg - a.heading_deg + 180) % 360) + 360) % 360 - 180;
    const lerp = (x: number, y: number) => x + (y - x) * f;
    return {
      t, lat: lerp(a.lat, b.lat), lon: lerp(a.lon, b.lon), alt_m: lerp(a.alt_m, b.alt_m),
      heading_deg: (((a.heading_deg + dh * f) % 360) + 360) % 360, speed_mps: lerp(a.speed_mps, b.speed_mps),
      gimbal_pitch_deg: lerp(a.gimbal_pitch_deg, b.gimbal_pitch_deg), gps_fix: Math.min(a.gps_fix, b.gps_fix),
      sats: Math.min(a.sats, b.sats), hdop: Math.max(a.hdop, b.hdop), battery_pct: lerp(a.battery_pct, b.battery_pct),
    };
  }
}

/** Landsight CSV (same columns and validation messages as the backend). */
export function parseCsv(text: string): TelemetrySample[] {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  const cols = (lines.shift() ?? "").split(",").map((c) => c.trim());
  const missing = REQUIRED.filter((c) => !cols.includes(c));
  if (missing.length) throw new TelemetryError([`Missing required column(s): ${missing.join(", ")}. Required: ${REQUIRED.join(", ")}`]);
  const samples: TelemetrySample[] = [], errors: string[] = [];
  lines.forEach((line, k) => {
    if (errors.length >= 20 || !line.trim()) return;
    const i = k + 2, cells = line.split(","), row: Record<string, string> = {};
    cols.forEach((c, j) => (row[c] = (cells[j] ?? "").trim()));
    const v: Record<string, number> = {};
    for (const c of REQUIRED) v[c] = row[c] === "" ? NaN : Number(row[c]);
    for (const [c, d] of Object.entries(OPTIONAL)) v[c] = row[c] ? Number(row[c]) : d;
    if (Object.values(v).some((x) => !Number.isFinite(x))) return void errors.push(`Row ${i}: non-numeric value`);
    if (!(v.lat >= -90 && v.lat <= 90 && v.lon >= -180 && v.lon <= 180)) errors.push(`Row ${i}: lat/lon out of range`);
    else if (!(v.alt_m > 0 && v.alt_m < 500)) errors.push(`Row ${i}: alt_m ${v.alt_m} outside (0, 500) m`);
    else if (samples.length && v.t <= samples[samples.length - 1].t) errors.push(`Row ${i}: timestamp ${v.t} is not increasing`);
    else samples.push({ ...(v as unknown as TelemetrySample), gps_fix: Math.trunc(v.gps_fix), sats: Math.trunc(v.sats), heading_deg: ((v.heading_deg % 360) + 360) % 360 });
  });
  if (!samples.length && !errors.length) errors.push("Telemetry file contains no data rows");
  if (errors.length) throw new TelemetryError(errors);
  return samples;
}

export interface SrtResult { samples: TelemetrySample[]; headingSource: "gimbal" | "course" | "default"; focal35: number | null; notes: string[] }

/**
 * DJI flight-record subtitles (.SRT), recorded next to the video by most DJI drones.
 * Handles the bracketed key:value format (Mini 2/3/4, Air 2/2S/3, Mavic 3, enterprise models with gb_yaw/gb_pitch)
 * and the older "GPS (lon, lat, ..) ... H 12.3m" format (Mavic 2 / Phantom 4).
 * Most consumer DJI logs carry no heading: it is then estimated from the flight path (course over ground).
 */
export function parseDjiSrt(text: string, defaults: { heading_deg: number; gimbal_pitch_deg: number }): SrtResult {
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
  const raw: { t: number; lat: number; lon: number; alt: number; yaw: number | null; pitch: number | null }[] = [];
  let focal35: number | null = null;
  for (const b of blocks) {
    const tm = b.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->/);
    if (!tm) continue;
    const t = +tm[1] * 3600 + +tm[2] * 60 + +tm[3] + +tm[4] / 1000;
    const body = b.replace(/<[^>]+>/g, " ");
    const kv: Record<string, number> = {};
    for (const m of body.matchAll(/([a-zA-Z_]+)\s*:\s*(-?\d+(?:\.\d+)?)/g)) kv[m[1].toLowerCase()] = Number(m[2]);
    let lat = kv.latitude, lon = kv.longitude ?? kv.longtitude;
    let alt = kv.rel_alt ?? kv.altitude ?? kv.h;
    const gps = body.match(/GPS\s*\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)(?:\s*,\s*(-?\d+(?:\.\d+)?))?\s*\)/);
    if ((lat === undefined || lon === undefined) && gps) { lon = +gps[1]; lat = +gps[2]; }
    const hm = body.match(/\bH\s+(-?\d+(?:\.\d+)?)\s*m\b/);
    if (alt === undefined && hm) alt = +hm[1];
    if (kv.focal_len && !focal35) focal35 = kv.focal_len > 100 ? kv.focal_len / 10 : kv.focal_len; // Mini 2 logs 240 = 24.0 mm
    if (lat === undefined || lon === undefined || alt === undefined) continue;
    raw.push({ t, lat, lon, alt, yaw: kv.gb_yaw ?? null, pitch: kv.gb_pitch ?? null });
  }
  if (!raw.length) throw new TelemetryError(["No GPS position found in this .SRT file (unsupported format, or the drone recorded without GPS)."]);

  // decimate to <= 10 Hz (DJI writes one entry per video frame)
  const pts = raw.filter((r, i) => i === 0 || r.t - raw[i - 1].t > 0 && Math.floor(r.t * 10) !== Math.floor(raw[i - 1].t * 10));
  const hasYaw = pts.some((p) => p.yaw !== null);
  const notes: string[] = [];
  const noFix = pts.filter((p) => p.lat === 0 && p.lon === 0).length; // no GPS lock
  if (noFix) notes.push(`${noFix} entries without a GPS lock were marked "no fix".`);

  // course over ground for logs without a heading (entries without a GPS lock are logged as 0,0: never use them)
  const noLock = (p: { lat: number; lon: number }) => p.lat === 0 && p.lon === 0;
  const course: (number | null)[] = pts.map(() => null);
  if (!hasYaw) {
    let j = 0;
    for (let i = 1; i < pts.length; i++) {
      if (noLock(pts[i])) continue;
      while (j < i && (pts[i].t - pts[j].t > 2 || noLock(pts[j]))) j++;
      const [e, n] = toLocal(pts[i].lat, pts[i].lon, [pts[j].lat, pts[j].lon]);
      if (Math.hypot(e, n) > 1.5) course[i] = ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360;
    }
  }
  let last: number | null = course.find((c) => c !== null) ?? null;
  const samples: TelemetrySample[] = pts.map((p, i) => {
    if (course[i] !== null) last = course[i];
    const heading = p.yaw !== null ? ((p.yaw % 360) + 360) % 360 : last ?? defaults.heading_deg;
    const prev = pts[Math.max(0, i - 1)];
    const [de, dn] = noLock(p) || noLock(prev) ? [0, 0] : toLocal(p.lat, p.lon, [prev.lat, prev.lon]);
    const fix = noLock(p) ? 0 : 3;
    return {
      t: p.t, lat: p.lat, lon: p.lon, alt_m: Math.max(0.1, p.alt), heading_deg: heading,
      speed_mps: i ? Math.hypot(de, dn) / Math.max(1e-3, p.t - prev.t) : 0,
      gimbal_pitch_deg: p.pitch ?? defaults.gimbal_pitch_deg, gps_fix: fix, sats: fix ? 10 : 0, hdop: fix ? 1.2 : 99, battery_pct: -1,
    };
  });
  const headingSource = hasYaw ? "gimbal" : course.some((c) => c !== null) ? "course" : "default";
  if (headingSource === "course") notes.push("No heading in this log: camera heading estimated from the flight path. Accurate only when flying forward.");
  if (headingSource === "default") notes.push("No heading in this log and the drone barely moved: using the heading you set.");
  if (!pts.some((p) => p.pitch !== null)) notes.push(`No gimbal angle in this log: using ${defaults.gimbal_pitch_deg}°.`);
  notes.push("Altitude is relative to the take-off point; on slopes, set an altitude offset.");
  return { samples, headingSource, focal35, notes };
}
