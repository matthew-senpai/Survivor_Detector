import { motion } from "framer-motion";
import { ArrowRight, Cpu, FileSpreadsheet, Radio, Video } from "lucide-react";
import { Link } from "react-router-dom";
import { Eyebrow } from "../components/ui";

const MODES = [
  {
    tag: "SIMULATION MODE", color: "text-medium", border: "border-medium/40", line: "Using recorded drone footage and simulated telemetry.",
    inputs: [[Video, "Recorded / synthetic aerial video"], [FileSpreadsheet, "telemetry.csv (GPS drift + dropout)"], [Cpu, "Pre-recorded detections or YOLO on upload"]],
  },
  {
    tag: "DEPLOYMENT MODE", color: "text-ok", border: "border-ok/40", line: "Receiving live UAV video and telemetry.",
    inputs: [[Video, "Gimbal camera over RTSP / CSI"], [Radio, "MAVLink from PX4 / ArduPilot"], [Cpu, "YOLO + TensorRT on Jetson-class edge"]],
  },
] as const;

export default function Modes() {
  return (
    <section className="relative overflow-hidden border-t border-line bg-panel/40 py-24">
      <div className="mx-auto max-w-[1400px] px-4 md:px-8">
        <Eyebrow n="06">Two modes, one pipeline</Eyebrow>
        <div className="mt-10 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
          {MODES.map((m, i) => (
            <motion.div key={m.tag} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
              className={`border ${m.border} bg-bg p-6 ${i === 1 ? "lg:order-3" : ""}`}>
              <div className={`font-mono text-xs font-semibold tracking-[0.16em] ${m.color}`}>● {m.tag}</div>
              <p className="mt-2 font-display text-2xl font-semibold uppercase">{m.line}</p>
              <ul className="mt-5 space-y-2.5">
                {m.inputs.map(([Icon, label]) => (
                  <li key={label} className="flex items-center gap-3 text-[14px] text-ink/85"><Icon size={17} className="text-muted" />{label}</li>
                ))}
              </ul>
            </motion.div>
          ))}
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-4 lg:order-2">
            <div className="hidden h-px w-24 flow-x lg:block" />
            <div className="border border-line-2 bg-bg px-4 py-3 text-center">
              <div className="label">Same code path</div>
              <div className="mt-1 font-mono text-[12px] text-hud">detect → geolocate → track<br />→ analyse → dedup → prioritise</div>
            </div>
            <div className="hidden h-px w-24 flow-x lg:block" />
          </div>
        </div>
        <Link to="/hardware" className="mt-8 flex flex-col items-start justify-between gap-3 bg-hud px-6 py-5 text-black transition hover:bg-[#7ff7d2] md:flex-row md:items-center">
          <span>
            <span className="block font-display text-2xl font-semibold uppercase">Hardware Integration &amp; Setup</span>
            <span className="text-[14px] text-black/70">Drone, camera, edge computer, data links, wiring diagram and configuration steps.</span>
          </span>
          <ArrowRight size={22} />
        </Link>
      </div>
    </section>
  );
}
