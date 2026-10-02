import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Crosshair, Expand, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { asset, fmtT, fmtUtc, PRIORITY_COLOR, STATUS_LABEL } from "../lib/mission";
import type { Bundle, Survivor, SurvivorStatus } from "../lib/types";
import { Kv, PriorityBadge } from "./ui";

interface Props {
  bundle: Bundle;
  survivor: Survivor;
  onClose?: () => void;
  canEdit?: boolean;
  onStatus?: (s: SurvivorStatus) => void;
}

export default function SurvivorPanel({ bundle, survivor: s, onClose, canEdit = false, onStatus }: Props) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const col = PRIORITY_COLOR[s.priority.level];
  const ev = s.evidence;

  const copy = () => {
    navigator.clipboard?.writeText(`${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const setStatus = async (st: SurvivorStatus) => {
    setStatusErr(null);
    onStatus?.(st);
    if (!canEdit) return;
    try { await api.setStatus(bundle.mission.id, s.id, st); }
    catch (e) { setStatusErr(`Not saved: ${(e as Error).message}`); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line p-4" style={{ boxShadow: `inset 3px 0 0 ${col}` }}>
        <div>
          <div className="label">Survivor</div>
          <div className="mt-0.5 font-display text-3xl font-semibold tracking-wide">{s.id}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <PriorityBadge level={s.priority.level} />
            <span className="font-mono text-[11px] text-muted">{s.priority.score}/{s.priority.max_score} pts</span>
          </div>
        </div>
        {onClose && <button onClick={onClose} aria-label="Close" className="p-1 text-muted hover:text-ink"><X size={18} /></button>}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {ev?.crop ? (
          <button onClick={() => setEvidenceOpen(true)} className="group relative block w-full overflow-hidden border border-line text-left">
            <div className="grid grid-cols-[1fr_1.6fr] gap-px bg-line">
              <img src={asset(bundle, ev.crop)} alt={`Close-up of ${s.id}`} className="aspect-square w-full object-cover" />
              <img src={asset(bundle, ev.frame!)} alt={`Original frame for ${s.id}`} className="aspect-square w-full object-cover" />
            </div>
            <span className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-bg/85 px-2 py-1 font-mono text-[10.5px] text-ink group-hover:text-signal">
              <Expand size={12} /> OPEN EVIDENCE
            </span>
          </button>
        ) : (
          <div className="border border-medium/40 p-3 font-mono text-xs text-medium">Evidence image unavailable{ev?.error ? `: ${ev.error}` : ""}</div>
        )}

        <div>
          <div className="label mb-1">Location</div>
          <div className="flex items-center justify-between gap-2 bg-panel-2 px-3 py-2">
            <span className="font-mono text-sm">{s.lat.toFixed(6)}, {s.lon.toFixed(6)}</span>
            <button onClick={copy} className="text-muted hover:text-ink" aria-label="Copy coordinates">{copied ? <Check size={15} /> : <Copy size={15} />}</button>
          </div>
          <Kv k="Location confidence" v={`${s.location_confidence} · ±${s.uncertainty_m.toFixed(1)} m`} />
          {s.sim_truth && <Kv k="Ground-truth check (sim)" v={s.sim_truth.person ? `${s.sim_truth.person} · ${s.sim_truth.geo_error_m} m error` : "No person here: debris/decoy"} />}
        </div>

        <div>
          <div className="label mb-1">Why {s.priority.level}</div>
          <div className="border border-line">
            {s.priority.breakdown.map((b) => (
              <div key={b.factor} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line px-3 py-2 last:border-0">
                <div>
                  <div className="text-[12.5px] text-ink">{b.factor}</div>
                  <div className="font-mono text-[11px] text-muted">{b.value}</div>
                </div>
                <div className="flex items-center gap-1" title={`${b.points} of ${b.max} points`}>
                  {Array.from({ length: b.max }, (_, i) => (
                    <span key={i} className="h-3 w-2" style={{ background: i < b.points ? col : "rgb(255 255 255 / 0.1)" }} />
                  ))}
                  <span className="ml-1.5 w-7 text-right font-mono text-[11px]">+{b.points}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1.5 font-mono text-[10.5px] text-dim">{s.priority.rule}</div>
          {s.priority.reasons.length > 0 && (
            <ul className="mt-2 space-y-1">
              {s.priority.reasons.map((r) => <li key={r} className="flex gap-2 text-[12.5px] text-muted"><span style={{ color: col }}>›</span>{r}</li>)}
            </ul>
          )}
        </div>

        <div>
          <div className="label mb-1">Detection & tracking</div>
          <Kv k="Confidence (top-5 mean)" v={`${(s.confidence * 100).toFixed(0)}% · peak ${(s.max_confidence * 100).toFixed(0)}%`} />
          <Kv k="Movement" v={s.movement.detected ? `Detected · ${s.movement.kind}` : "Not observed"} />
          <Kv k="Tracking IDs" v={s.track_ids.map((id) => `TRK ${id}`).join(", ")} />
          <Kv k="Passes merged (dedup)" v={`${s.passes} pass${s.passes > 1 ? "es" : ""} · ${s.observations} observations`} />
          <Kv k="Persistence" v={`${s.persistence_s.toFixed(1)} s tracked`} />
          <Kv k="First seen" v={`${fmtUtc(bundle, s.first_seen_t)} · ${fmtT(s.first_seen_t)}`} />
          <Kv k="Confirmed" v={`${fmtUtc(bundle, s.confirmed_t)} · ${fmtT(s.confirmed_t)}`} />
          <Kv k="Best frame" v={`#${s.best.frame} · ${s.best.alt_m} m AGL · ${s.best.gsd_cm} cm/px`} />
        </div>

        <div>
          <div className="label mb-1.5">Rescue status</div>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(STATUS_LABEL) as SurvivorStatus[]).map((st) => (
              <button key={st} onClick={() => setStatus(st)}
                className={`border px-2 py-1.5 text-left text-[12px] transition ${s.status === st ? "border-signal bg-signal/15 text-ink" : "border-line text-muted hover:border-line-2 hover:text-ink"}`}>
                {STATUS_LABEL[st]}
              </button>
            ))}
          </div>
          {!canEdit && <div className="mt-1.5 font-mono text-[10.5px] text-dim">No backend connected: status changes are kept in this browser only.</div>}
          {statusErr && <div className="mt-1.5 font-mono text-[10.5px] text-high">{statusErr}</div>}
        </div>
      </div>

      <AnimatePresence>{evidenceOpen && <EvidenceModal bundle={bundle} s={s} onClose={() => setEvidenceOpen(false)} />}</AnimatePresence>
    </div>
  );
}

