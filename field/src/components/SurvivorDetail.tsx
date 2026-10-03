import { Check, Copy, Expand, Navigation, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Survivor } from "../pipeline/types";
import { Kv, PRIORITY_COLOR, PriorityBadge, STATUS_LABEL } from "../ui";

export interface EvidenceView { frameUrl: string; cropUrl: string; bbox: number[]; w: number; h: number; frame: number; t: number; conf: number }
type Status = Survivor["status"];

export function SurvivorRow({ s, onClick, timeLabel }: { s: Survivor; onClick: () => void; timeLabel: (t: number) => string }) {
  return (
    <button onClick={onClick} className="block w-full border-b border-line px-3 py-2.5 text-left hover:bg-white/[0.03]" style={{ boxShadow: `inset 3px 0 0 ${PRIORITY_COLOR[s.priority.level]}` }}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[17px] font-semibold tracking-wide">{s.id}</span>
        <PriorityBadge level={s.priority.level} />
      </div>
      <div className="mt-0.5 grid grid-cols-2 gap-x-3 font-mono text-[11px] text-muted">
        <span>{s.lat !== null ? `${s.lat.toFixed(5)}, ${s.lon!.toFixed(5)}` : "no position"}</span>
        <span className="text-right">conf {(s.confidence * 100).toFixed(0)}%</span>
        <span>{s.movement.detected ? <span className="text-ok">● moving</span> : s.movement.kind === "not assessed" ? "movement n/a" : "○ no movement"}</span>
        <span className="text-right">{timeLabel(s.confirmed_t)}</span>
      </div>
      <div className={`mt-1 text-[11.5px] ${s.status === "new" ? "text-signal" : s.status === "rescued" ? "text-ok" : "text-ink/80"}`}>{STATUS_LABEL[s.status]}</div>
    </button>
  );
}

