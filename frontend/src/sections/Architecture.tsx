import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Cable } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Eyebrow, SectionTitle } from "../components/ui";
import { ARCH } from "../lib/content";

const LINKS = ["Video + Telemetry", "Detections + tracks", "Survivor candidates", "Geolocated records", "REST API"];

export default function Architecture() {
  const [active, setActive] = useState(0);
  const a = ARCH[active];
  return (
    <section id="architecture" className="border-t border-line py-24 md:py-32">
      <div className="mx-auto max-w-[1400px] px-4 md:px-8">
        <Eyebrow n="05">System architecture</Eyebrow>
        <SectionTitle sub="Six components with narrow interfaces. Simulation and deployment share everything below the input layer. Select a component.">
          Built to swap the simulator for a real drone
        </SectionTitle>

        <div className="mt-14 grid gap-8 lg:grid-cols-[minmax(0,560px)_1fr]">
          <ol className="relative">
            {ARCH.map((b, i) => (
              <li key={b.id}>
                <button onClick={() => setActive(i)} aria-pressed={i === active}
                  className={`hud-corners group relative flex w-full items-start gap-4 border p-4 text-left transition ${i === active ? "border-signal/70 bg-signal/[0.07]" : "border-line bg-panel hover:border-line-2"}`}>
                  <div className={`grid size-11 shrink-0 place-items-center border ${i === active ? "border-signal text-signal" : "border-line-2 text-muted group-hover:text-ink"}`}>
                    <b.icon size={21} strokeWidth={1.6} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display text-xl font-semibold uppercase tracking-wide">{b.title}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {b.items.map((it) => <span key={it} className="bg-white/5 px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{it}</span>)}
                    </div>
                  </div>
                  {i === 0 && <span className="absolute right-3 top-3 font-mono text-[10px] text-medium">SIMULATED IN PROTOTYPE</span>}
                </button>
                {i < ARCH.length - 1 && (
                  <div className="flex h-11 items-center gap-3 pl-[37px]">
                    <span className="flow-y h-full w-0.5" />
                    <span className="font-mono text-[10.5px] text-dim">{LINKS[i]}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <AnimatePresence mode="wait">
              <motion.div key={a.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.22 }}
                className="border border-line bg-panel">
                <div className="flex items-center gap-3 border-b border-line p-6">
                  <a.icon size={30} className="text-signal" strokeWidth={1.5} />
                  <div>
                    <div className="label">Component {active + 1} / {ARCH.length}</div>
                    <h3 className="font-display text-3xl font-semibold uppercase">{a.title}</h3>
                  </div>
                </div>
                <div className="space-y-6 p-6">
                  <p className="text-[15px] leading-relaxed text-ink/90">{a.role}</p>
                  <div className="grid gap-px bg-line md:grid-cols-2">
                    <div className="bg-panel p-4">
                      <div className="label text-medium">Prototype mode</div>
                      <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{a.prototype}</p>
                    </div>
                    <div className="bg-panel p-4">
                      <div className="label text-ok">Deployment mode</div>
                      <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{a.deployment}</p>
                    </div>
                  </div>
                  <div>
                    <div className="label">Interface</div>
                    <code className="mt-2 block bg-bg px-3 py-2.5 font-mono text-[12.5px] text-hud">{a.iface}</code>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
            <Link to="/hardware" className="mt-4 flex items-center justify-between border border-hud/40 bg-hud/5 px-5 py-4 text-hud transition hover:bg-hud/10">
              <span className="flex items-center gap-3"><Cable size={18} /> How each block maps to physical hardware</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
