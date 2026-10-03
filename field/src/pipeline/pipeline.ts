// Frame-by-frame survivor pipeline (port of backend/app/pipeline.py). Identical for live drones and recordings:
//   frame + pose -> detections -> geolocate -> track -> analyse + dedup -> prioritise
import { buildSurvivors, round } from "./analysis";
import { PIPELINE, type PipelineConfig } from "./config";
import { Camera, toLocal } from "./geo";
import { GroundTracker, ImageTracker, type Observation } from "./tracking";
import type { Detection, FrameDet, Survivor, TelemetrySample } from "./types";

export interface PipelineStats {
  frames_processed: number;
  raw_detections: number;
  detections_without_location: number;
}

export class SurvivorPipeline {
  readonly tracker: GroundTracker | ImageTracker;
  origin: [number, number] | null = null;
  readonly frames: [number, FrameDet[]][] = [];
  readonly stats: PipelineStats = { frames_processed: 0, raw_detections: 0, detections_without_location: 0 };
  readonly warnings: string[] = [];

  /** geo = true when the mission has drone telemetry; false = detection-only (image-space tracking). */
  constructor(readonly geo: boolean, readonly cfg: PipelineConfig = PIPELINE) {
    this.tracker = geo ? new GroundTracker(cfg.tracker) : new ImageTracker(cfg.tracker);
  }

  private warn(msg: string) {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }

  /** Returns the track id assigned to each detection (null = not tracked). */
  processFrame(frame: number, t: number, dets: Detection[], pose: TelemetrySample | null, camera: Camera): (number | null)[] {
    this.stats.frames_processed++;
    this.stats.raw_detections += dets.length;
    if (!dets.length) return [];
    let ids: (number | null)[];
    if (!this.geo) {
      const obs: Observation[] = dets.map((d) => ({
        frame, t: round(t, 3), conf: d.conf, bbox: [d.x1, d.y1, d.x2, d.y2], e: (d.x1 + d.x2) / 2, n: (d.y1 + d.y2) / 2,
        lat: null, lon: null, gsd: 1, hdop: 0, alt: 0,
      }));
      ids = this.tracker.update(frame, obs);
    } else if (!pose || pose.gps_fix < 2) {
      // GPS/telemetry unavailable: keep the detection as evidence but don't invent a location
      this.stats.detections_without_location += dets.length;
      this.warn("GPS/telemetry unavailable for some frames: those detections were kept but not geolocated.");
      ids = dets.map(() => null);
    } else {
      const obs: Observation[] = [], idx: number[] = [];
      dets.forEach((d, i) => {
        const g = camera.locate((d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2, pose);
        if (!g) { this.stats.detections_without_location++; this.warn("Some detections were above the horizon (camera tilted up) and could not be geolocated."); return; }
        if (!this.origin) this.origin = [pose.lat, pose.lon];
        const [e, n] = toLocal(g.lat, g.lon, this.origin);
        obs.push({ frame, t: round(t, 3), conf: d.conf, bbox: [d.x1, d.y1, d.x2, d.y2], e, n, lat: g.lat, lon: g.lon, gsd: g.gsd, hdop: pose.hdop, alt: pose.alt_m });
        idx.push(i);
      });
      const tids = this.tracker.update(frame, obs);
      ids = dets.map(() => null);
      idx.forEach((i, k) => (ids[i] = tids[k]));
    }
    this.frames.push([frame, dets.map((d, i) => [round(d.x1, 1), round(d.y1, 1), round(d.x2, 1), round(d.y2, 1), round(d.conf, 3), ids[i]])]);
    return ids;
  }

  survivors(): Survivor[] {
    return buildSurvivors(this.tracker.confirmed(), this.cfg, this.geo);
  }
}
