import type { ReactNode } from "react";
import type { Priority } from "./pipeline/types";

export const PRIORITY_COLOR: Record<Priority, string> = { HIGH: "#ff4d3d", MEDIUM: "#ffb020", LOW: "#78beff" };
export const STATUS_LABEL = { new: "New", verified: "Verified", dispatched: "Team dispatched", rescued: "Rescued", false_positive: "False positive" } as const;

export function PriorityBadge({ level }: { level: Priority }) {
  const c = PRIORITY_COLOR[level];
  return (
    <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tracking-wider" style={{ color: c, background: c + "1f", boxShadow: `inset 0 0 0 1px ${c}55` }}>
      <span className="size-1.5 rounded-full" style={{ background: c }} />{level}
    </span>
  );
}

export function Chip({ k, v, tone = "ink", title }: { k: string; v: ReactNode; tone?: "ink" | "ok" | "warn" | "bad" | "hud" | "dim"; title?: string }) {
  const color = { ink: "text-ink", ok: "text-ok", warn: "text-medium", bad: "text-high", hud: "text-hud", dim: "text-dim" }[tone];
  return (
    <div title={title} className="min-w-0">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-dim">{k}</div>
      <div className={`truncate font-mono text-[12px] font-medium ${color}`}>{v}</div>
    </div>
  );
}

export function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-[12.5px]">
      <span className="text-muted">{k}</span>
      <span className="text-right font-mono text-ink">{v}</span>
    </div>
  );
}

export function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "dim" }) {
  const c = { ok: "bg-ok", warn: "bg-medium", bad: "bg-high blink", dim: "bg-dim" }[tone];
  return <span className={`inline-block size-1.5 shrink-0 rounded-full ${c}`} />;
}

export function Note({ tone = "warn", children }: { tone?: "warn" | "bad" | "ok" | "info"; children: ReactNode }) {
  const c = { warn: "border-medium/40 bg-medium/5 text-medium", bad: "border-high/40 bg-high/5 text-high", ok: "border-ok/40 bg-ok/5 text-ok", info: "border-line-2 bg-panel-2 text-muted" }[tone];
  return <div className={`border px-3 py-2 text-[12.5px] leading-snug ${c}`}>{children}</div>;
}

export const fmtT = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
export const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`);
