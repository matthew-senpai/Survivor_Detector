import { Download, FolderOpen, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import FieldMap from "../components/FieldMap";
import Header from "../components/Header";
import SurvivorDetail, { SurvivorRow, type EvidenceView } from "../components/SurvivorDetail";
import type { Survivor } from "../pipeline/types";
import { download, missionJson, survivorsCsv, survivorsGeoJson } from "../session/export";
import { deleteMission, getMission, listMissions, loadEvidence, saveEvidence, saveMission, type EvidenceRecord, type MissionRecord } from "../session/store";
import { fmtT, Kv, Note, PRIORITY_COLOR } from "../ui";

const count = (m: MissionRecord, l: string) => m.survivors.filter((s) => s.priority.level === l).length;

async function importMission(file: File) {
  const data = JSON.parse(await file.text());
  if (data?.format !== "landsight-field-mission/1" || !data.mission?.id) throw new Error("Not a Landsight Field mission file.");
  await saveMission(data.mission);
  for (const e of data.evidence ?? []) {
    const blob = async (u: string) => (await fetch(u)).blob();
    await saveEvidence({ key: `${data.mission.id}:${e.trackId}`, missionId: data.mission.id, trackId: e.trackId, frame: e.frame, t: e.t, bbox: e.bbox, conf: e.conf,
      frameJpeg: await blob(e.frameJpeg), cropJpeg: await blob(e.cropJpeg) });
  }
  return data.mission.id as string;
}

export default function Missions() {
  const [items, setItems] = useState<MissionRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => listMissions().then(setItems, (e) => setErr(`Saved missions unavailable: ${e.message}`));
  useEffect(() => { refresh(); }, []);
  const remove = async (m: MissionRecord) => {
    if (!confirm(`Delete mission "${m.name}" (${m.id}) and its evidence from this browser? This cannot be undone. Export it first if you need it.`)) return;
    await deleteMission(m.id);
    refresh();
  };
  return (
    <div className="min-h-full">
      <Header />
      <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="label text-ok">Saved in this browser</div><h1 className="font-display text-4xl font-semibold uppercase">Missions</h1></div>
          <label className="flex cursor-pointer items-center gap-2 border border-line-2 px-3 py-2 text-[13px] hover:border-ink">
            <Upload size={14} />Import mission file
            <input type="file" accept=".json,application/json" className="sr-only" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { location.hash = `#/mission/${encodeURIComponent(await importMission(f))}`; } catch (x) { setErr((x as Error).message); }
            }} />
          </label>
        </div>
        {err && <div className="mt-3"><Note tone="bad">{err}</Note></div>}
        <div className="mt-5 border border-line">
          {items === null && !err && <div className="p-6 text-center text-muted">Loading…</div>}
          {items?.length === 0 && <div className="p-8 text-center text-[13px] text-muted">No missions yet. <a href="#/" className="text-hud underline">Start one</a>.</div>}
          {items?.map((m) => (
            <div key={m.id} className="grid items-center gap-2 border-b border-line px-4 py-3 last:border-0 md:grid-cols-[1fr_auto_auto]">
              <a href={`#/mission/${encodeURIComponent(m.id)}`} className="min-w-0">
                <div className="truncate font-display text-lg font-semibold uppercase hover:text-ok">{m.name}</div>
                <div className="font-mono text-[11px] text-dim">{m.id} · {new Date(m.createdAt).toLocaleString()} · {fmtT(m.durationS)} · {m.video.label} · {m.telemetry.label}</div>
              </a>
              <div className="flex gap-3 font-mono text-[12px]">
                {(["HIGH", "MEDIUM", "LOW"] as const).map((l) => <span key={l} style={{ color: PRIORITY_COLOR[l] }}>{count(m, l)} {l}</span>)}
                <span className={m.status === "running" ? "text-medium" : "text-dim"}>{m.status === "running" ? "interrupted" : m.status}</span>
              </div>
              <div className="flex gap-2">
                <a href={`#/mission/${encodeURIComponent(m.id)}`} className="flex items-center gap-1.5 border border-line px-2 py-1 text-[12px] text-muted hover:text-ink"><FolderOpen size={13} />Open</a>
                <button onClick={() => remove(m)} aria-label={`Delete ${m.name}`} className="border border-line px-2 py-1 text-muted hover:border-high hover:text-high"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export function Review({ id }: { id: string }) {
  const [m, setM] = useState<MissionRecord | null | undefined>(undefined);
  const [ev, setEv] = useState<EvidenceRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getMission(id).then((x) => setM(x ?? null), (e) => setErr(e.message));
    loadEvidence(id).then(setEv, () => {});
  }, [id]);
  const urls = useMemo(() => new Map(ev.map((e) => [e.trackId, { e, frameUrl: URL.createObjectURL(e.frameJpeg), cropUrl: URL.createObjectURL(e.cropJpeg) }])), [ev]);
  useEffect(() => () => urls.forEach((u) => { URL.revokeObjectURL(u.frameUrl); URL.revokeObjectURL(u.cropUrl); }), [urls]);

  if (err) return <div className="min-h-full"><Header /><div className="p-6"><Note tone="bad">{err}</Note></div></div>;
  if (m === undefined) return <div className="min-h-full"><Header /><div className="p-6 text-muted">Loading…</div></div>;
  if (m === null) return <div className="min-h-full"><Header /><div className="p-6"><Note tone="bad">Mission {id} isn't saved in this browser.</Note></div></div>;

  const live = m.video.kind === "camera" || m.video.kind === "screen";
  const timeLabel = (t: number) => (live ? new Date(new Date(m.createdAt).getTime() + t * 1000).toLocaleTimeString([], { hour12: false }) : `video ${fmtT(t)}`);
  const evFor = (s: Survivor): EvidenceView | undefined => {
    const c = s.track_ids.map((t) => urls.get(t)).filter(Boolean) as { e: EvidenceRecord; frameUrl: string; cropUrl: string }[];
    const pick = c.find((x) => x.e.frame === s.best.frame) ?? c[0];
    if (!pick) return undefined;
    const k = Math.min(1, 1280 / m.video.width);
    return { frameUrl: pick.frameUrl, cropUrl: pick.cropUrl, bbox: pick.e.bbox, w: Math.round(m.video.width * k), h: Math.round(m.video.height * k), frame: pick.e.frame, t: pick.e.t, conf: pick.e.conf };
  };
  const setStatus = async (s: Survivor, st: Survivor["status"]) => {
    const next = { ...m, survivors: m.survivors.map((x) => (x.id === s.id ? { ...x, status: st } : x)), updatedAt: new Date().toISOString() };
    setM(next);
    await saveMission(next).catch((e) => setErr(e.message));
  };
  const sel = m.survivors.find((s) => s.id === selected);
  const trail = m.trail.map((p) => [p[1], p[2]] as [number, number]);
  const last = m.trail[m.trail.length - 1];

  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-panel px-4 py-2.5 md:px-6">
        <div className="min-w-0">
          <div className="label">Mission report</div>
          <div className="truncate font-display text-xl font-semibold uppercase">{m.name}</div>
          <div className="font-mono text-[10.5px] text-dim">{m.id} · {new Date(m.createdAt).toLocaleString()}</div>
        </div>
        <div className="flex gap-3 font-mono text-[12.5px]">{(["HIGH", "MEDIUM", "LOW"] as const).map((l) => <span key={l} style={{ color: PRIORITY_COLOR[l] }}>{count(m, l)} {l}</span>)}</div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={async () => download(`${m.id}.landsight.json`, await missionJson(m, ev), "application/json")} className="flex items-center gap-1.5 border border-line-2 px-3 py-1.5 text-[12.5px] hover:border-ink"><Download size={14} />Mission file</button>
          <button onClick={() => download(`${m.id}_survivors.csv`, survivorsCsv(m), "text/csv")} className="flex items-center gap-1.5 border border-line-2 px-3 py-1.5 text-[12.5px] hover:border-ink"><Download size={14} />CSV</button>
          {m.geo && <button onClick={() => download(`${m.id}_survivors.geojson`, survivorsGeoJson(m), "application/geo+json")} className="flex items-center gap-1.5 border border-line-2 px-3 py-1.5 text-[12.5px] hover:border-ink"><Download size={14} />GeoJSON</button>}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-px bg-line lg:grid-cols-[1fr_400px]">
        <div className="grid min-h-[360px] grid-rows-[1fr_auto] bg-bg">
          <FieldMap geo={m.geo} trail={trail} live={false} drone={last ? { lat: last[1], lon: last[2], heading: last[4], alt: last[3] } : null}
            footprint={[]} survivors={m.survivors} selectedId={selected} onSelect={setSelected} />
          <div className="grid gap-x-6 border-t border-line bg-panel px-4 py-2 sm:grid-cols-3">
            <Kv k="Video" v={`${m.video.label} · ${m.video.width}×${m.video.height}`} />
            <Kv k="Telemetry" v={m.telemetry.label} />
            <Kv k="Duration" v={fmtT(m.durationS)} />
            <Kv k="Frames processed" v={m.stats.frames} />
            <Kv k="Detections / tracks" v={`${m.stats.raw} / ${m.stats.tracks}`} />
            <Kv k="Avg. inference" v={`${m.stats.avgInferMs.toFixed(0)} ms · ${String(m.settings.backend ?? "?").toUpperCase()}`} />
          </div>
        </div>
        <div className="flex min-h-0 flex-col bg-panel">
          {sel ? <SurvivorDetail s={sel} ev={evFor(sel)} onClose={() => setSelected(null)} onStatus={(st) => setStatus(sel, st)} timeLabel={timeLabel} /> : (
            <>
              <div className="border-b border-line px-3 py-2 font-display text-base font-semibold uppercase">Survivors · {m.survivors.length}</div>
              <div className="flex-1 overflow-y-auto">
                {m.survivors.length === 0 && <div className="p-6 text-center text-[12.5px] text-dim">No survivors were confirmed in this mission.</div>}
                {m.survivors.map((s) => <SurvivorRow key={s.id} s={s} onClick={() => setSelected(s.id)} timeLabel={timeLabel} />)}
              </div>
              {m.telemetry.notes.length > 0 && <div className="border-t border-line p-3 text-[11.5px] text-muted">{m.telemetry.notes.join(" ")}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
