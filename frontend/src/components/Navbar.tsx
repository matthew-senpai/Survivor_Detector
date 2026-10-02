import { ArrowRight, Cable, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const LINKS = [
  { to: "/#top", label: "Home" },
  { to: "/#how", label: "How It Works" },
  { to: "/#architecture", label: "Architecture" },
  { to: "/#demo", label: "Live Demo" },
  { to: "/command", label: "Command Center" },
  { to: "/#about", label: "About" },
];

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <path d="M4 24 L16 6 L28 24" stroke="#ff7a1a" strokeWidth="3" fill="none" />
        <circle cx="16" cy="19" r="3.4" fill="#5ef2c2" />
        <circle cx="16" cy="19" r="7" stroke="#5ef2c2" strokeOpacity=".4" fill="none" />
      </svg>
      <span className="font-display text-xl font-semibold tracking-[0.18em]">LANDSIGHT</span>
    </Link>
  );
}

export default function Navbar() {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => setOpen(false), [loc]);

  return (
    <header className={`fixed inset-x-0 top-0 z-[1000] transition-colors duration-300 ${solid || open ? "border-b border-line bg-bg/90 backdrop-blur-md" : "bg-gradient-to-b from-black/60 to-transparent"}`}>
      <nav className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-4 md:px-8" aria-label="Main">
        <Logo />
        <div className="hidden items-center gap-6 lg:flex">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="text-[13px] text-muted transition hover:text-ink">{l.label}</Link>
          ))}
          <Link to="/hardware" className="flex items-center gap-1.5 border border-hud/40 px-2.5 py-1 text-[13px] text-hud transition hover:bg-hud/10">
            <Cable size={14} /> Hardware Integration
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/command" className="hidden items-center gap-2 bg-signal px-4 py-2 text-[13px] font-semibold text-black transition hover:bg-[#ff9445] sm:flex">
            Launch Command Center <ArrowRight size={15} />
          </Link>
          <button className="p-2 text-ink lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>{open ? <X /> : <Menu />}</button>
        </div>
      </nav>
      {open && (
        <div className="border-t border-line px-4 pb-4 lg:hidden">
          {[...LINKS, { to: "/hardware", label: "Hardware Integration & Setup" }].map((l) => (
            <Link key={l.to} to={l.to} className="block border-b border-line py-3 text-sm text-ink">{l.label}</Link>
          ))}
          <Link to="/command" className="mt-3 flex items-center justify-center gap-2 bg-signal py-2.5 text-sm font-semibold text-black">Launch Command Center <ArrowRight size={15} /></Link>
        </div>
      )}
    </header>
  );
}
