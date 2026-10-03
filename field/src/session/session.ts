// A mission: video + telemetry -> detector -> survivor pipeline -> evidence, saved as it runs.
// Live sources run in real time (newest frame when the detector is free); recordings are stepped
// frame by frame so every frame is processed regardless of GPU speed, with exact video timestamps.
import type { Detector } from "../detector/client";
import type { Box, Mode } from "../detector/yolo";
import { Camera } from "../pipeline/geo";
import { SurvivorPipeline } from "../pipeline/pipeline";
import type { TelemetryTrack } from "../pipeline/telemetry";
import type { Survivor, TelemetrySample } from "../pipeline/types";
import { nowS, type MavLink } from "../sources/links";
import { isLive, videoReady, type VideoChoice } from "../sources/video";
import { saveEvidence, saveMission, type EvidenceRecord, type MissionRecord } from "./store";

export type TelemetryChoice =
  | { kind: "mavlink"; link: MavLink; label: string }
  | { kind: "file"; track: TelemetryTrack; label: string; notes: string[] }
  | { kind: "fixed"; pose: { lat: number; lon: number; alt_m: number; heading_deg: number }; label: string }
  | { kind: "none"; label: string };

export interface SessionSettings {
  name: string;
  video: VideoChoice;
  telemetry: TelemetryChoice;
  hfovDeg: number;
  gimbalPitchDeg: number;   // used when telemetry has no gimbal angle
  altOffsetM: number;       // added to telemetry altitude (e.g. ground lower than take-off point -> positive)
  headingOverride: number | null;
  latencyMs: number;        // live: video lags telemetry by this much
  offsetS: number;          // recordings: telemetry time = video time + offset
  startAtS: number;         // recordings: skip the first seconds
  mode: Mode;
  conf: number;
  classIds: number[];
  maxFps: number;
}

export interface LiveDet { box: Box; trackId: number | null }
export interface EvidenceMem extends Omit<EvidenceRecord, "key"> { frameUrl: string; cropUrl: string; w: number; h: number }

export interface Snapshot {
  state: "starting" | "running" | "paused" | "finished" | "stopped" | "error";
  error: string | null;
  t: number;
  frame: number;
  procFps: number;
  inferMs: number;
  tiles: number;
  dets: LiveDet[];
  survivors: Survivor[];
  trackToSurvivor: Map<number, string>;
  pose: TelemetrySample | null;
  trail: [number, number][];
  footprint: [number, number][];
  tracks: number;
  raw: number;
  withoutLocation: number;
  warnings: string[];
  progress: number | null;
  evidence: Map<number, EvidenceMem>;
  savedAt: number | null;
  saveError: string | null;
  frameSize: [number, number];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_PROC_WIDTH = 1920;

export class Session {
  readonly id: string;
  readonly startedAt = new Date();
  readonly live: boolean;
  readonly pipeline: SurvivorPipeline;
  private camera!: Camera;
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d", { willReadFrequently: false })!;
  private stopped = false;
  private paused = false;
  private t0 = 0;
  private lastSave = 0;
  private inferSum = 0;
  private fpsWindow: number[] = [];
  private trailFull: [number, number, number, number, number][] = [];
  /** Processed frames with detections: [frame index, mission time, detections] (drives result replay). */
  readonly frameLog: MissionRecord["frames"] = [];
  private listeners = new Set<() => void>();
  private persistDirty = new Set<number>();
  snap: Snapshot;