export default function SurvivorDetail({ s, ev, onClose, onStatus, timeLabel }: { s: Survivor; ev?: EvidenceView; onClose: () => void; onStatus: (st: Status) => void; timeLabel: (t: number) => string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const col = PRIORITY_COLOR[s.priority.level];
  const copy = () => { navigator.clipboard?.writeText(`${s.lat!.toFixed(6)}, ${s.lon!.toFixed(6)}`); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between border-b border-line p-3" style={{ boxShadow: `inset 3px 0 0 ${col}` }}>
        <div>
          <div className="label">Survivor</div>
          <div className="font-display text-2xl font-semibold tracking-wide">{s.id}</div>
          <div className="mt-1 flex items-center gap-2"><PriorityBadge level={s.priority.level} /><span className="font-mono text-[11px] text-muted">{s.priority.score}/{s.priority.max_score} pts</span></div>
        </div>
        <button onClick={onClose} aria-label="Back to list" className="p-1 text-muted hover:text-ink"><X size={18} /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {ev ? (
          <button onClick={() => setOpen(true)} className="group relative block w-full border border-line text-left">
            <div className="grid grid-cols-[1fr_1.6fr] gap-px bg-line">
              <img src={ev.cropUrl} alt={`Close-up of ${s.id}`} className="aspect-square w-full object-cover" />
              <EvidenceFrame ev={ev} color={col} className="aspect-square w-full object-cover" />
            </div>
            <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 bg-bg/85 px-1.5 py-0.5 font-mono text-[10.5px] group-hover:text-hud"><Expand size={11} />EVIDENCE</span>
          </button>
        ) : <div className="border border-line p-3 text-[12px] text-dim">Evidence image not available.</div>}

        <div>
          <div className="label mb-1">Location</div>
          {s.lat !== null ? (
            <>
              <div className="flex items-center justify-between gap-2 bg-panel-2 px-2.5 py-1.5">
                <span className="font-mono text-[13px]">{s.lat.toFixed(6)}, {s.lon!.toFixed(6)}</span>
                <span className="flex gap-2">
                  <a href={`geo:${s.lat},${s.lon}`} title="Open in a maps app" className="text-muted hover:text-ink"><Navigation size={14} /></a>
                  <button onClick={copy} aria-label="Copy coordinates" className="text-muted hover:text-ink">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
                </span>
              </div>
              <Kv k="Location confidence" v={`${s.location_confidence} · ±${s.uncertainty_m?.toFixed(1)} m`} />
            </>
          ) : <div className="text-[12px] text-muted">No position: this mission has no telemetry. Use the evidence frame and time.</div>}
        </div>

        <div>
          <div className="label mb-1">Why {s.priority.level}</div>
          <div className="border border-line">
            {s.priority.breakdown.map((b) => (
              <div key={b.factor} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-0">
                <div><div className="text-[12px]">{b.factor}</div><div className="font-mono text-[10.5px] text-muted">{b.value}</div></div>
                <div className="flex items-center gap-0.5">{Array.from({ length: b.max }, (_, i) => <span key={i} className="h-2.5 w-1.5" style={{ background: i < b.points ? col : "rgb(255 255 255 / 0.1)" }} />)}<span className="ml-1 w-6 text-right font-mono text-[10.5px]">+{b.points}</span></div>
              </div>
            ))}
          </div>
          <div className="mt-1 font-mono text-[10px] text-dim">{s.priority.rule}</div>
          <ul className="mt-1.5 space-y-0.5">{s.priority.reasons.map((r) => <li key={r} className="flex gap-1.5 text-[12px] text-muted"><span style={{ color: col }}>›</span>{r}</li>)}</ul>
        </div>

        <div>
          <div className="label mb-1">Detection & tracking</div>
          <Kv k="Confidence (top-5 mean)" v={`${(s.confidence * 100).toFixed(0)}% · peak ${(s.max_confidence * 100).toFixed(0)}%`} />
          <Kv k="Movement" v={s.movement.detected ? `Detected · ${s.movement.kind}` : s.movement.kind === "not assessed" ? "Not assessed (no telemetry)" : "Not observed"} />
          <Kv k="Tracks merged" v={`${s.track_ids.map((t) => `TRK ${t}`).join(", ")} · ${s.observations} obs`} />
          <Kv k="Tracked for" v={`${s.persistence_s.toFixed(1)} s`} />
          <Kv k="First seen" v={timeLabel(s.first_seen_t)} />
          <Kv k="Confirmed" v={timeLabel(s.confirmed_t)} />
        </div>

        <div>
          <div className="label mb-1.5">Rescue status</div>
          <div className="grid grid-cols-2 gap-1">
            {(Object.keys(STATUS_LABEL) as Status[]).map((st) => (
              <button key={st} onClick={() => onStatus(st)} className={`border px-2 py-1 text-left text-[12px] ${s.status === st ? "border-ok bg-ok/15" : "border-line text-muted hover:text-ink"}`}>{STATUS_LABEL[st]}</button>
            ))}
          </div>
        </div>
      </div>
      {open && ev && <EvidenceModal s={s} ev={ev} color={col} onClose={() => setOpen(false)} timeLabel={timeLabel} />}
    </div>
  );
}

function EvidenceFrame({ ev, color, className }: { ev: EvidenceView; color: string; className?: string }) {
  const [x1, y1, x2, y2] = ev.bbox;
  return (
    <svg viewBox={`0 0 ${ev.w} ${ev.h}`} className={className} preserveAspectRatio="xMidYMid slice" role="img" aria-label="Full evidence frame">
      <image href={ev.frameUrl} width={ev.w} height={ev.h} />
      <rect x={x1 - 4} y={y1 - 4} width={x2 - x1 + 8} height={y2 - y1 + 8} fill="none" stroke={color} strokeWidth={Math.max(2, ev.w / 400)} />
    </svg>
  );
}

function EvidenceModal({ s, ev, color, onClose, timeLabel }: { s: Survivor; ev: EvidenceView; color: string; onClose: () => void; timeLabel: (t: number) => string }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-[3000] grid place-items-center bg-black/80 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Evidence for ${s.id}`}>
      <div className="grid max-h-full w-full max-w-6xl grid-cols-1 overflow-auto border border-line-2 bg-panel lg:grid-cols-[1fr_280px]" onClick={(e) => e.stopPropagation()}>
        <div className="bg-black"><EvidenceFrame ev={ev} color={color} className="w-full" /></div>
        <div className="space-y-3 p-3">
          <div className="flex items-start justify-between"><div><div className="label">Evidence</div><div className="font-display text-2xl font-semibold">{s.id}</div></div><button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink"><X size={18} /></button></div>
          <img src={ev.cropUrl} alt="Close-up" className="w-full border border-line" />
          <Kv k="Time" v={timeLabel(ev.t)} />
          <Kv k="Frame" v={`#${ev.frame}`} />
          <Kv k="Confidence" v={`${(ev.conf * 100).toFixed(1)}%`} />
          {s.lat !== null && <Kv k="Position" v={`${s.lat.toFixed(6)}, ${s.lon!.toFixed(6)}`} />}
          <div className="flex gap-2">
            <a href={ev.frameUrl} download={`${s.id}_frame.jpg`} className="flex-1 border border-line py-1 text-center text-[12px] text-muted hover:text-ink">Frame JPG</a>
            <a href={ev.cropUrl} download={`${s.id}_crop.jpg`} className="flex-1 border border-line py-1 text-center text-[12px] text-muted hover:text-ink">Crop JPG</a>
          </div>
        </div>
      </div>
    </div>
  );
}
