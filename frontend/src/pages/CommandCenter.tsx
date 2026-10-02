import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, ChevronRight, Cpu, Database, Drone, LoaderCircle, Pause, Play, Radio, RotateCcw, Satellite, Settings2,
  SkipForward, Video, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import DroneFeed from "../components/DroneFeed";
import RescueMap from "../components/RescueMap";
import SimControls from "../components/SimControls";
import SurvivorPanel from "../components/SurvivorPanel";
import { ModeBadge, PriorityBadge } from "../components/ui";
import { api, STATIC_DEMO } from "../lib/api";
import { createClock, useClockState, useClockTime, type Clock } from "../lib/clock";
import { derive, fmtArea, fmtT, fmtUtc, PRIORITY_COLOR, statsAt, STATUS_LABEL, telemetryAt, visibleSurvivors } from "../lib/mission";
import { useMission } from "../lib/MissionContext";
import type { Bundle, Priority, SurvivorStatus } from "../lib/types";

const SPEEDS = [1, 2, 4, 8, 16];
const RANK: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export default function CommandCenter() {
  const { bundle, loading, error, openMission } = useMission();
  if (!bundle) {
    return (
      <div className="grid h-[100dvh] place-items-center bg-bg p-6 text-center">
        {loading ? <div className="flex items-center gap-3 font-mono text-sm text-hud"><LoaderCircle className="animate-spin" size={18} /> Connecting to mission data…</div> : (
          <div className="max-w-md">
            <div className="font-display text-3xl font-semibold uppercase">Mission data unavailable</div>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <button onClick={() => openMission("SIM-B3-0001")} className="mt-5 bg-signal px-4 py-2 text-sm font-semibold text-black">Retry</button>
          </div>
        )}
      </div>
    );
  }
  return <Dashboard key={bundle.mission.id} bundle={bundle} />;
}

