import type { WorkerIn, WorkerOut } from "./worker";
import type { Box, Mode } from "./yolo";

export interface DetectorInfo { backend: string; size: number; classes: number; warmupMs: number; threads: number; model: string }
export interface DetectResult { boxes: Box[]; ms: number; tiles: number }

export const DEFAULT_MODEL = "/models/yolo11n.onnx";

/** Main-thread handle to the detection worker. One request in flight at a time keeps latency honest. */
export class Detector {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: DetectResult) => void; reject: (e: Error) => void }>();
  private dead = false;
  private initWaits: { resolve: (i: DetectorInfo) => void; reject: (e: Error) => void; model: string }[] = []; // FIFO, the worker is sequential
  info: DetectorInfo | null = null;
  onProgress: ((loaded: number, total: number) => void) | null = null;

  constructor() {
    this.worker = this.spawn();
  }

  private spawn() {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<WorkerOut>) => this.handle(e.data);
    w.onerror = (e) => {
      e.preventDefault();
      w.terminate();
      this.dead = true; // replaced on the next init(), never automatically (a worker that fails to load would loop)
      this.info = null;
      this.failAll(new Error(`Detector worker failed${e.message ? `: ${e.message}` : " to start"}. Reload the model to retry.`));
    };
    return w;
  }

  private handle(m: WorkerOut) {
    if (m.type === "progress") this.onProgress?.(m.loaded, m.total);
    else if (m.type === "ready") {
      const w = this.initWaits.shift();
      this.info = { backend: m.backend, size: m.size, classes: m.classes, warmupMs: m.warmupMs, threads: m.threads, model: w?.model ?? "model" };
      w?.resolve(this.info);
    } else if (m.type === "result") {
      this.pending.get(m.id)?.resolve({ boxes: m.boxes, ms: m.ms, tiles: m.tiles });
      this.pending.delete(m.id);
    } else if (m.id !== undefined) {
      this.pending.get(m.id)?.reject(new Error(m.message));
      this.pending.delete(m.id);
    } else {
      this.initWaits.shift()?.reject(new Error(m.message));
    }
  }

  private failAll(err: Error) {
    this.initWaits.splice(0).forEach((w) => w.reject(err));
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
  }

  init(model: string | File = DEFAULT_MODEL, backend: "auto" | "webgpu" | "wasm" = "auto"): Promise<DetectorInfo> {
    this.info = null;
    if (this.dead) { this.worker = this.spawn(); this.dead = false; }
    const name = typeof model === "string" ? model.split("/").pop()! : model.name;
    return new Promise(async (resolve, reject) => {
      this.initWaits.push({ resolve, reject, model: name });
      const payload = typeof model === "string" ? model : await model.arrayBuffer();
      const msg: WorkerIn = { type: "init", model: payload, backend };
      this.worker.postMessage(msg, typeof payload === "string" ? [] : [payload]);
    });
  }

  detect(bitmap: ImageBitmap, mode: Mode, conf: number, classIds: number[]): Promise<DetectResult> {
    if (this.dead) { bitmap.close(); return Promise.reject(new Error("Detector is not running. Reload the model.")); }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: WorkerIn = { type: "detect", id, bitmap, mode, conf, classIds };
      this.worker.postMessage(msg, [bitmap]);
    });
  }
}
