// The browser pipeline must reproduce the Python backend exactly on the same inputs
// (fixture: field/scripts/make_fixtures.py running backend SurvivorPipeline on the sample mission).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PIPELINE } from "../src/pipeline/config";
import { Camera, offsetLatLon } from "../src/pipeline/geo";
import { SurvivorPipeline } from "../src/pipeline/pipeline";
import { parseCsv, TelemetryTrack } from "../src/pipeline/telemetry";
import type { Detection } from "../src/pipeline/types";

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

describe("pipeline parity with backend", () => {
  const expected = JSON.parse(read("field/tests/fixtures/pipeline_expected.json"));
  const det = JSON.parse(read("data/sample/detections.json"));
  const cfg = JSON.parse(read("config/pipeline.json"));
  const track = new TelemetryTrack(parseCsv(read("data/sample/telemetry.csv")));
  const cam = new Camera(cfg.camera.image_width, cfg.camera.image_height, cfg.camera.hfov_deg);
  const byFrame = new Map<number, Detection[]>(det.frames.map((f: { i: number; dets: { bbox: number[]; conf: number }[] }) =>
    [f.i, f.dets.filter((d) => d.conf >= cfg.detector.min_conf).map((d) => ({ x1: d.bbox[0], y1: d.bbox[1], x2: d.bbox[2], y2: d.bbox[3], conf: d.conf }))]));
  const pipe = new SurvivorPipeline(true);
  for (let i = 0; i < det.total_frames; i++) pipe.processFrame(i, i / det.fps, byFrame.get(i) ?? [], track.at(i / det.fps), cam);
  const got = pipe.survivors();

  it("uses the same thresholds as config/pipeline.json", () => {
    for (const k of ["tracker", "dedup", "movement", "location", "priority"] as const) expect(PIPELINE[k]).toEqual(cfg[k]);
  });

  it("assigns identical track ids frame by frame", () => {
    expect(pipe.frames.length).toBe(expected.frames.length);
    pipe.frames.forEach(([f, dets], i) => {
      expect(f).toBe(expected.frames[i][0]);
      dets.forEach((d, j) => {
        const e = expected.frames[i][1][j];
        d.slice(0, 5).forEach((v, k) => expect(v as number).toBeCloseTo(e[k], 6));
        expect(d[5]).toBe(e[5]);
      });
    });
    expect(pipe.tracker.confirmed().length).toBe(expected.confirmed_tracks);
    expect(pipe.stats).toEqual(expected.stats);
  });

  it("produces the same survivors, locations and priorities", () => {
    expect(got.length).toBe(expected.survivors.length);
    got.forEach((s, i) => {
      const e = expected.survivors[i];
      expect(s.id).toBe(e.id);
      expect(s.track_ids).toEqual(e.track_ids);
      for (const k of ["lat", "lon"] as const) expect(s[k]!).toBeCloseTo(e[k], 7);
      for (const k of ["e", "n", "uncertainty_m"] as const) expect(s[k]!).toBeCloseTo(e[k], 2);
      for (const k of ["confidence", "max_confidence"] as const) expect(s[k]).toBeCloseTo(e[k], 3);
      expect(s.location_confidence).toBe(e.location_confidence);
      expect([s.observations, s.passes, s.persistence_s, s.first_seen_t, s.last_seen_t, s.confirmed_t])
        .toEqual([e.observations, e.passes, e.persistence_s, e.first_seen_t, e.last_seen_t, e.confirmed_t]);
      expect(s.movement.detected).toBe(e.movement.detected);
      expect(s.movement.kind).toBe(e.movement.kind);
      expect(s.movement.bbox_cv).toBeCloseTo(e.movement.bbox_cv, 3);
      expect(s.movement.speed_mps).toBeCloseTo(e.movement.speed_mps, 3);
      expect(s.priority).toEqual(e.priority);
      expect(s.best).toEqual(e.best);
    });
  });
});

describe("oblique geolocation", () => {
  const pose = { t: 0, lat: 11.47, lon: 76.14, alt_m: 30, heading_deg: 0, speed_mps: 0, gimbal_pitch_deg: -45, gps_fix: 3, sats: 12, hdop: 1, battery_pct: -1 };
  const cam = new Camera(1920, 1080, 70);

  it("puts the image centre alt/tan(pitch) metres ahead", () => {
    const o = cam.pixelToOffset(960, 540, pose)!;
    expect(o.north).toBeCloseTo(30, 6); // 45° down from 30 m -> 30 m ahead
    expect(o.east).toBeCloseTo(0, 6);
  });

  it("reaches farther toward the top of the frame and rejects rays above the horizon", () => {
    const near = cam.pixelToOffset(960, 1000, pose)!, far = cam.pixelToOffset(960, 100, pose)!;
    expect(far.north).toBeGreaterThan(near.north);
    expect(cam.pixelToOffset(960, 540, { ...pose, gimbal_pitch_deg: 10 })).toBeNull();
  });

  it("matches the backend's nadir model when pointing straight down", () => {
    const p = { ...pose, gimbal_pitch_deg: -90, heading_deg: 90 };
    const g = cam.locate(1500, 200, p)!;
    const gsd = (2 * 30 * Math.tan((35 * Math.PI) / 180)) / 1920; // backend: right = (u-W/2)*gsd, fwd = -(v-H/2)*gsd
    const right = (1500 - 960) * gsd, fwd = -(200 - 540) * gsd;
    const [lat, lon] = offsetLatLon(p.lat, p.lon, fwd, -right); // heading east: forward = east, right = south
    expect(g.lat).toBeCloseTo(lat, 9);
    expect(g.lon).toBeCloseTo(lon, 9);
    expect(g.gsd).toBeCloseTo(gsd, 9);
  });
});
