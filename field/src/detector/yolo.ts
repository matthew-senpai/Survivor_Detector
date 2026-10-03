// YOLO (v8/11 detect head) pre/post-processing, mirroring Ultralytics so browser boxes match the reference
// implementation (tests/detector.test.ts). Output layout: [1, 4 + classes, anchors], boxes as cx, cy, w, h.

export type Mode = "fast" | "balanced" | "sensitive";
export interface Rect { x: number; y: number; w: number; h: number }
export interface Letterbox { scale: number; padX: number; padY: number; nw: number; nh: number }
export type Box = [number, number, number, number, number]; // x1, y1, x2, y2, conf (source pixels)

export const MODES: Record<Mode, { label: string; hint: string }> = {
  fast: { label: "Fast", hint: "Whole frame, 1 pass. Real-time; finds people that are clearly visible." },
  balanced: { label: "Balanced", hint: "Whole frame + full-resolution tiles. Better for small people; a few passes per frame." },
  sensitive: { label: "High sensitivity", hint: "Adds 2× zoomed tiles for tiny, top-down people. Slow (~1 frame/s)." },
};

/** Same rounding as ultralytics.data.augment.LetterBox(auto=False) + ops.scale_boxes. */
export function letterbox(w: number, h: number, size: number): Letterbox {
  const scale = Math.min(size / w, size / h);
  const nw = Math.round(w * scale), nh = Math.round(h * scale);
  return { scale, nw, nh, padX: Math.round((size - nw) / 2 - 0.1) || 0, padY: Math.round((size - nh) / 2 - 0.1) || 0 };
}

function axis(len: number, tile: number, overlap: number) {
  if (len <= tile) return [0];
  const step = Math.round(tile * (1 - overlap)), out: number[] = [];
  for (let p = 0; p + tile < len; p += step) out.push(p);
  out.push(len - tile);
  return out;
}

/** Source rectangles to run the model on. Tiles keep detail that whole-frame downscaling destroys. */
export function planTiles(W: number, H: number, mode: Mode, size: number): Rect[] {
  const rects: Rect[] = [{ x: 0, y: 0, w: W, h: H }];
  const tile = mode === "balanced" ? size : mode === "sensitive" ? Math.round(size / 2) : 0;
  if (!tile || (W <= size && H <= size && mode === "balanced")) return rects;
  for (const y of axis(H, Math.min(tile, H), 0.25)) for (const x of axis(W, Math.min(tile, W), 0.25)) rects.push({ x, y, w: Math.min(tile, W), h: Math.min(tile, H) });
  return rects;
}

/** Decode one inference. classIds: indices counted as "person" (argmax rule, as Ultralytics' classes= filter). */
export function decode(out: Float32Array, dims: readonly number[], lb: Letterbox, rect: Rect, conf: number, classIds: number[], iou = 0.7): Box[] {
  const [, ch, n] = dims, nc = ch - 4, cand: Box[] = [];
  for (let i = 0; i < n; i++) {
    let best = -1, bc = 0;
    for (let c = 0; c < nc; c++) { const s = out[(4 + c) * n + i]; if (s > best) { best = s; bc = c; } }
    if (best <= conf || !classIds.includes(bc)) continue;
    const cx = out[i], cy = out[n + i], w = out[2 * n + i], h = out[3 * n + i];
    cand.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, best]);
  }
  return nms(cand, iou, 300).map(([x1, y1, x2, y2, s]) => {
    const m = (v: number, pad: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, (v - pad) / lb.scale));
    return [rect.x + m(x1, lb.padX, 0, rect.w), rect.y + m(y1, lb.padY, 0, rect.h), rect.x + m(x2, lb.padX, 0, rect.w), rect.y + m(y2, lb.padY, 0, rect.h), s];
  });
}

const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
function overlap(a: Box, b: Box) {
  const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = iw * ih;
  return { iou: inter / (area(a) + area(b) - inter || 1), ios: inter / (Math.min(area(a), area(b)) || 1) };
}

export function nms(boxes: Box[], iou: number, maxDet = Infinity): Box[] {
  const sorted = [...boxes].sort((a, b) => b[4] - a[4]), keep: Box[] = [];
  for (const b of sorted) {
    if (keep.length >= maxDet) break;
    if (keep.every((k) => overlap(k, b).iou <= iou)) keep.push(b);
  }
  return keep;
}

/** Merge detections from overlapping tiles: suppress near-duplicates and boxes cut by a tile edge. */
export function mergeTiles(boxes: Box[]): Box[] {
  const sorted = [...boxes].sort((a, b) => b[4] - a[4]), keep: Box[] = [];
  for (const b of sorted) if (keep.every((k) => { const o = overlap(k, b); return o.iou <= 0.5 && o.ios <= 0.75; })) keep.push(b);
  return keep;
}
