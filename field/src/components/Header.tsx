import { BookOpen, ExternalLink, FolderOpen, Radar } from "lucide-react";
import { useState, type ReactNode } from "react";
import HelpDrawer from "./HelpDrawer";

export function Logo() {
  return (
    <a href="#/" className="flex items-center gap-2.5">
      <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
        <path d="M4 24 L16 6 L28 24" stroke="#3ddc84" strokeWidth="3" fill="none" />
        <circle cx="16" cy="19" r="3.4" fill="#5ef2c2" />
        <circle cx="16" cy="19" r="7" stroke="#5ef2c2" strokeOpacity=".4" fill="none" />
      </svg>
      <span className="font-display text-lg font-semibold tracking-[0.16em]">LANDSIGHT <span className="text-ok">FIELD</span></span>
    </a>
  );
}

export default function Header({ children }: { children?: ReactNode }) {
  const [help, setHelp] = useState(false);
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-panel px-4 py-2.5 md:px-6">
      <Logo />
      <nav className="flex items-center gap-4 text-[13px] text-muted" aria-label="Main">
        <a href="#/" className="flex items-center gap-1.5 hover:text-ink"><Radar size={14} />New mission</a>
        <a href="#/missions" className="flex items-center gap-1.5 hover:text-ink"><FolderOpen size={14} />Missions</a>
        <button onClick={() => setHelp(true)} className="flex items-center gap-1.5 hover:text-ink"><BookOpen size={14} />Connect a drone</button>
        <a href="https://survivor-detector.vercel.app" target="_blank" rel="noreferrer" className="hidden items-center gap-1.5 hover:text-ink sm:flex">Project site <ExternalLink size={12} /></a>
      </nav>
      <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">{children}</div>
      {help && <HelpDrawer onClose={() => setHelp(false)} />}
    </header>
  );
}
