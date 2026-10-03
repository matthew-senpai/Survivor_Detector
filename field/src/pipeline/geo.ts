// Geolocation: image pixel + drone pose -> ground coordinate (port of backend/app/geolocation.py,
// extended with gimbal pitch so oblique footage is handled, not just straight-down).
import type { TelemetrySample } from "./types";

export const M_PER_DEG_LAT = 111320;
const RAD = Math.PI / 180;

export function offsetLatLon(lat: number, lon: number, east: number, north: number): [number, number] {
  return [lat + north / M_PER_DEG_LAT, lon + east / (M_PER_DEG_LAT * Math.cos(lat * RAD))];
}

export function toLocal(lat: number, lon: number, origin: [number, number]): [number, number] {
  const [lat0, lon0] = origin;
  return [(lon - lon0) * M_PER_DEG_LAT * Math.cos(lat0 * RAD), (lat - lat0) * M_PER_DEG_LAT];
}

export function distanceM(a: [number, number], b: [number, number]) {
  const [e, n] = toLocal(b[0], b[1], a);
  return Math.hypot(e, n);
}

/** 35 mm-equivalent focal length -> horizontal field of view (36 mm wide frame). */
export const hfovFromFocal35 = (mm: number) => (2 * Math.atan(36 / (2 * mm))) / RAD;

/**
 * Pinhole camera on a gimbal, flat ground at the drone's height above ground.
 * pitch -90 = nadir (identical to the backend's NadirPinholeGeolocator); larger pitches look ahead.
 * Rays at or above the horizon have no ground intersection and return null.
 */
export class Camera {
  readonly f: number; // focal length in pixels
  constructor(readonly W: number, readonly H: number, readonly hfovDeg: number) {
    this.f = W / 2 / Math.tan((hfovDeg * RAD) / 2);
  }

  /** Ground offset (east, north, metres) and effective ground sample distance (m/px) for a pixel. */
  pixelToOffset(u: number, v: number, pose: TelemetrySample): { east: number; north: number; gsd: number } | null {
    const th = (pose.gimbal_pitch_deg ?? -90) * RAD;
    const xc = (u - this.W / 2) / this.f, yc = (v - this.H / 2) / this.f;
    const fwd = Math.cos(th) + yc * Math.sin(th);
    const right = xc;
    const down = -Math.sin(th) + yc * Math.cos(th);
    if (down <= 1e-6 || pose.alt_m <= 0) return null;
    const s = pose.alt_m / down;
    const fwdM = s * fwd, rightM = s * right;
    const h = pose.heading_deg * RAD;
    return {
      east: rightM * Math.cos(h) + fwdM * Math.sin(h),
      north: -rightM * Math.sin(h) + fwdM * Math.cos(h),
      gsd: s / this.f, // s = depth along the optical axis; equals alt/f (backend value) when nadir
    };
  }

  locate(u: number, v: number, pose: TelemetrySample): { lat: number; lon: number; gsd: number } | null {
    const o = this.pixelToOffset(u, v, pose);
    if (!o) return null;
    const [lat, lon] = offsetLatLon(pose.lat, pose.lon, o.east, o.north);
    return { lat, lon, gsd: o.gsd };
  }

  /** Ground footprint polygon (lat/lon). Corners above the horizon are clipped to a 300 m range. */
  footprint(pose: TelemetrySample): [number, number][] {
    const pts: [number, number][] = [];
    for (const [u, v] of [[0, 0], [this.W, 0], [this.W, this.H], [0, this.H]]) {
      let vv = v, o = this.pixelToOffset(u, vv, pose);
      while (!o && vv < this.H) { vv += this.H / 20; o = this.pixelToOffset(u, vv, pose); }
      if (!o) continue;
      const r = Math.hypot(o.east, o.north), k = r > 300 ? 300 / r : 1;
      pts.push(offsetLatLon(pose.lat, pose.lon, o.east * k, o.north * k));
    }
    return pts;
  }
}
