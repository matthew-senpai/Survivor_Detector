// ByteTrack-style two-stage tracking. GroundTracker is a port of backend/app/tracking.py (association by
// ground distance, which compensates for drone motion). ImageTracker is the fallback for footage without
// telemetry: same two stages, associating by box overlap / centre distance in the image.
import type { PipelineConfig } from "./config";

export interface Observation {
  frame: number; t: number; conf: number; bbox: [number, number, number, number];
  e: number; n: number; lat: number | null; lon: number | null; gsd: number; hdop: number; alt: number;
}

export interface Track { id: number; e: number; n: number; lastFrame: number; obs: Observation[]; confirmedT: number | null }

type Cfg = PipelineConfig["tracker"];

abstract class TwoStageTracker {
  tracks: Track[] = [];
  private next = 1;
  constructor(protected cfg: Cfg) {}

  /** Cost (lower = better) of assigning observation o to track tr, or null when outside the gate. */
  protected abstract cost(tr: Track, o: Observation, frame: number): number | null;

  private match(tracks: Track[], dets: [number, Observation][], frame: number): [number, number][] {
    const pairs: [number, number, number][] = [];
    tracks.forEach((tr, ti) => dets.forEach(([, d], di) => {
      const c = this.cost(tr, d, frame);
      if (c !== null) pairs.push([c, ti, di]);
    }));
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const usedT = new Set<number>(), usedD = new Set<number>(), out: [number, number][] = [];
    for (const [, ti, di] of pairs) {
      if (!usedT.has(ti) && !usedD.has(di)) { usedT.add(ti); usedD.add(di); out.push([ti, di]); }
    }
    return out;
  }

  private add(tr: Track, o: Observation) {
    tr.e += (o.e - tr.e) * this.cfg.ema;
    tr.n += (o.n - tr.n) * this.cfg.ema;
    tr.lastFrame = o.frame;
    tr.obs.push(o);
    if (tr.confirmedT === null && tr.obs.length >= this.cfg.min_hits) tr.confirmedT = o.t;
  }

  update(frame: number, obs: Observation[]): (number | null)[] {
    const active = this.tracks.filter((t) => frame - t.lastFrame <= this.cfg.max_age_frames);
    const ids: (number | null)[] = obs.map(() => null);
    const high = obs.map((o, i) => [i, o] as [number, Observation]).filter(([, o]) => o.conf >= this.cfg.high_thresh);
    const low = obs.map((o, i) => [i, o] as [number, Observation]).filter(([, o]) => o.conf >= this.cfg.low_thresh && o.conf < this.cfg.high_thresh);
    const matched = new Set<number>();
    for (const stage of [high, low]) {
      const pool = active.filter((t) => !matched.has(t.id));
      for (const [ti, di] of this.match(pool, stage, frame)) {
        const tr = pool[ti], [oi, o] = stage[di];
        this.add(tr, o);
        matched.add(tr.id);
        ids[oi] = tr.id;
      }
    }
    obs.forEach((o, i) => {
      if (ids[i] === null && o.conf >= this.cfg.new_track_thresh) {
        const tr: Track = { id: this.next++, e: o.e, n: o.n, lastFrame: frame, obs: [], confirmedT: null };
        this.add(tr, o);
        this.tracks.push(tr);
        ids[i] = tr.id;
      }
    });
    return ids;
  }

  confirmed() { return this.tracks.filter((t) => t.confirmedT !== null); }
}

export class GroundTracker extends TwoStageTracker {
  protected cost(tr: Track, d: Observation, frame: number) {
    const gate = this.cfg.gate_m + 0.1 * (frame - tr.lastFrame); // widen slightly while a track coasts
    const dist = Math.hypot(tr.e - d.e, tr.n - d.n);
    return dist <= gate ? dist : null;
  }
}

/** Image-space association for footage without telemetry. Observations carry box centres in e/n (pixels, y down). */
export class ImageTracker extends TwoStageTracker {
  protected cost(tr: Track, d: Observation, frame: number) {
    const last = tr.obs[tr.obs.length - 1].bbox;
    const iou = boxIou(last, d.bbox);
    const size = Math.max(last[2] - last[0], last[3] - last[1], d.bbox[2] - d.bbox[0], d.bbox[3] - d.bbox[1]);
    const dist = Math.hypot(tr.e - d.e, tr.n - d.n) / Math.max(1, size);
    const gate = 1.5 + 0.2 * (frame - tr.lastFrame); // centre may move up to ~1.5 box sizes per processed frame
    if (iou <= 0 && dist > gate) return null;
    return 1 - iou + 0.25 * dist;
  }
}

export function boxIou(a: number[], b: number[]) {
  const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = iw * ih, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return u > 0 ? inter / u : 0;
}
