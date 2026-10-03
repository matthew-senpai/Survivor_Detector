import { Download, Pause, Play, Square } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import FieldMap from "../components/FieldMap";
import Header from "../components/Header";
import SurvivorDetail, { SurvivorRow } from "../components/SurvivorDetail";
import VideoStage from "../components/VideoStage";
import type { Detector } from "../detector/client";
import type { Priority } from "../pipeline/types";
import { download, missionJson, survivorsCsv, survivorsGeoJson } from "../session/export";
import { Session, type SessionSettings } from "../session/session";
import { nowS } from "../sources/links";
import { Chip, fmtT, Note, PRIORITY_COLOR } from "../ui";

const RANK: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export default function Live({ settings, detector, onClose }: { settings: SessionSettings; detector: Detector; onClose: (missionId?: string) => void }) {
  const [session] = useState(() => new Session(settings, detector));
  const snap = useSyncExternalStore((f) => session.subscribe(f), () => session.snap);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Priority | "ALL">("ALL");
  const [, tick] = useState(0);

  useEffect(() => {
    clearTimeout(session.pendingStop);
    session.start();
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => { clearInterval(id); session.pendingStop = setTimeout(() => session.stop(), 100); };
  }, [session]);

  const tel = settings.telemetry, live = session.live;
  const timeLabel = (t: number) => (live ? new Date(session.startedAt.getTime() + t * 1000).toLocaleTimeString([], { hour12: false }) : `video ${fmtT(t)}`);
  const sel = snap.survivors.find((s) => s.id === selected);
  const ev = sel ? session.evidenceFor(sel) : undefined;
  const list = useMemo(() => snap.survivors.filter((s) => filter === "ALL" || s.priority.level === filter)
    .sort((a, b) => RANK[a.priority.level] - RANK[b.priority.level] || a.confirmed_t - b.confirmed_t), [snap.survivors, filter]);
  const count = (l: Priority) => snap.survivors.filter((s) => s.priority.level === l).length;

  // link health (live MAVLink)
  const linkState = tel.kind === "mavlink" ? tel.link.telemetry.state : null;
  const hbAge = linkState?.heartbeatAt ? nowS() - linkState.heartbeatAt : null;
  const posAge = tel.kind === "mavlink" && tel.link.track.latest() ? nowS() - tel.link.track.latest().t : null;
  const telTone = tel.kind === "none" ? "dim" : tel.kind === "mavlink" ? (tel.link.closed || posAge === null || posAge > 3 ? "bad" : "ok") : snap.pose ? "ok" : "warn";
  const telText = tel.kind === "none" ? "NONE · detection only" : tel.kind === "fixed" ? "FIXED POSITION"
    : tel.kind === "file" ? (snap.pose ? "FLIGHT LOG" : "LOG · no data at this time")
    : tel.link.closed ? "LINK LOST" : posAge === null ? "WAITING FOR POSITION" : posAge > 3 ? `STALE ${posAge.toFixed(0)} s` : `MAVLINK · ${hbAge !== null && hbAge < 3 ? "heartbeat ok" : "no heartbeat"}`;
  const modeLabel = live ? (tel.kind === "mavlink" && !linkState?.simulated ? "LIVE · DEPLOYMENT" : "LIVE VIDEO") : settings.video.kind === "sample" ? "SAMPLE CLIP · REAL FOOTAGE" : "RECORDED FOOTAGE";

  const stop = async () => { await session.stop(); onClose(session.id); };
  const exportAs = async (kind: "json" | "csv" | "geojson") => {
    await session.save();
    const rec = session.toRecord();
    if (kind === "csv") return download(`${session.id}_survivors.csv`, survivorsCsv(rec), "text/csv");
    if (kind === "geojson") return download(`${session.id}_survivors.geojson`, survivorsGeoJson(rec), "application/geo+json");
    const evidence = [...snap.evidence.values()].map((e) => ({ ...e, key: `${session.id}:${e.trackId}` }));
    download(`${session.id}.landsight.json`, await missionJson(rec, evidence), "application/json");
  };

  const running = snap.state === "running" || snap.state === "starting";
  return (
    <div className="flex h-full flex-col">
      <Header>
        <span className={`border px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.12em] ${modeLabel.startsWith("LIVE · DEP") ? "border-ok/50 bg-ok/10 text-ok" : "border-medium/50 bg-medium/10 text-medium"}`}>● {modeLabel}</span>
        {linkState?.simulated && <span className="border border-medium/50 bg-medium/10 px-2 py-1 font-mono text-[10.5px] text-medium">SIMULATED TELEMETRY</span>}
      </Header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-panel px-4 py-2 md:px-6">
        <div className="min-w-0">
          <div className="truncate font-display text-lg font-semibold uppercase leading-tight">{settings.name}</div>
          <div className="font-mono text-[10.5px] text-dim">{session.id} · {settings.video.label}</div>
        </div>
        <Chip k="State" v={snap.state.toUpperCase()} tone={snap.state === "error" ? "bad" : running ? "ok" : "hud"} />
        <Chip k="Time" v={live ? fmtT(snap.t) : `${fmtT(snap.t)}${snap.progress !== null ? ` · ${(snap.progress * 100).toFixed(0)}%` : ""}`} />
        <Chip k="Telemetry" v={telText} tone={telTone} />
        {snap.pose && (tel.kind === "fixed"
          ? <Chip k="Position" v={`manual · ${snap.pose.alt_m.toFixed(1)} m`} tone="warn" />
          : <Chip k="GPS" v={`fix ${snap.pose.gps_fix} · ${snap.pose.sats} sats · ${snap.pose.alt_m.toFixed(1)} m`} tone={snap.pose.gps_fix >= 3 ? "ok" : "warn"} />)}
        <Chip k="Detector" v={`${detector.info?.backend === "webgpu" ? "GPU" : "CPU"} · ${snap.inferMs.toFixed(0)} ms · ${snap.tiles} pass${snap.tiles > 1 ? "es" : ""}`} tone={detector.info?.backend === "webgpu" ? "ok" : "warn"} />
        <Chip k="Rate" v={`${snap.procFps.toFixed(1)} frames/s`} />
        <Chip k="Saved" v={snap.saveError ? "NOT SAVED" : snap.savedAt ? new Date(snap.savedAt).toLocaleTimeString([], { hour12: false }) : "…"} tone={snap.saveError ? "bad" : "dim"} />
        <div className="ml-auto flex flex-wrap gap-2">
          {running || snap.state === "paused" ? (
            <>
              <button onClick={() => (snap.state === "paused" ? session.resume() : session.pause())} className="flex items-center gap-1.5 border border-line-2 px-3 py-1.5 text-[12.5px] hover:border-ink">
                {snap.state === "paused" ? <><Play size={14} />Resume</> : <><Pause size={14} />Pause</>}
              </button>
              <button onClick={stop} className="flex items-center gap-1.5 bg-signal px-3 py-1.5 text-[12.5px] font-semibold text-black"><Square size={13} />Stop & save</button>
            </>
          ) : <button onClick={() => onClose(session.id)} className="bg-ok px-3 py-1.5 text-[12.5px] font-semibold text-black">Open mission report</button>}
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 border border-line-2 px-3 py-1.5 text-[12.5px] hover:border-ink"><Download size={14} />Export</summary>
            <div className="absolute right-0 z-[2000] mt-1 w-56 border border-line-2 bg-panel">
              <button onClick={() => exportAs("json")} className="block w-full px-3 py-2 text-left text-[12.5px] hover:bg-white/5">Mission file (.json, with evidence)</button>
              <button onClick={() => exportAs("csv")} className="block w-full px-3 py-2 text-left text-[12.5px] hover:bg-white/5">Survivors (.csv)</button>
              <button onClick={() => exportAs("geojson")} disabled={!session.pipeline.geo} className="block w-full px-3 py-2 text-left text-[12.5px] hover:bg-white/5 disabled:opacity-40">Survivors map layer (.geojson)</button>
            </div>
          </details>
        </div>
      </div>

      {(snap.error || snap.saveError || snap.warnings.length > 0) && (
        <div className="space-y-1 border-b border-line px-4 py-2 md:px-6">
          {snap.error && <Note tone="bad">{snap.error}</Note>}
          {snap.saveError && <Note tone="bad">{snap.saveError}</Note>}
          {snap.warnings.map((w) => <Note key={w}>{w}</Note>)}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-px bg-line lg:grid-cols-[1fr_400px]">
        <div className="flex min-h-0 flex-col bg-bg">
          <div className="relative min-h-[300px] flex-1"><VideoStage session={session} selectedId={selected} onSelect={setSelected} controls={!live && !running && snap.state !== "paused"} /></div>
          {!live && snap.progress !== null && <div className="h-1 bg-line"><div className="h-full bg-ok transition-[width]" style={{ width: `${snap.progress * 100}%` }} /></div>}
          <div className="grid grid-cols-3 gap-px bg-line sm:grid-cols-6">
            {[["Frames", snap.frame], ["Detections", snap.raw], ["Tracks", snap.tracks], ["High", count("HIGH")], ["Medium", count("MEDIUM")], ["Low", count("LOW")]].map(([k, v], i) => (
              <div key={k} className="bg-panel px-3 py-2">
                <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-dim">{k}</div>
                <div className="font-display text-2xl font-semibold leading-tight" style={i >= 3 ? { color: PRIORITY_COLOR[(["HIGH", "MEDIUM", "LOW"] as const)[i - 3]] } : undefined}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(240px,45%)_1fr] bg-panel">
          <FieldMap geo={session.pipeline.geo} trail={snap.trail} live={running}
            drone={snap.pose ? { lat: snap.pose.lat, lon: snap.pose.lon, heading: snap.pose.heading_deg, alt: snap.pose.alt_m } : null}
            footprint={snap.footprint} survivors={snap.survivors} selectedId={selected} onSelect={setSelected} />
          <div className="flex min-h-0 flex-col border-t border-line">
            {sel ? (
              <SurvivorDetail s={sel} ev={ev} onClose={() => setSelected(null)} onStatus={(st) => session.setStatus(sel, st)} timeLabel={timeLabel} />
            ) : (
              <>
                <div className="flex items-center gap-1 border-b border-line px-3 py-2">
                  <span className="mr-auto font-display text-base font-semibold uppercase">Survivors · {snap.survivors.length}</span>
                  {(["ALL", "HIGH", "MEDIUM", "LOW"] as const).map((f) => (
                    <button key={f} onClick={() => setFilter(f)} className={`border px-1.5 py-0.5 font-mono text-[10px] ${filter === f ? "border-ok text-ink" : "border-line text-muted"}`}>{f}</button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {list.length === 0 && <div className="p-6 text-center text-[12.5px] text-dim">{snap.survivors.length ? "None at this priority." : running ? "Searching… a person must be detected consistently 3 times to be confirmed." : "No survivors confirmed."}</div>}
                  {list.map((s) => <SurvivorRow key={s.id} s={s} onClick={() => setSelected(s.id)} timeLabel={timeLabel} />)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
