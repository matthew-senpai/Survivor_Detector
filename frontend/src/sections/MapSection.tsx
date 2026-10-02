import { useState } from "react";
import RescueMap from "../components/RescueMap";
import SurvivorPanel from "../components/SurvivorPanel";
import { Eyebrow, PriorityBadge, SectionTitle } from "../components/ui";
import { useMission } from "../lib/MissionContext";

export default function MapSection() {
  const { bundle, source } = useMission();
  const [sel, setSel] = useState<string | null>(null);
  const s = bundle?.survivors.find((q) => q.id === (sel ?? bundle.survivors.find((x) => x.priority.level === "HIGH")?.id));

  return (
    <section id="map" className="border-t border-line bg-panel/40 py-24 md:py-32">
      <div className="mx-auto max-w-[1400px] px-4 md:px-8">
        <Eyebrow n="04">Interactive rescue map</Eyebrow>
        <SectionTitle sub="The completed sample mission over satellite imagery: affected zone, sector grid, the flown survey track, rescue teams, and every survivor as a coordinate. Click a marker.">
          Every survivor is a coordinate
        </SectionTitle>
        {bundle ? (
          <div className="mt-12 grid border border-line lg:grid-cols-[1fr_380px]">
            <div className="relative">
              <RescueMap bundle={bundle} t={bundle.mission.duration_s} selectedId={s?.id} onSelect={setSel} scrollZoom={false} className="relative h-[520px] lg:h-[640px]" />
              <div className="pointer-events-none absolute right-3 top-3 z-[500] flex flex-wrap justify-end gap-1.5">
                {(["HIGH", "MEDIUM", "LOW"] as const).map((l) => (
                  <span key={l} className="flex items-center gap-1.5 bg-bg/85 px-2 py-1 font-mono text-[11px] backdrop-blur">
                    <PriorityBadge level={l} /> {bundle.metrics.priority_counts[l]}
                  </span>
                ))}
              </div>
            </div>
            <div className="h-[640px] border-t border-line bg-panel lg:border-l lg:border-t-0">
              {s && <SurvivorPanel bundle={bundle} survivor={s} canEdit={false} />}
            </div>
          </div>
        ) : <div className="mt-10 grid h-80 place-items-center border border-line text-muted">Loading mission data…</div>}
        {source === "cached" && <p className="mt-3 font-mono text-[11px] text-medium">Backend offline: showing the cached sample mission bundled with the frontend.</p>}
      </div>
    </section>
  );
}
