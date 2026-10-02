import { ArrowRight, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import DroneFeed from "../components/DroneFeed";
import { Eyebrow, PriorityBadge, SectionTitle } from "../components/ui";
import { createClock, useClockTime } from "../lib/clock";
import { derive, PRIORITY_COLOR } from "../lib/mission";
import { useMission } from "../lib/MissionContext";
import type { Bundle, Det } from "../lib/types";

const MOMENTS = [
  { t: 68.5, label: "Family group" },
  { t: 119.5, label: "Waving on debris" },
  { t: 131, label: "Crawling survivor" },
  { t: 182.5, label: "Partly buried" },
  { t: 177.5, label: "Under branches" },
  { t: 65.5, label: "False alarm (LOW)" },
];

export default function AiDemo() {
  const { bundle } = useMission();
  return (
    <section id="demo" className="border-t border-line py-24 md:py-32">
      <div className="mx-auto max-w-[1400px] px-4 md:px-8">
        <Eyebrow n="03">Live AI visualization</Eyebrow>
        <SectionTitle sub="This is the recorded sample mission playing through the real pipeline output. Dashed boxes are tracks still being verified; solid boxes are confirmed survivors with a location and a priority.">
          What the drone sees, what the system knows
        </SectionTitle>
        {bundle?.sim ? <Demo bundle={bundle} /> : <div className="mt-10 grid h-80 place-items-center border border-line text-muted">Loading mission data…</div>}
      </div>
    </section>
  );
}

function Demo({ bundle }: { bundle: Bundle }) {
  const clock = useMemo(() => createClock(bundle.mission.duration_s, { start: 0, speed: 1 }), [bundle]);
  const [selected, setSelected] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const t = useClockTime(clock, 5);
  const d = derive(bundle);

  useEffect(() => {
    clock.seek(MOMENTS[0].t);
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? clock.play() : clock.pause()), { threshold: 0.3 });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, [clock]);

  const f0 = Math.floor(t * bundle.mission.fps);
  const current = new Map<string, Det>();
  for (let f = f0; f >= f0 - 2; f--) for (const det of d.frames.get(f) ?? []) {
    const key = det[5] != null ? `t${det[5]}` : `c${f}${det[0]}`;
    if (!current.has(key) && (det[5] != null || f === f0)) current.set(key, det);
  }

  return (
    <div ref={ref} className="mt-12 grid gap-4 lg:grid-cols-[1fr_360px]">
      <div>
        <DroneFeed bundle={bundle} clock={clock} selectedId={selected} onSelect={setSelected} className="aspect-video w-full border border-line" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => (clock.playing ? clock.pause() : clock.play())} className="grid size-9 place-items-center border border-line-2 hover:border-ink" aria-label={clock.playing ? "Pause" : "Play"}>
            {clock.playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <span className="label mr-2">Jump to</span>
          {MOMENTS.map((m) => (
            <button key={m.label} onClick={() => { clock.seek(m.t); clock.play(); }}
              className="border border-line px-2.5 py-1.5 text-[12px] text-muted transition hover:border-hud hover:text-hud">{m.label}</button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-muted">
          <span className="flex items-center gap-2"><span className="h-3 w-4 border border-dashed border-hud" />tracking · verifying</span>
          {(["HIGH", "MEDIUM", "LOW"] as const).map((l) => <span key={l} className="flex items-center gap-2"><span className="h-3 w-4 border-2" style={{ borderColor: PRIORITY_COLOR[l] }} />{l} survivor</span>)}
          <span className="flex items-center gap-2"><span className="h-3 w-4 border border-white/50" />raw detection (no track)</span>
        </div>
      </div>

      <div className="flex flex-col border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="label">Detections in frame #{f0}</span>
          <span className="font-mono text-[11px] text-dim">{current.size} object{current.size === 1 ? "" : "s"}</span>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3 lg:max-h-[440px]">
          {current.size === 0 && <div className="p-6 text-center text-[13px] text-dim">No people in view. The drone is still surveying.</div>}
          {[...current.values()].map((det, i) => {
            const s = det[6] ? bundle.survivors.find((q) => q.id === det[6]) : undefined;
            if (s && s.confirmed_t <= t) {
              return (
                <button key={s.id} onClick={() => setSelected(s.id)}
                  className={`block w-full border p-3 text-left font-mono text-[12px] transition ${selected === s.id ? "border-signal bg-signal/5" : "border-line hover:border-line-2"}`}
                  style={{ boxShadow: `inset 3px 0 0 ${PRIORITY_COLOR[s.priority.level]}` }}>
                  <div className="flex items-center justify-between">
                    <span className="font-display text-lg font-semibold tracking-wide">SURVIVOR {s.id}</span>
                    <PriorityBadge level={s.priority.level} />
                  </div>
                  <div className="mt-1.5 grid grid-cols-[92px_1fr] gap-y-0.5 text-muted">
                    <span>Confidence</span><span className="text-ink">{(det[4] * 100).toFixed(0)}%</span>
                    <span>Movement</span><span className="text-ink">{s.movement.detected ? `Detected · ${s.movement.kind}` : "Not observed"}</span>
                    <span>Location</span><span className="text-ink">{s.lat.toFixed(5)}, {s.lon.toFixed(5)}</span>
                    <span>Tracking</span><span className="text-ink">TRK {s.track_ids.join(", ")}</span>
                    <span>Priority</span><span className="text-ink">{s.priority.score}/{s.priority.max_score} pts</span>
                  </div>
                </button>
              );
            }
            return (
              <div key={i} className="border border-dashed border-line-2 p-3 font-mono text-[12px] text-muted">
                <div className="flex justify-between"><span className="text-hud">{det[5] != null ? `TRACK ${det[5]}` : "CANDIDATE"}</span><span>{(det[4] * 100).toFixed(0)}%</span></div>
                <div className="mt-1 text-[11.5px]">{det[5] != null ? "Verifying: needs 3 consistent hits before it becomes a survivor record." : "Below tracking threshold: kept as evidence, not counted."}</div>
              </div>
            );
          })}
        </div>
        <Link to="/command?demo=1" className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px] text-signal hover:bg-signal/5">
          Run the full demo mission <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}
