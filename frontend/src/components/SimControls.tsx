import { motion } from "framer-motion";
import { CircleCheck, FileSpreadsheet, LoaderCircle, Play, TriangleAlert, Upload, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, STATIC_DEMO } from "../lib/api";
import { useMission } from "../lib/MissionContext";
import type { Bundle, MissionSummary } from "../lib/types";

async function waitForMission(id: string, onTick: (s: string) => void) {
  for (let i = 0; i < 600; i++) {
    const m = (await api.missions()).find((x) => x.id === id);
    if (m?.status === "complete" || m?.status === "live") return;
    if (m?.status === "failed") throw new ApiError(m.error ?? "Processing failed");
    onTick(m?.status ?? "queued");
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new ApiError("Timed out waiting for processing");
}

export default function SimControls({ bundle, onClose }: { bundle: Bundle; onClose: () => void }) {
  const { apiOnline, openMission, health } = useMission();
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; errors?: string[] } | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [csv, setCsv] = useState<File | null>(null);

  useEffect(() => {
    if (apiOnline) api.missions().then(setMissions).catch(() => {});
  }, [apiOnline, busy]);

  const run = async (label: string, start: () => Promise<{ id: string }>) => {
    setMsg(null);
    setBusy(label);
    try {
      const { id } = await start();
      await waitForMission(id, (s) => setBusy(`${label}: ${s}…`));
      await openMission(id);
      setMsg({ kind: "ok", text: `Mission ${id} ready.` });
    } catch (e) {
      const err = e as ApiError;
      setMsg({ kind: "err", text: err.message, errors: err.errors });
    } finally {
      setBusy(null);
    }
  };

  const upload = () => {
    if (!csv) return setMsg({ kind: "err", text: "Select a telemetry CSV: detections can't be geolocated without the drone's position." });
    if (!video) return setMsg({ kind: "err", text: "Select a drone video file." });
    const fd = new FormData();
    fd.append("video", video);
    fd.append("telemetry", csv);
    fd.append("name", video.name.replace(/\.[^.]+$/, ""));
    run("Uploading & processing", () => api.upload(fd));
  };

  const m = bundle.metrics, tg = bundle.targets, truth = m.sim_truth;
  const rows: [string, string, string, boolean | null][] = [];
  if (truth) {
    rows.push(["Recall vs ground truth", `${(truth.recall * 100).toFixed(0)}% (${truth.found}/${truth.ground_truth_people})`, `≥ ${tg.min_recall * 100}%`, truth.recall >= tg.min_recall]);
    rows.push(["Duplicate survivors", `${(truth.duplicate_rate * 100).toFixed(1)}%`, `≤ ${tg.max_duplicate_rate * 100}%`, truth.duplicate_rate <= tg.max_duplicate_rate]);
    rows.push(["Location error (mean / max)", `${truth.mean_geo_error_m} / ${truth.max_geo_error_m} m`, `≤ ${tg.max_geo_error_m} m`, (truth.max_geo_error_m ?? 99) <= tg.max_geo_error_m]);
  }
  const replay = bundle.mission.source.detector.startsWith("replay");
  rows.push(["Detector throughput", replay ? "not timed (replay)*" : `${m.pipeline_fps} fps`, `≥ ${tg.min_inference_fps} fps`, replay ? null : (m.pipeline_fps ?? 0) >= tg.min_inference_fps]);
  rows.push(["Duplicates merged across passes", String(m.duplicates_suppressed), "-", null]);
  rows.push(["Detections without location", String(m.detections_without_location), "0 ideal", m.detections_without_location === 0]);

  return (
    <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
      className="fixed bottom-0 right-0 top-14 z-[1500] flex w-full max-w-[440px] flex-col border-l border-line-2 bg-panel shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div>
          <div className="label text-medium">Simulation mode</div>
          <div className="font-display text-xl font-semibold uppercase">Mission controls</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink"><X size={18} /></button>
      </div>
      <div className="flex-1 space-y-7 overflow-y-auto p-5">
        {!apiOnline && (
          <div className="flex gap-2 border border-medium/40 bg-medium/5 p-3 text-[13px] text-medium">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            {STATIC_DEMO
              ? "Static deployment: this replays pipeline output computed offline by the same backend. Run the API locally (see README) to re-run missions or upload footage."
              : "Backend unavailable. Replaying the cached sample mission; running new missions and uploads need the API (port 8000)."}
          </div>
        )}

        <div>
          <div className="label mb-2">Sample mission</div>
          <p className="mb-3 text-[13px] text-muted">Re-runs the whole pipeline on the bundled footage, telemetry CSV and recorded detections, and creates a new mission record.</p>
          <button disabled={!apiOnline || !!busy} onClick={() => run("Running pipeline", api.runSample)}
            className="flex w-full items-center justify-center gap-2 bg-signal py-2.5 text-[13px] font-semibold text-black transition hover:bg-[#ff9445] disabled:cursor-not-allowed disabled:opacity-40">
            <Play size={15} /> Run sample mission
          </button>
        </div>

        <div>
          <div className="label mb-2">Upload drone footage</div>
          <div className="space-y-2">
            <FilePick icon={Video} label="Drone video" accept="video/*" file={video} onFile={setVideo} />
            <FilePick icon={FileSpreadsheet} label="Telemetry CSV" accept=".csv,text/csv" file={csv} onFile={setCsv} />
            <p className="font-mono text-[10.5px] leading-relaxed text-dim">CSV columns: t, lat, lon, alt_m, heading_deg [, speed_mps, gps_fix, sats, hdop, battery_pct]. t in seconds from video start.</p>
            <p className="font-mono text-[10.5px] text-dim">YOLO detector: {health?.components.detector_yolo ?? "unknown"}</p>
            <button disabled={!apiOnline || !!busy} onClick={upload}
              className="flex w-full items-center justify-center gap-2 border border-line-2 py-2.5 text-[13px] text-ink transition hover:border-ink disabled:cursor-not-allowed disabled:opacity-40">
              <Upload size={15} /> Upload & run pipeline
            </button>
          </div>
        </div>

        {busy && <div className="flex items-center gap-2 font-mono text-[12px] text-hud"><LoaderCircle size={14} className="animate-spin" />{busy}</div>}
        {msg && (
          <div className={`border p-3 text-[13px] ${msg.kind === "ok" ? "border-ok/40 text-ok" : "border-high/40 text-high"}`}>
            <div className="flex gap-2">{msg.kind === "ok" ? <CircleCheck size={16} /> : <TriangleAlert size={16} className="shrink-0" />}{msg.text}</div>
            {msg.errors && msg.errors.length > 0 && <ul className="mt-2 list-inside list-disc font-mono text-[11px] text-high/90">{msg.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>}
          </div>
        )}

        <div>
          <div className="label mb-2">Pipeline metrics vs targets</div>
          <div className="border border-line">
            {rows.map(([k, v, target, ok]) => (
              <div key={k} className="grid grid-cols-[1fr_auto] gap-2 border-b border-line px-3 py-2 last:border-0">
                <div><div className="text-[12.5px]">{k}</div><div className="font-mono text-[10.5px] text-dim">target {target}</div></div>
                <div className={`self-center font-mono text-[12.5px] ${ok === null ? "text-ink" : ok ? "text-ok" : "text-high"}`}>{v}</div>
              </div>
            ))}
          </div>
          {replay && <p className="mt-1.5 font-mono text-[10.5px] text-dim">* the sample mission replays recorded detections, so there is no inference to time. YOLO throughput is measured on uploaded video or on the edge device.</p>}
          {bundle.warnings.map((w) => <p key={w} className="mt-1.5 text-[12px] text-medium">⚠ {w}</p>)}
        </div>

        {missions.length > 0 && (
          <div>
            <div className="label mb-2">Missions</div>
            <div className="border border-line">
              {missions.map((ms) => (
                <button key={ms.id} disabled={ms.status === "processing" || ms.status === "failed"} onClick={() => openMission(ms.id)}
                  className={`flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2 text-left last:border-0 disabled:cursor-default ${ms.id === bundle.mission.id ? "bg-signal/10" : "hover:bg-white/5"}`}>
                  <span><span className="block font-mono text-[12px]">{ms.id}</span><span className="text-[11.5px] text-muted">{ms.name}</span></span>
                  <span className={`font-mono text-[10.5px] uppercase ${ms.status === "failed" ? "text-high" : ms.status === "complete" ? "text-ok" : "text-medium"}`} title={ms.error ?? ""}>{ms.status}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.aside>
  );
}

function FilePick({ icon: Icon, label, accept, file, onFile }: { icon: typeof Video; label: string; accept: string; file: File | null; onFile: (f: File | null) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 border border-dashed border-line-2 px-3 py-2.5 transition hover:border-ink">
      <Icon size={17} className="text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px]">{label}</span>
        <span className="block truncate font-mono text-[11px] text-dim">{file ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : "Choose file…"}</span>
      </span>
      <input type="file" accept={accept} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}