  /** The session owns its video element (VideoStage displays it), so React remounts can't break a running mission. */
  readonly video = document.createElement("video");
  private started = false;
  private objectUrl: string | null = null;
  private statuses = new Map<number, Survivor["status"]>(); // keyed by the survivor's first track id (stable as ids renumber)
  pendingStop: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly settings: SessionSettings, private detector: Detector) {
    const d = this.startedAt;
    const p = (n: number) => String(n).padStart(2, "0");
    this.id = `M-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    this.live = isLive(settings.video.kind);
    this.pipeline = new SurvivorPipeline(settings.telemetry.kind !== "none");
    this.snap = {
      state: "starting", error: null, t: 0, frame: 0, procFps: 0, inferMs: 0, tiles: 0, dets: [], survivors: [],
      trackToSurvivor: new Map(), pose: null, trail: [], footprint: [], tracks: 0, raw: 0, withoutLocation: 0,
      warnings: [], progress: null, evidence: new Map(), savedAt: null, saveError: null, frameSize: [0, 0],
    };
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(patch: Partial<Snapshot>) { this.snap = { ...this.snap, ...patch }; this.listeners.forEach((f) => f()); }

  /** Pose at a telemetry-clock time, with operator corrections applied. Null = no trustworthy position. */
  poseAt(t: number): TelemetrySample | null {
    const tel = this.settings.telemetry, s = this.settings;
    let p: TelemetrySample | null = null;
    if (tel.kind === "mavlink") {
      const last = tel.link.track.latest();
      p = last && t - last.t <= 3 ? tel.link.track.at(t) : null; // stale link: don't reuse an old position
    } else if (tel.kind === "file") {
      const ss = tel.track.samples;
      p = ss.length && t >= ss[0].t - 2 && t <= ss[ss.length - 1].t + 2 ? tel.track.at(t) : null;
    } else if (tel.kind === "fixed") {
      p = { t, ...tel.pose, speed_mps: 0, gimbal_pitch_deg: s.gimbalPitchDeg, gps_fix: 3, sats: 0, hdop: 1, battery_pct: -1 };
    }
    if (!p) return null;
    return { ...p, alt_m: p.alt_m + s.altOffsetM, heading_deg: s.headingOverride ?? p.heading_deg };
  }

  private attachSource() {
    const v = this.video, src = this.settings.video;
    v.muted = true;
    v.playsInline = true;
    v.className = "absolute inset-0 h-full w-full object-contain";
    if (src.stream) v.srcObject = src.stream;
    else if (src.file) v.src = this.objectUrl = URL.createObjectURL(src.file);
    else if (src.url) { v.crossOrigin = "anonymous"; v.src = src.url; }
    v.preload = "auto";
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.attachSource();
    try {
      await videoReady(this.video);
      const scale = Math.min(1, MAX_PROC_WIDTH / this.video.videoWidth);
      this.canvas.width = Math.round(this.video.videoWidth * scale);
      this.canvas.height = Math.round(this.video.videoHeight * scale);
      this.camera = new Camera(this.canvas.width, this.canvas.height, this.settings.hfovDeg);
      this.emit({ state: "running", frameSize: [this.canvas.width, this.canvas.height] });
      this.t0 = nowS();
      if (this.live) await this.runLive(); else await this.runRecorded();
    } catch (e) {
      this.emit({ state: "error", error: (e as Error).message });
    } finally {
      await this.save().catch(() => {});
    }
  }

  private async runLive() {
    await this.video.play().catch(() => {});
    while (!this.stopped) {
      if (this.paused) { await sleep(150); continue; }
      const tick = performance.now();
      const tAbs = nowS();
      await this.step(tAbs - this.t0, tAbs - this.settings.latencyMs / 1000);
      await sleep(Math.max(0, 1000 / this.settings.maxFps - (performance.now() - tick)));
    }
  }

  private async runRecorded() {
    const v = this.video;
    v.pause();
    const dur = v.duration;
    if (!Number.isFinite(dur) || dur <= 0) throw new Error("This recording has no readable duration.");
    const dt = 1 / this.settings.maxFps;
    for (let t = Math.min(this.settings.startAtS, dur - dt); t < dur && !this.stopped; t += dt) {
      while (this.paused && !this.stopped) await sleep(150);
      await this.seek(t);
      await this.step(t, t + this.settings.offsetS, t / dur);
    }
    if (!this.stopped) {
      await this.seek(Math.min(this.settings.startAtS, dur)); // rewind: ready to replay with the recorded detections
      this.emit({ state: "finished", progress: 1 });
    }
  }

  private seek(t: number) {
    return new Promise<void>((resolve) => {
      const v = this.video;
      const done = () => { v.removeEventListener("seeked", done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 4000);
      v.addEventListener("seeked", done);
      v.currentTime = t;
    });
  }

  private async step(tMission: number, tTelemetry: number, progress: number | null = null) {
    const W = this.canvas.width, H = this.canvas.height;
    this.ctx.drawImage(this.video, 0, 0, W, H);
    const bitmap = await createImageBitmap(this.canvas);
    const res = await this.detector.detect(bitmap, this.settings.mode, this.settings.conf, this.settings.classIds);
    const pose = this.poseAt(tTelemetry);
    const frame = this.pipeline.stats.frames_processed;
    const dets = res.boxes.map(([x1, y1, x2, y2, conf]) => ({ x1, y1, x2, y2, conf }));
    const ids = this.pipeline.processFrame(frame, tMission, dets, pose, this.camera);
    if (dets.length) this.frameLog.push([frame, tMission, this.pipeline.frames[this.pipeline.frames.length - 1][1]]);

    // evidence: keep each track's best-confidence frame (the one its survivor record will cite)
    for (let i = 0; i < res.boxes.length; i++) {
      const tid = ids[i];
      if (tid === null || tid === undefined) continue;
      const prev = this.snap.evidence.get(tid);
      if (!prev || res.boxes[i][4] > prev.conf) await this.capture(tid, res.boxes[i], frame, tMission);
    }

    this.inferSum += res.ms;
    const now = performance.now();
    this.fpsWindow = [...this.fpsWindow.filter((x) => now - x < 3000), now];
    const trail = this.snap.trail;
    if (pose) {
      const last = this.trailFull[this.trailFull.length - 1];
      if (!last || tMission - last[0] >= 1) {
        this.trailFull.push([tMission, pose.lat, pose.lon, pose.alt_m, pose.heading_deg]);
        trail.push([pose.lat, pose.lon]);
      }
    }
    let survivors = this.snap.survivors, map = this.snap.trackToSurvivor;
    if (frame % 3 === 0 || this.pipeline.tracker.confirmed().length !== this.snap.tracks) {
      survivors = this.applyStatus(this.pipeline.survivors());
      map = new Map(survivors.flatMap((s) => s.track_ids.map((t) => [t, s.id] as [number, string])));
    }
    this.emit({
      t: tMission, frame: frame + 1, dets: res.boxes.map((box, i) => ({ box, trackId: ids[i] ?? null })),
      inferMs: res.ms, tiles: res.tiles, progress,
      procFps: this.fpsWindow.length > 1 ? (this.fpsWindow.length - 1) / ((now - this.fpsWindow[0]) / 1000) : 0,
      pose, trail, footprint: pose ? this.camera.footprint(pose) : this.snap.footprint, survivors, trackToSurvivor: map,
      tracks: this.pipeline.tracker.confirmed().length, raw: this.pipeline.stats.raw_detections,
      withoutLocation: this.pipeline.stats.detections_without_location, warnings: [...this.pipeline.warnings],
    });
    if (now - this.lastSave > 15000) this.save().catch(() => {});
  }

  private async capture(trackId: number, box: Box, frame: number, t: number) {
    const W = this.canvas.width, H = this.canvas.height, k = Math.min(1, 1280 / W);
    const full = new OffscreenCanvas(Math.round(W * k), Math.round(H * k));
    full.getContext("2d")!.drawImage(this.canvas, 0, 0, full.width, full.height);
    const [x1, y1, x2, y2, conf] = box, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const half = Math.max(48, Math.max(x2 - x1, y2 - y1) * 1.4);
    const crop = new OffscreenCanvas(256, 256);
    const cctx = crop.getContext("2d")!;
    cctx.fillStyle = "#0b0f0d";
    cctx.fillRect(0, 0, 256, 256);
    cctx.drawImage(this.canvas, cx - half, cy - half, 2 * half, 2 * half, 0, 0, 256, 256);
    const [frameJpeg, cropJpeg] = await Promise.all([full.convertToBlob({ type: "image/jpeg", quality: 0.82 }), crop.convertToBlob({ type: "image/jpeg", quality: 0.88 })]);
    const prev = this.snap.evidence.get(trackId);
    if (prev) { URL.revokeObjectURL(prev.frameUrl); URL.revokeObjectURL(prev.cropUrl); }
    this.snap.evidence.set(trackId, {
      missionId: this.id, trackId, frame, t, conf, bbox: [x1 * k, y1 * k, x2 * k, y2 * k], frameJpeg, cropJpeg,
      frameUrl: URL.createObjectURL(frameJpeg), cropUrl: URL.createObjectURL(cropJpeg), w: full.width, h: full.height,
    });
    this.persistDirty.add(trackId);
  }

  /** Evidence for a survivor: the frame its record cites (best confidence across merged tracks). */
  evidenceFor(s: Survivor): EvidenceMem | undefined {
    const ev = s.track_ids.map((t) => this.snap.evidence.get(t)).filter(Boolean) as EvidenceMem[];
    return ev.find((e) => e.frame === s.best.frame) ?? ev.sort((a, b) => b.conf - a.conf)[0];
  }

  private applyStatus(list: Survivor[]) {
    return list.map((s) => ({ ...s, status: this.statuses.get(s.track_ids[0]) ?? s.status }));
  }

  setStatus(s: Survivor, status: Survivor["status"]) {
    this.statuses.set(s.track_ids[0], status);
    this.emit({ survivors: this.applyStatus(this.snap.survivors) });
    this.save().catch(() => {});
  }

  pause() { this.paused = true; this.video.pause(); this.emit({ state: "paused" }); }
  resume() { this.paused = false; if (this.live) this.video.play().catch(() => {}); this.emit({ state: "running" }); }
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.snap.state !== "finished" && this.snap.state !== "error") this.emit({ state: "stopped" });
    this.settings.video.stream?.getTracks().forEach((t) => t.stop()); // release the camera / screen capture
    if (this.settings.telemetry.kind === "mavlink") this.settings.telemetry.link.close();
    await this.save();
  }

  toRecord(): MissionRecord {
    const s = this.settings, tel = s.telemetry;
    const status = this.snap.state === "running" || this.snap.state === "paused" || this.snap.state === "starting" ? "running" : this.snap.state === "finished" ? "complete" : "stopped";
    return {
      id: this.id, name: s.name, createdAt: this.startedAt.toISOString(), updatedAt: new Date().toISOString(), status,
      video: { kind: s.video.kind, label: s.video.label, width: this.canvas.width, height: this.canvas.height },
      telemetry: { kind: tel.kind, label: tel.label, notes: tel.kind === "file" ? tel.notes : [] },
      settings: { hfovDeg: s.hfovDeg, gimbalPitchDeg: s.gimbalPitchDeg, altOffsetM: s.altOffsetM, headingOverride: s.headingOverride,
        latencyMs: s.latencyMs, offsetS: s.offsetS, mode: s.mode, conf: s.conf, classIds: s.classIds, maxFps: s.maxFps, model: this.detector.info?.model, backend: this.detector.info?.backend },
      geo: this.pipeline.geo, durationS: this.snap.t,
      stats: { frames: this.pipeline.stats.frames_processed, raw: this.pipeline.stats.raw_detections, tracks: this.pipeline.tracker.confirmed().length,
        withoutLocation: this.pipeline.stats.detections_without_location, avgInferMs: this.pipeline.stats.frames_processed ? this.inferSum / this.pipeline.stats.frames_processed : 0 },
      survivors: this.applyStatus(this.pipeline.survivors()), frames: this.frameLog, trail: this.trailFull, warnings: this.pipeline.warnings,
    };
  }

  async save() {
    try {
      await saveMission(this.toRecord());
      const dirty = [...this.persistDirty];
      this.persistDirty.clear();
      for (const tid of dirty) {
        const e = this.snap.evidence.get(tid);
        if (e) await saveEvidence({ key: `${this.id}:${tid}`, missionId: e.missionId, trackId: tid, frame: e.frame, t: e.t, bbox: e.bbox, conf: e.conf, frameJpeg: e.frameJpeg, cropJpeg: e.cropJpeg });
      }
      this.lastSave = performance.now();
      this.emit({ savedAt: Date.now(), saveError: null });
    } catch (e) {
      this.lastSave = performance.now();
      this.emit({ saveError: `Not saved: ${(e as Error).message}. Export the mission before closing.` });
    }
  }
}