function EvidenceModal({ bundle, s, onClose }: { bundle: Bundle; s: Survivor; onClose: () => void }) {
  const ev = s.evidence!;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Evidence for ${s.id}`}>
      <motion.div initial={{ scale: 0.97, y: 10 }} animate={{ scale: 1, y: 0 }} onClick={(e) => e.stopPropagation()}
        className="grid max-h-full w-full max-w-6xl grid-cols-1 overflow-auto border border-line-2 bg-panel lg:grid-cols-[1fr_300px]">
        <div className="bg-black">
          <img src={asset(bundle, ev.frame!)} alt={`Original frame ${ev.frame_index}`} className="w-full" />
        </div>
        <div className="space-y-4 p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="label">Evidence package</div>
              <div className="font-display text-2xl font-semibold">{s.id}</div>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink"><X size={18} /></button>
          </div>
          <img src={asset(bundle, ev.crop!)} alt="Cropped detection" className="w-full border border-line" />
          <div>
            <Kv k="Mission" v={ev.mission_id} />
            <Kv k="Timestamp" v={ev.timestamp} />
            <Kv k="Frame" v={`#${ev.frame_index}`} />
            <Kv k="Tracking ID" v={s.track_ids.join(", ")} />
            <Kv k="Confidence" v={`${(s.best.conf * 100).toFixed(1)}%`} />
            <Kv k="GPS estimate" v={<span className="inline-flex items-center gap-1"><Crosshair size={11} />{s.lat.toFixed(6)}, {s.lon.toFixed(6)}</span>} />
            <Kv k="Uncertainty" v={`±${s.uncertainty_m.toFixed(1)} m`} />
            <Kv k="Priority" v={<PriorityBadge level={s.priority.level} />} />
          </div>
          <div className="flex gap-2">
            <a href={asset(bundle, ev.frame!)} download className="flex-1 border border-line py-1.5 text-center text-xs text-muted hover:text-ink">Frame JPG</a>
            <a href={asset(bundle, ev.crop!)} download className="flex-1 border border-line py-1.5 text-center text-xs text-muted hover:text-ink">Crop JPG</a>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
