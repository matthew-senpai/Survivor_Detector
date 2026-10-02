import { Link } from "react-router-dom";
import { Logo } from "../components/Navbar";
import { Eyebrow } from "../components/ui";

const STACK = ["React + TypeScript", "Tailwind CSS", "Framer Motion", "Leaflet + Esri imagery", "Python · FastAPI", "SQLite (PostgreSQL-ready)", "NumPy · Pillow", "YOLO (ultralytics) · optional", "OpenCV · pymavlink · deployment"];

export default function About() {
  return (
    <>
      <section id="about" className="border-t border-line py-24">
        <div className="mx-auto grid max-w-[1400px] gap-12 px-4 md:px-8 lg:grid-cols-2">
          <div>
            <Eyebrow n="07">About</Eyebrow>
            <h2 className="mt-4 font-display text-4xl font-semibold uppercase leading-none md:text-5xl">An honest prototype</h2>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
              Landsight is a software-first prototype of an aerial survivor-location system for landslide response.
              Everything you see runs on real pipeline code: detection replay, ground-plane tracking, deduplication,
              geolocation, priority scoring and evidence generation. The camera footage, telemetry and people are
              simulated, and every screen that shows them says so.
            </p>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">
              Because the simulator knows where every person really is, the pipeline is scored against ground truth
              (recall, duplicates, location error) instead of being taken on trust. The location shown is illustrative
              and not tied to any real incident.
            </p>
          </div>
          <div>
            <div className="label">Technology</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {STACK.map((s) => <span key={s} className="border border-line px-3 py-1.5 text-[13px] text-ink/85">{s}</span>)}
            </div>
            <div className="label mt-8">Explore</div>
            <div className="mt-3 grid gap-px bg-line sm:grid-cols-3">
              {[["/command?demo=1", "Guided demo mission"], ["/hardware", "Hardware integration"], ["/#how", "Pipeline stages"]].map(([to, l]) => (
                <Link key={to} to={to} className="bg-bg p-4 text-[14px] text-ink transition hover:bg-panel hover:text-signal">{l} →</Link>
              ))}
            </div>
          </div>
        </div>
      </section>
      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 text-[12px] text-dim md:flex-row md:items-center md:justify-between md:px-8">
          <Logo />
          <span>Satellite imagery © Esri, Maxar, Earthstar Geographics. Sample data is synthetic.</span>
        </div>
      </footer>
    </>
  );
}
