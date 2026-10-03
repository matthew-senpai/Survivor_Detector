// Detector post-processing reproduces Ultralytics on the same raw ONNX output (fixture from make_fixtures.py:
// YOLO11n on public/selftest.jpg, a CC0 drone frame of ice climbers).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode, letterbox, mergeTiles, planTiles } from "../src/detector/yolo";

const fx = (p: string) => new URL(`./fixtures/${p}`, import.meta.url);
const exp = JSON.parse(readFileSync(fx("det_expected.json"), "utf8"));
const raw = readFileSync(fx("det_output.bin"));
const out = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);

describe("YOLO post-processing", () => {
  it("letterboxes like Ultralytics", () => {
    expect(letterbox(1920, 1012, 640)).toMatchObject({ nw: 640, nh: 337, padX: 0, padY: 151 });
  });

  it("returns the same people, boxes and confidences as Ultralytics", () => {
    const lb = letterbox(exp.width, exp.height, 640);
    const boxes = decode(out, exp.dims, lb, { x: 0, y: 0, w: exp.width, h: exp.height }, 0.25, [0], 0.7);
    expect(boxes.length).toBe(exp.boxes.length);
    boxes.forEach((b, i) => b.forEach((v, k) => expect(v).toBeCloseTo(exp.boxes[i][k], 2)));
  });

  it("finds nothing above an impossible threshold and ignores non-person classes", () => {
    const lb = letterbox(exp.width, exp.height, 640);
    expect(decode(out, exp.dims, lb, { x: 0, y: 0, w: exp.width, h: exp.height }, 0.999, [0])).toHaveLength(0);
    expect(decode(out, exp.dims, lb, { x: 0, y: 0, w: exp.width, h: exp.height }, 0.25, [79])).toHaveLength(0);
  });
});

describe("tiling", () => {
  it("covers the whole frame in every mode", () => {
    for (const mode of ["fast", "balanced", "sensitive"] as const) {
      const rects = planTiles(1920, 1080, mode, 640);
      expect(rects[0]).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
      for (const r of rects) { expect(r.x + r.w).toBeLessThanOrEqual(1920); expect(r.y + r.h).toBeLessThanOrEqual(1080); }
      if (mode !== "fast") {
        const tiles = rects.slice(1);
        expect(Math.max(...tiles.map((r) => r.x + r.w))).toBe(1920);
        expect(Math.max(...tiles.map((r) => r.y + r.h))).toBe(1080);
      }
    }
    expect(planTiles(1920, 1080, "fast", 640)).toHaveLength(1);
    expect(planTiles(1920, 1080, "balanced", 640)).toHaveLength(1 + 4 * 2);
    expect(planTiles(1920, 1080, "sensitive", 640).length).toBeGreaterThan(20);
  });

  it("merges a person split across two tiles into one box", () => {
    const merged = mergeTiles([[100, 100, 140, 200, 0.8], [100, 100, 140, 150, 0.6], [400, 400, 440, 480, 0.5]]);
    expect(merged).toEqual([[100, 100, 140, 200, 0.8], [400, 400, 440, 480, 0.5]]);
  });
});
