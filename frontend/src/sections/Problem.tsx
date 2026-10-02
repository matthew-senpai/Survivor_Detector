import { motion } from "framer-motion";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Eyebrow, SectionTitle } from "../components/ui";
import { PROBLEM } from "../lib/content";
import { fmtArea } from "../lib/mission";
import { useMission } from "../lib/MissionContext";

export default function Problem() {
  const { bundle } = useMission();
  const m = bundle?.metrics;
  return (
    <section id="problem" className="relative overflow-hidden border-t border-line py-24 md:py-32">
      {bundle?.sim && (
        <img src={bundle.mission.asset_base + bundle.sim.terrain} alt="" aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.12] grayscale" />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bg via-bg/80 to-bg" />
      <div className="relative mx-auto max-w-[1400px] px-4 md:px-8">
        <Eyebrow n="01">The problem</Eyebrow>
        <SectionTitle sub="After a landslide, the people who survive the first minutes are hard to find and harder to reach. The bottleneck is not courage, it's information.">
          Every hour, a smaller chance
        </SectionTitle>

        <ol className="mt-16 grid gap-0 md:grid-cols-6">
          {PROBLEM.map((p, i) => (
            <motion.li key={p.title} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: i * 0.14, duration: 0.5 }} className="relative flex gap-4 pb-8 md:block md:pb-0 md:pr-4">
              <div className="relative flex flex-col items-center md:flex-row">
                <div className={`grid size-14 shrink-0 place-items-center border ${i >= 3 ? "border-high/50 bg-high/10 text-high" : "border-line-2 bg-panel text-ink"}`}>
                  <p.icon size={24} strokeWidth={1.6} />
                </div>
                {i < PROBLEM.length - 1 && (
                  <motion.div initial={{ scaleX: 0, scaleY: 0 }} whileInView={{ scaleX: 1, scaleY: 1 }} viewport={{ once: true }}
                    transition={{ delay: i * 0.14 + 0.3, duration: 0.5 }}
                    className="mt-2 w-px flex-1 origin-top bg-line-2 md:mx-2 md:mt-0 md:h-px md:w-auto md:origin-left" />
                )}
                {i < PROBLEM.length - 1 && <ArrowRight size={14} className="absolute right-0 top-5 hidden text-dim md:block" />}
                {i < PROBLEM.length - 1 && <ArrowDown size={14} className="absolute -bottom-1 left-5 text-dim md:hidden" />}
              </div>
              <div className="md:mt-5">
                <div className="font-mono text-[11px] text-dim">0{i + 1}</div>
                <h3 className="font-display text-xl font-semibold uppercase tracking-wide">{p.title}</h3>
                <p className="mt-1 text-[13.5px] leading-snug text-muted">{p.text}</p>
              </div>
            </motion.li>
          ))}
        </ol>

        {m && (
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            className="mt-20 grid border border-line bg-panel/70 backdrop-blur md:grid-cols-[220px_repeat(4,1fr)]">
            <div className="border-b border-line p-5 md:border-b-0 md:border-r">
              <div className="label text-hud">With Landsight</div>
              <div className="mt-1 text-[13px] text-muted">Sample mission, Sector B-3 (simulated data)</div>
            </div>
            {[
              [fmtArea(m.area_scanned_m2), `imaged in ${Math.floor(bundle!.mission.duration_s / 60)} min ${Math.round(bundle!.mission.duration_s % 60)} s`],
              [`${m.sim_truth?.found ?? m.unique_survivors}/${m.sim_truth?.ground_truth_people ?? "?"}`, "people located, incl. buried & occluded"],
              [`±${m.sim_truth?.mean_geo_error_m ?? "?"} m`, "mean location error vs ground truth"],
              [`${m.duplicates_suppressed}`, "double counts prevented across passes"],
            ].map(([v, l]) => (
              <div key={l} className="border-b border-line p-5 last:border-0 md:border-b-0 md:border-r">
                <div className="font-display text-4xl font-semibold text-ink">{v}</div>
                <div className="mt-1 text-[13px] text-muted">{l}</div>
              </div>
            ))}
          </motion.div>
        )}
      </div>
    </section>
  );
}
