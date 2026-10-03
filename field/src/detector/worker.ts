/// <reference lib="webworker" />
// Person detection off the main thread: ONNX Runtime Web on WebGPU, falling back to WASM (CPU).
import * as ort from "onnxruntime-web/webgpu";
import { decode, letterbox, mergeTiles, planTiles, type Box, type Mode } from "./yolo";

export type WorkerIn =
  | { type: "init"; model: string | ArrayBuffer; backend: "auto" | "webgpu" | "wasm" }
  | { type: "detect"; id: number; bitmap: ImageBitmap; mode: Mode; conf: number; classIds: number[] };
export type WorkerOut =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; backend: string; size: number; classes: number; warmupMs: number; threads: number }
  | { type: "result"; id: number; boxes: Box[]; ms: number; tiles: number }
  | { type: "error"; id?: number; message: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);
let session: ort.InferenceSession | null = null;
let size = 640, inputName = "images", outputName = "output0";
let canvas: OffscreenCanvas, ctx: OffscreenCanvasRenderingContext2D, input: Float32Array;

async function fetchModel(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Model download failed (${r.status} ${r.statusText})`);
  const total = Number(r.headers.get("content-length")) || 0, reader = r.body!.getReader(), parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    post({ type: "progress", loaded, total });
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function init(msg: Extract<WorkerIn, { type: "init" }>) {
  // the WebGPU/WASM runtime binary is bundled by Vite next to this worker (same origin, works offline)
  // Single-threaded CPU side: ORT's thread pool re-loads the *current* script as its pthread workers, which inside
  // a bundled worker is this file, not ORT, and initialisation hangs. GPU inference (the main path) is unaffected.
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  const bytes = typeof msg.model === "string" ? await fetchModel(msg.model) : new Uint8Array(msg.model);
  const tryEp = async (ep: "webgpu" | "wasm") => ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: "all" });
  let backend: "webgpu" | "wasm" = "wasm";
  session = null;
  if (msg.backend !== "wasm" && "gpu" in navigator) {
    try { session = await tryEp("webgpu"); backend = "webgpu"; } catch { /* no usable GPU adapter: fall back to CPU */ }
  }
  session ??= await tryEp("wasm");
  inputName = session.inputNames[0];
  outputName = session.outputNames[0];
  const meta = (session as unknown as { inputMetadata?: { shape?: (number | string)[] }[] }).inputMetadata?.[0]?.shape;
  size = typeof meta?.[2] === "number" ? meta[2] : 640;
  canvas = new OffscreenCanvas(size, size);
  ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "low"; // bilinear, closest to the reference (OpenCV INTER_LINEAR)
  input = new Float32Array(3 * size * size);
  const t0 = performance.now();
  const out = await session.run({ [inputName]: new ort.Tensor("float32", input, [1, 3, size, size]) });
  const dims = out[outputName].dims;
  if (dims.length !== 3 || dims[1] < 5) throw new Error(`Unsupported model output ${JSON.stringify(dims)}: expected a YOLOv8/YOLO11 detect head [1, 4+classes, anchors].`);
  post({ type: "ready", backend, size, classes: dims[1] - 4, warmupMs: performance.now() - t0, threads: ort.env.wasm.numThreads as number });
}

async function detect(msg: Extract<WorkerIn, { type: "detect" }>) {
  if (!session) throw new Error("Detector not initialised");
  const t0 = performance.now(), { bitmap } = msg, plane = size * size, all: Box[] = [];
  const rects = planTiles(bitmap.width, bitmap.height, msg.mode, size);
  for (const rect of rects) {
    const lb = letterbox(rect.w, rect.h, size);
    ctx.fillStyle = "rgb(114,114,114)";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, lb.padX, lb.padY, lb.nw, lb.nh);
    const px = ctx.getImageData(0, 0, size, size).data;
    for (let i = 0, j = 0; i < plane; i++, j += 4) {
      input[i] = px[j] / 255;
      input[plane + i] = px[j + 1] / 255;
      input[2 * plane + i] = px[j + 2] / 255;
    }
    const out = (await session.run({ [inputName]: new ort.Tensor("float32", input, [1, 3, size, size]) }))[outputName];
    all.push(...decode(out.data as Float32Array, out.dims, lb, rect, msg.conf, msg.classIds));
    out.dispose();
  }
  bitmap.close();
  post({ type: "result", id: msg.id, boxes: rects.length > 1 ? mergeTiles(all) : all, ms: performance.now() - t0, tiles: rects.length });
}

async function handle(msg: WorkerIn) {
  try {
    if (msg.type === "init") await init(msg);
    else await detect(msg);
  } catch (err) {
    if (msg.type === "detect") msg.bitmap.close();
    post({ type: "error", id: msg.type === "detect" ? msg.id : undefined, message: (err as Error)?.message ?? String(err) });
  }
}

// Strictly one message at a time: ONNX Runtime deadlocks if two sessions initialise concurrently.
let queue: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<WorkerIn>) => { queue = queue.then(() => handle(e.data)); };
