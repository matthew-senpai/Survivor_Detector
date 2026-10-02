import type { ReactNode } from "react";
import { PRIORITY_COLOR } from "../lib/mission";
import type { MissionMode, Priority } from "../lib/types";

export function PriorityBadge({ level, size = "sm" }: { level: Priority; size?: "sm" | "lg" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono font-semibold tracking-wider ${size === "lg" ? "px-2.5 py-1 text-sm" : "px-1.5 py-0.5 text-[10.5px]"}`}
      style={{ color: PRIORITY_COLOR[level], background: PRIORITY_COLOR[level] + "1f", boxShadow: `inset 0 0 0 1px ${PRIORITY_COLOR[level]}55` }}>
      <span className="size-1.5 rounded-full" style={{ background: PRIORITY_COLOR[level] }} />{level}
    </span>
  );
}

export function ModeBadge({ mode, compact = false }: { mode: MissionMode; compact?: boolean }) {
  const sim = mode !== "deployment";
  return (
    <span title={sim ? "Using recorded drone footage and simulated telemetry" : "Receiving live UAV video and telemetry"}
      className={`inline-flex items-center gap-2 border px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.14em] ${sim ? "border-medium/50 bg-medium/10 text-medium" : "border-ok/50 bg-ok/10 text-ok"}`}>
      <span className={`size-1.5 rounded-full ${sim ? "bg-medium" : "bg-ok blink"}`} />
      {sim ? (mode === "upload" ? "UPLOADED FOOTAGE" : "SIMULATION MODE") : "DEPLOYMENT MODE"}
      {!compact && <span className="font-normal tracking-normal text-muted normal-case">{sim ? "· recorded footage + simulated telemetry" : "· live UAV video + telemetry"}</span>}
    </span>
  );
}

export function Eyebrow({ children, n }: { children: ReactNode; n?: string }) {
  return (
    <div className="label flex items-center gap-3 text-hud">
      {n && <span className="text-signal">{n}</span>}<span className="h-px w-8 bg-hud/50" />{children}
    </div>
  );
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mt-4 max-w-3xl">
      <h2 className="font-display text-4xl font-semibold uppercase leading-[0.95] tracking-tight text-ink md:text-6xl">{children}</h2>
      {sub && <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">{sub}</p>}
    </div>
  );
}

export function Kv({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-[12.5px]">
      <span className="text-muted">{k}</span>
      <span className={`text-right text-ink ${mono ? "font-mono" : ""}`}>{v}</span>
    </div>
  );
}
