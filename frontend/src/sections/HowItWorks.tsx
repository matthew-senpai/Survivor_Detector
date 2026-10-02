import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Eyebrow, SectionTitle } from "../components/ui";
import { STAGES } from "../lib/content";

export default function HowItWorks() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setActive((a) => (a + 1) % STAGES.length), 4200);
    return () => clearInterval(id);
  }, [auto]);
  const s = STAGES[active];
  const pick = (i: number) => { setActive(i); setAuto(false); };

  return (
    <section id="how" className="border-t border-line bg-panel/40 py-24 md:py-32">
      <div className="mx-auto max-w-[1400px] px-4 md:px-8">
        <Eyebrow n="02">How the system works</Eyebrow>
        <SectionTitle sub="Nine stages, one direction of flow. Click any stage to see what goes in, what comes out, and the real hardware or software behind it.">
          From pixels to a rescue order
        </SectionTitle>

        <div className="relative mt-14 overflow-x-auto pb-2">
          <ol className="flex min-w-[980px] items-stretch">
            {STAGES.map((st, i) => (
              <li key={st.id} className="flex flex-1 items-center">
                <button onClick={() => pick(i)} aria-pressed={i === active}
                  className={`group relative flex w-full flex-col items-center gap-2 border px-1.5 py-4 text-center transition ${i === active ? "border-signal bg-signal/10" : i < active ? "border-hud/30 bg-hud/5" : "border-line bg-panel hover:border-line-2"}`}>
                  <span className="font-mono text-[10px] text-dim">{String(i + 1).padStart(2, "0")}</span>
                  <st.icon size={22} strokeWidth={1.6} className={i === active ? "text-signal" : i < active ? "text-hud" : "text-muted group-hover:text-ink"} />
                  <span className={`font-display text-[13px] font-semibold uppercase leading-tight tracking-wide ${i === active ? "text-ink" : "text-muted"}`}>{st.title}</span>
                  {i === active && <motion.span layoutId="stage-bar" className="absolute inset-x-0 -bottom-px h-0.5 bg-signal" />}
                </button>
                {i < STAGES.length - 1 && <span className={`h-0.5 w-5 shrink-0 ${i < active ? "flow-x" : "bg-line-2"}`} />}
              </li>
            ))}
          </ol>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}
            className="mt-6 grid border border-line bg-bg lg:grid-cols-[1.2fr_1fr_1.4fr_1fr]">
            <div className="border-b border-line p-6 lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-3">
                <s.icon size={28} className="text-signal" strokeWidth={1.5} />
                <h3 className="font-display text-3xl font-semibold uppercase">{s.title}</h3>
              </div>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink/85">{s.what}</p>
            </div>
            {([["Input", s.input], ["Processing", s.processing], ["Output", s.output]] as const).map(([k, v]) => (
              <div key={k} className="border-b border-line p-6 lg:border-b-0 lg:border-r">
                <div className="label">{k}</div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{v}</p>
              </div>
            ))}
            <div className="border-t border-line bg-panel/60 p-6 lg:col-span-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div><div className="label text-hud">Real-world equivalent</div><p className="mt-1.5 text-[13.5px] text-ink/85">{s.real}</p></div>
                <div><div className="label">Implemented in</div><p className="mt-1.5 font-mono text-[12.5px] text-muted">{s.module}</p></div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