function Dashboard({ bundle }: { bundle: Bundle }) {
  const [params] = useSearchParams();
  const { source, apiOnline, latencyMs, replaceBundle } = useMission();
  const live = bundle.mission.status === "live";
  const clock = useMemo(() => createClock(bundle.mission.duration_s, { playing: !live, speed: 4, start: 0 }), [bundle.mission.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useClockState(clock);
  const t = useClockTime(clock, 6);
  const [selected, setSelected] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, SurvivorStatus>>({});
  const [controls, setControls] = useState(false);
  const [walkthrough, setWalkthrough] = useState(params.get("demo") === "1");
  const [filter, setFilter] = useState<Priority | "ALL">("ALL");

  // Live (deployment) missions: poll for new snapshots and follow the live edge.
  useEffect(() => {
    if (!live) return;
    clock.seek(bundle.mission.duration_s);
    const id = setInterval(async () => {
      try {
        const b = await api.bundle(bundle.mission.id);
        clock.end = b.mission.duration_s;
        clock.seek(b.mission.duration_s);
        replaceBundle(b);
      } catch { /* keep last snapshot */ }
    }, 3000);
    return () => clearInterval(id);
  }, [live, bundle.mission.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const survivors = visibleSurvivors(bundle, t).map((s) => ({ ...s, status: overrides[s.id] ?? s.status }));
  const listed = survivors.filter((s) => filter === "ALL" || s.priority.level === filter)
    .sort((a, b) => RANK[a.priority.level] - RANK[b.priority.level] || a.confirmed_t - b.confirmed_t);
  const sel = survivors.find((s) => s.id === selected);
  const stats = statsAt(bundle, t);
  const tel = telemetryAt(bundle, t);
  const gpsLost = !!tel && tel.gps_fix < 2;
  const systemOk = (STATIC_DEMO || apiOnline !== false) && !gpsLost && bundle.warnings.length === 0;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg lg:h-[100dvh]">
      <Header bundle={bundle} t={t} systemOk={systemOk} gpsLost={gpsLost} source={source} apiOnline={apiOnline} latencyMs={latencyMs} live={live}
        onControls={() => setControls(!controls)} />

      <div className="grid flex-1 gap-px bg-line lg:min-h-0 lg:grid-cols-[minmax(340px,400px)_1fr_minmax(340px,380px)]">
        {/* left: feed + transport + system panel */}
        <div className="flex min-h-0 flex-col bg-bg">
          <DroneFeed bundle={bundle} clock={clock} selectedId={selected} onSelect={setSelected} className="aspect-video w-full" />
          <Transport clock={clock} bundle={bundle} t={t} live={live} onPick={setSelected} />
          <SystemPanel bundle={bundle} t={t} apiOnline={apiOnline} latencyMs={latencyMs} source={source} />
        </div>

        {/* centre: stats + map */}
        <div className="flex min-h-[520px] flex-col bg-bg lg:min-h-0">
          <div className="grid grid-cols-3 gap-px bg-line sm:grid-cols-7">
            <Stat k="Total detections" v={stats.detections} />
            <Stat k="Unique survivors" v={stats.survivors} accent />
            <Stat k="High priority" v={stats.high} color={PRIORITY_COLOR.HIGH} />
            <Stat k="Medium priority" v={stats.medium} color={PRIORITY_COLOR.MEDIUM} />
            <Stat k="Low / unverified" v={stats.low} color={PRIORITY_COLOR.LOW} />
            <Stat k="Area scanned" v={fmtArea(stats.areaM2)} />
            <Stat k="Frames processed" v={stats.frames.toLocaleString()} />
          </div>
          <div className="relative flex-1">
            <RescueMap bundle={bundle} t={t} selectedId={selected} onSelect={setSelected} className="absolute inset-0" />
            <AnimatePresence>
              {walkthrough && <Walkthrough bundle={bundle} t={t} clock={clock} onOpen={setSelected} onClose={() => setWalkthrough(false)} />}
            </AnimatePresence>
          </div>
        </div>

        {/* right: survivor list / detail */}
        <div className="flex min-h-[480px] flex-col bg-panel lg:min-h-0">
          {sel ? (
            <SurvivorPanel bundle={bundle} survivor={sel} onClose={() => setSelected(null)} canEdit={source === "api" && !!apiOnline}
              onStatus={(st) => setOverrides((o) => ({ ...o, [sel.id]: st }))} />
          ) : (
            <>
              <div className="border-b border-line px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-lg font-semibold uppercase tracking-wide">Survivors</span>
                  <span className="font-mono text-[11px] text-dim">{survivors.length} confirmed · {bundle.metrics.duplicates_suppressed} merged</span>
                </div>
                <div className="mt-2 flex gap-1">
                  {(["ALL", "HIGH", "MEDIUM", "LOW"] as const).map((f) => (
                    <button key={f} onClick={() => setFilter(f)}
                      className={`flex-1 border py-1 font-mono text-[10.5px] ${filter === f ? "border-signal text-ink" : "border-line text-muted hover:text-ink"}`}>{f}</button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {listed.length === 0 && (
                  <div className="p-8 text-center text-[13px] text-dim">
                    {survivors.length === 0 ? (t < 5 ? "Survey starting…" : "No survivors confirmed yet. Tracks need 3 consistent hits.") : "None at this priority."}
                  </div>
                )}
                <AnimatePresence initial={false}>
                  {listed.map((s) => (
                    <motion.button layout key={s.id} initial={{ opacity: 0, x: 16, backgroundColor: "rgba(255,122,26,0.25)" }} animate={{ opacity: 1, x: 0, backgroundColor: "rgba(0,0,0,0)" }}
                      transition={{ duration: 0.6 }} onClick={() => setSelected(s.id)}
                      className="block w-full border-b border-line px-4 py-3 text-left transition hover:bg-white/[0.03]"
                      style={{ boxShadow: `inset 3px 0 0 ${PRIORITY_COLOR[s.priority.level]}` }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-lg font-semibold tracking-wide">{s.id}</span>
                        <PriorityBadge level={s.priority.level} />
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted">
                        <span>{s.lat.toFixed(5)}, {s.lon.toFixed(5)}</span>
                        <span className="text-right">conf {(s.confidence * 100).toFixed(0)}%</span>
                        <span>{s.movement.detected ? <span className="text-ok">● moving</span> : "○ no movement"}</span>
                        <span className="text-right">{fmtUtc(bundle, s.confirmed_t)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[11.5px]">
                        <span className={s.status === "new" ? "text-signal" : s.status === "rescued" ? "text-ok" : "text-ink/80"}>{STATUS_LABEL[s.status]}</span>
                        <ChevronRight size={14} className="text-dim" />
                      </div>
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            </>
          )}
        </div>
      </div>
      <AnimatePresence>{controls && <SimControls bundle={bundle} onClose={() => setControls(false)} />}</AnimatePresence>
    </div>
  );
}

function Header({ bundle, t, systemOk, gpsLost, source, apiOnline, latencyMs, live, onControls }: {
  bundle: Bundle; t: number; systemOk: boolean; gpsLost: boolean; source: string | null; apiOnline: boolean | null;
  latencyMs: number | null; live: boolean; onControls: () => void;
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const done = t >= bundle.mission.duration_s - 0.05;
  const status = live ? "LIVE" : done ? "SURVEY COMPLETE" : "IN PROGRESS (REPLAY)";
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-panel px-4 py-2.5">
      <Link to="/" className="flex items-center gap-2 text-muted hover:text-ink" aria-label="Back to site"><ArrowLeft size={16} /><span className="font-display text-base font-semibold tracking-[0.18em] text-ink">LANDSIGHT</span></Link>
      <div className="h-6 w-px bg-line" />
      <div className="min-w-0">
        <div className="truncate font-display text-[17px] font-semibold uppercase leading-tight tracking-wide">{bundle.mission.name}</div>
        <div className="font-mono text-[10.5px] text-dim">{bundle.mission.id} · {bundle.mission.area}</div>
      </div>
      <HeaderChip k="Mission" v={status} color={live ? "text-ok" : done ? "text-hud" : "text-signal"} />
      <ModeBadge mode={bundle.mission.mode} compact />
      <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">
        <HeaderChip k="Connection" v={STATIC_DEMO ? "STATIC DEMO · PRECOMPUTED" : apiOnline ? `API ONLINE · ${latencyMs ?? "–"} ms` : apiOnline === false ? "API OFFLINE · CACHED" : "CHECKING…"}
          color={STATIC_DEMO ? "text-hud" : apiOnline ? "text-ok" : apiOnline === false ? "text-medium" : "text-muted"} />
        <HeaderChip k="System" v={gpsLost ? "DEGRADED · GPS" : systemOk ? "NOMINAL" : source === "cached" ? "DEGRADED · OFFLINE" : "CHECK WARNINGS"} color={systemOk ? "text-ok" : "text-medium"} />
        <HeaderChip k="Mission time" v={`${fmtUtc(bundle, t)} · ${fmtT(t)}`} color="text-ink" />
        <HeaderChip k="Local time" v={now.toLocaleTimeString([], { hour12: false })} color="text-ink" />
        <button onClick={onControls} className="flex items-center gap-2 border border-medium/50 px-3 py-1.5 text-[12px] text-medium hover:bg-medium/10">
          <Settings2 size={14} /> Simulation
        </button>
      </div>
    </header>
  );
}

function HeaderChip({ k, v, color }: { k: string; v: string; color: string }) {
  return (
    <div>
      <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">{k}</div>
      <div className={`font-mono text-[12px] font-medium ${color}`}>{v}</div>
    </div>
  );
}

function Stat({ k, v, color, accent }: { k: string; v: string | number; color?: string; accent?: boolean }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-dim">{k}</div>
      <div className={`font-display text-xl font-semibold leading-tight xl:text-2xl ${accent ? "text-signal" : ""}`} style={color ? { color } : undefined}>{v}</div>
    </div>
  );
}

function Transport({ clock, bundle, t, live, onPick }: { clock: Clock; bundle: Bundle; t: number; live: boolean; onPick: (id: string) => void }) {
  const dur = bundle.mission.duration_s;
  return (
    <div className="border-b border-line px-3 py-2.5">
      <div className="relative">
        <input type="range" className="scrub w-full" min={0} max={dur} step={0.1} value={t} aria-label="Mission timeline"
          onChange={(e) => clock.seek(Number(e.target.value))} />
        {derive(bundle).survivorsByTime.map((s) => (
          <button key={s.id} title={`${s.id} confirmed ${fmtT(s.confirmed_t)}`} onClick={() => { clock.seek(s.confirmed_t); onPick(s.id); }}
            className="absolute -top-1 h-2 w-1" style={{ left: `${(s.confirmed_t / dur) * 100}%`, background: PRIORITY_COLOR[s.priority.level] }} />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <button onClick={() => (clock.playing ? clock.pause() : clock.play())} disabled={live} aria-label={clock.playing ? "Pause" : "Play"}
          className="grid size-8 place-items-center bg-signal text-black disabled:opacity-40">{clock.playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <button onClick={() => { clock.seek(0); clock.play(); }} aria-label="Restart" className="grid size-8 place-items-center border border-line text-muted hover:text-ink"><RotateCcw size={14} /></button>
        <button onClick={() => { clock.seek(dur); clock.pause(); }} aria-label="Skip to end" className="grid size-8 place-items-center border border-line text-muted hover:text-ink"><SkipForward size={14} /></button>
        <div className="ml-1 flex">
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => clock.setSpeed(s)} className={`border px-1.5 py-1 font-mono text-[10.5px] ${clock.speed === s ? "border-signal text-ink" : "border-line text-dim hover:text-ink"}`}>{s}×</button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[11px] text-muted">{fmtT(t)} / {fmtT(dur)}</span>
      </div>
    </div>
  );
}

function SystemPanel({ bundle, t, apiOnline, latencyMs, source }: { bundle: Bundle; t: number; apiOnline: boolean | null; latencyMs: number | null; source: string | null }) {
  const tel = telemetryAt(bundle, t);
  const done = t >= bundle.mission.duration_s - 0.05;
  const f = Math.floor(t * bundle.mission.fps);
  const nDet = derive(bundle).frames.get(f)?.length ?? 0;
  const sim = bundle.mission.mode === "simulation";
  const rows: { icon: typeof Drone; k: string; state: string; ok: "ok" | "warn" | "bad"; detail: string }[] = [
    { icon: Drone, k: "Drone", state: done ? "SURVEY DONE" : "AIRBORNE", ok: "ok",
      detail: tel ? `${tel.alt_m.toFixed(1)} m AGL · ${tel.speed_mps.toFixed(1)} m/s · HDG ${Math.round(tel.heading_deg)}°${tel.battery_pct >= 0 ? ` · BAT ${tel.battery_pct.toFixed(0)}%` : ""}` : "no telemetry" },
    { icon: Satellite, k: "GPS / GNSS", state: !tel ? "NO DATA" : tel.gps_fix < 2 ? "NO FIX" : tel.gps_fix >= 4 ? "RTK/DGPS" : "3D FIX", ok: !tel || tel.gps_fix < 2 ? "bad" : "ok",
      detail: tel ? `${tel.sats} sats · HDOP ${tel.hdop.toFixed(2)}${tel.gps_fix < 2 ? " · geolocation paused" : ""}` : "" },
    { icon: Video, k: "Camera", state: sim ? "REPLAY" : bundle.mission.mode === "upload" ? "REPLAY" : "LIVE", ok: "ok",
      detail: `${sim ? "Synthetic recorded footage" : bundle.mission.source.video} · ${bundle.camera.image_width}×${bundle.camera.image_height}` },
    { icon: Cpu, k: "AI inference", state: "RUNNING", ok: "ok", detail: `${bundle.mission.source.detector} · ${bundle.mission.fps} fps · ${nDet} det in frame` },
    { icon: Radio, k: "Telemetry", state: sim || bundle.mission.mode === "upload" ? "CSV REPLAY" : "MAVLINK", ok: tel ? "ok" : "warn",
      detail: `${bundle.mission.source.telemetry} · ${Math.round(bundle.telemetry.rows.length / bundle.mission.duration_s)} Hz` },
    STATIC_DEMO
      ? { icon: Database, k: "Backend", state: "STATIC", ok: "ok", detail: "Precomputed pipeline output · no live API in this deployment" }
      : { icon: Database, k: "Backend", state: apiOnline ? "ONLINE" : apiOnline === false ? "OFFLINE" : "…", ok: apiOnline ? "ok" : "warn",
        detail: apiOnline ? `FastAPI · ${latencyMs} ms · ${source === "api" ? "live records" : "cached"}` : "Cached mission data (read-only)" },
  ];
  const dot = { ok: "bg-ok", warn: "bg-medium", bad: "bg-high blink" };
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="label px-4 pb-1 pt-3">Mission systems</div>
      {rows.map((r) => (
        <div key={r.k} className="flex items-start gap-3 border-b border-line px-4 py-2">
          <r.icon size={16} className="mt-0.5 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px]">{r.k}</span>
              <span className="flex items-center gap-1.5 font-mono text-[10.5px]"><span className={`size-1.5 rounded-full ${dot[r.ok]}`} />{r.state}</span>
            </div>
            <div className="truncate font-mono text-[10.5px] text-dim" title={r.detail}>{r.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Walkthrough({ bundle, t, clock, onOpen, onClose }: { bundle: Bundle; t: number; clock: Clock; onOpen: (id: string) => void; onClose: () => void }) {
  const d = derive(bundle);
  const byTime = d.survivorsByTime;
  const first = byTime[0];
  const firstHigh = byTime.find((s) => s.priority.level === "HIGH");
  const firstTrackEvt = d.events.find((e) => e.kind === "track");
  const steps = [
    { k: "Drone footage", at: 0, text: `UAV-01 enters Sector ${bundle.mission.sector} at ${telemetryAt(bundle, 0)?.alt_m.toFixed(0) ?? 30} m AGL. Recorded footage and telemetry are replayed through the pipeline.` },
    { k: "AI detection", at: d.firstDetection, text: "The detector flags a person-shaped object. One box in one frame is not a survivor yet." },
    { k: "Tracking", at: firstTrackEvt?.t ?? Infinity, text: `${firstTrackEvt?.text ?? "Track started"}. A track needs 3 consistent hits on the ground before it counts.` },
    { k: "Geolocation", at: first?.confirmed_t ?? Infinity, text: first ? `${first.id} pinned to ${first.lat.toFixed(6)}, ${first.lon.toFixed(6)} (±${first.uncertainty_m.toFixed(1)} m) from drone GPS, altitude, heading and camera geometry.` : "" },
    { k: "Prioritization", at: (first?.confirmed_t ?? Infinity) + 4, text: first ? `${first.id} scored ${first.priority.score}/${first.priority.max_score} → ${first.priority.level}. Every point is explained in its record.` : "", action: first?.id },
    { k: "Rescue map", at: byTime[2]?.confirmed_t ?? Infinity, text: "Each confirmed survivor appears on the map with its uncertainty. People seen again on the next survey lane are merged, not double counted." },
    { k: "Evidence", at: firstHigh ? firstHigh.confirmed_t + 3 : Infinity, text: firstHigh ? `${firstHigh.id} is HIGH priority. Open its evidence: original frame, close-up crop, timestamp, GPS estimate and track ID.` : "", action: firstHigh?.id },
    { k: "Command center", at: bundle.mission.duration_s - 0.1, text: `Survey complete: ${bundle.survivors.length} records, ${bundle.metrics.duplicates_suppressed} duplicates merged. Set each survivor's rescue status as teams are dispatched.` },
  ];
  const cur = Math.max(0, steps.findLastIndex((s) => t >= s.at));
  const step = steps[cur];
  return (
    <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
      className="absolute left-14 right-3 top-3 z-[600] border border-signal/50 bg-bg/92 backdrop-blur-md xl:left-auto xl:w-[560px]">
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <span className="label mr-2 text-signal">Guided demo</span>
        {steps.map((s, i) => (
          <button key={s.k} title={s.k} onClick={() => isFinite(s.at) && clock.seek(Math.min(s.at + 0.01, bundle.mission.duration_s))}
            className={`h-1.5 flex-1 ${i < cur ? "bg-hud" : i === cur ? "bg-signal" : "bg-line-2"}`} />
        ))}
        <button onClick={onClose} aria-label="Close guided demo" className="ml-2 text-muted hover:text-ink"><X size={15} /></button>
      </div>
      <div className="flex items-start gap-3 p-3">
        <div className="font-mono text-[11px] text-dim">{String(cur + 1).padStart(2, "0")}/{steps.length}</div>
        <div className="flex-1">
          <div className="font-display text-lg font-semibold uppercase leading-tight">{step.k}</div>
          <p className="mt-0.5 text-[13px] leading-snug text-ink/85">{step.text}</p>
        </div>
        {step.action && <button onClick={() => onOpen(step.action!)} className="shrink-0 self-center bg-signal px-3 py-1.5 text-[12px] font-semibold text-black">Open {step.action}</button>}
      </div>
    </motion.div>
  );
}
