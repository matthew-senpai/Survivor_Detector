import { motion } from "framer-motion";
import { ArrowDown, ArrowRight, Cable, Crosshair, Drone, LayoutDashboard, ListOrdered, ScanSearch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DroneFeed from "../components/DroneFeed";
import { PriorityBadge } from "../components/ui";
import { createClock, useClockTime, type Clock } from "../lib/clock";
import { derive, fmtUtc, telemetryAt } from "../lib/mission";
import { useMission } from "../lib/MissionContext";
import type { Bundle } from "../lib/types";

const STORY = [
  { icon: Drone, label: "Drone surveillance" },
  { icon: ScanSearch, label: "AI survivor detection" },
  { icon: Crosshair, label: "Geolocation" },
  { icon: ListOrdered, label: "Rescue prioritization" },
  { icon: LayoutDashboard, label: "Command dashboard" },
];

export default function Hero() {
  const { bundle, error } = useMission();
  const clock = useMemo(() => createClock(HERO_SEGMENT[1], { start: HERO_SEGMENT[0], loop: true, playing: true, speed: 0.6 }), []);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % STORY.length), 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <section id="top" className="relative flex min-h-[100svh] flex-col overflow-hidden bg-bg">
      <div className="absolute inset-0">
        {bundle?.sim ? <DroneFeed bundle={bundle} clock={clock} zoom={0.68} center={HERO_CENTER} sideways hud={false} className="h-full w-full" /> : <div className="grid-bg h-full w-full opacity-60" />}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-bg via-bg/55 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-bg to-transparent" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 items-center px-4 pb-8 pt-28 md:px-8">
        <div className="grid w-full items-end gap-10 lg:grid-cols-[1fr_380px]">
          <div className="max-w-2xl">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="label flex items-center gap-3 text-hud">
              <span className="h-px w-10 bg-hud" /> AI-powered landslide search &amp; rescue
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
              className="mt-5 font-display text-[3.4rem] font-semibold uppercase leading-[0.9] tracking-tight sm:text-7xl xl:text-[6.2rem]">
              Turn aerial disaster footage into <span className="text-signal">survivor locations.</span>
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mt-6 max-w-xl text-base leading-relaxed text-ink/80 md:text-lg">
              Landsight finds people in drone video, tracks each one without double counting, pins them to a coordinate, and ranks who rescue teams should reach first.
            </motion.p>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/command?demo=1" className="flex items-center gap-2 bg-signal px-5 py-3 font-semibold text-black transition hover:bg-[#ff9445]">
                Launch Rescue Command Center <ArrowRight size={18} />
              </Link>
              <a href="#how" className="flex items-center gap-2 border border-line-2 bg-bg/40 px-5 py-3 text-ink backdrop-blur transition hover:border-ink">
                Explore How It Works <ArrowDown size={16} />
              </a>
            </motion.div>
            <Link to="/hardware" className="mt-5 inline-flex items-center gap-2 border-b border-hud/50 pb-0.5 text-sm text-hud transition hover:border-hud">
              <Cable size={15} /> Hardware Integration &amp; Setup: how this connects to a real UAV
            </Link>
            {error && <p className="mt-4 font-mono text-xs text-medium">Mission data unavailable: {error}</p>}
          </div>
          {bundle?.sim && <HudPanel bundle={bundle} clock={clock} />}
        </div>
      </div>

      <div className="relative z-10 border-t border-line bg-bg/70 backdrop-blur">
        <ol className="mx-auto grid max-w-[1400px] grid-cols-5 px-4 md:px-8">
          {STORY.map((s, i) => (
            <li key={s.label} className={`relative flex items-center gap-2.5 py-4 pr-2 text-[12px] transition-colors duration-500 md:text-[13px] ${i <= step ? "text-ink" : "text-dim"}`}>
              <span className={`absolute inset-x-0 top-0 h-0.5 origin-left transition-transform duration-[2200ms] ease-linear ${i < step ? "scale-x-100 bg-hud" : i === step ? "scale-x-100 bg-signal" : "scale-x-0 bg-hud"}`} />
              <s.icon size={17} className={i === step ? "text-signal" : i < step ? "text-hud" : ""} />
              <span className="hidden sm:inline">{s.label}</span>
              {i < STORY.length - 1 && <ArrowRight size={13} className="ml-auto hidden text-dim md:block" />}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// Lane 3 eastbound: a waving survivor, a blue-tarp false alarm, a motionless survivor, a crawler.
const HERO_SEGMENT: [number, number] = [117, 138];
const HERO_CENTER: [number, number] = [0.6, 0.68]; // flight line runs below the HUD panel, right of the headline

function HudPanel({ bundle, clock }: { bundle: Bundle; clock: Clock }) {
  const t = useClockTime(clock, 5);
  const tel = telemetryAt(bundle, t);
  const d = derive(bundle);
  const dets = d.frames.get(Math.floor(t * bundle.mission.fps)) ?? d.frames.get(Math.floor(t * bundle.mission.fps) - 1) ?? [];
  const log = d.events.filter((e) => e.t <= t).slice(-5);

  return (
    <motion.aside initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}
      className="hud-corners hidden self-start border border-line bg-bg/70 font-mono text-[11px] backdrop-blur-md lg:block">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-hud">UAV-01 · SECTOR B-3</span>
        <span className="flex items-center gap-1.5 text-medium"><span className="size-1.5 rounded-full bg-medium blink" />SIMULATION</span>
      </div>
      {tel && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-line px-3 py-2.5 text-muted">
          <span>LAT <b className="font-medium text-ink">{tel.lat.toFixed(6)}</b></span>
          <span>LON <b className="font-medium text-ink">{tel.lon.toFixed(6)}</b></span>
          <span>ALT <b className="font-medium text-ink">{tel.alt_m.toFixed(1)} m AGL</b></span>
          <span>HDG <b className="font-medium text-ink">{String(Math.round(tel.heading_deg)).padStart(3, "0")}°</b></span>
          <span>GPS <b className="font-medium text-ok">3D · {tel.sats} SAT</b></span>
          <span>UTC <b className="font-medium text-ink">{fmtUtc(bundle, t)}</b></span>
        </div>
      )}
      <div className="space-y-1.5 border-b border-line px-3 py-2.5">
        <div className="text-dim">IN FRAME</div>
        {dets.length === 0 && <div className="text-dim">scanning…</div>}
        {dets.map((det, i) => {
          const s = det[6] ? bundle.survivors.find((q) => q.id === det[6]) : undefined;
          const ok = s && s.confirmed_t <= t;
          return (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className={ok ? "text-ink" : "text-hud"}>{ok ? `SURVIVOR ${s!.id}` : det[5] != null ? `TRK ${det[5]} · verifying` : "candidate"}</span>
              <span className="flex items-center gap-2">
                <span className="text-muted">{(det[4] * 100).toFixed(0)}%</span>
                {ok && <PriorityBadge level={s!.priority.level} />}
              </span>
            </div>
          );
        })}
      </div>
      <div className="h-[104px] space-y-1 overflow-hidden px-3 py-2.5">
        {log.map((e, i) => (
          <div key={`${e.t}-${i}`} className={`truncate ${e.kind === "survivor" ? "text-ink" : "text-muted"}`}>
            <span className="text-dim">{fmtUtc(bundle, e.t)}</span> {e.text}
          </div>
        ))}
      </div>
    </motion.aside>
  );
}
