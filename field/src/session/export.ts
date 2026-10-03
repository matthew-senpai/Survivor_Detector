// Hand-off formats for rescue teams: full mission file (with evidence images), survivors CSV, and GeoJSON for GIS.
import type { EvidenceRecord, MissionRecord } from "./store";

const blobToDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const at = (m: MissionRecord, t: number) => new Date(new Date(m.createdAt).getTime() + t * 1000).toISOString();

export async function missionJson(m: MissionRecord, evidence: EvidenceRecord[]) {
  const ev = await Promise.all(evidence.map(async (e) => ({
    trackId: e.trackId, frame: e.frame, t: e.t, bbox: e.bbox, conf: e.conf,
    frameJpeg: await blobToDataUrl(e.frameJpeg), cropJpeg: await blobToDataUrl(e.cropJpeg),
  })));
  return JSON.stringify({ format: "landsight-field-mission/1", exportedAt: new Date().toISOString(), mission: m, evidence: ev });
}

export function survivorsCsv(m: MissionRecord) {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["id", "priority", "score", "status", "lat", "lon", "uncertainty_m", "location_confidence", "confidence", "movement", "persistence_s", "first_seen", "confirmed", "track_ids", "reasons"];
  const rows = m.survivors.map((s) => [s.id, s.priority.level, `${s.priority.score}/${s.priority.max_score}`, s.status, s.lat, s.lon, s.uncertainty_m, s.location_confidence,
    s.confidence, s.movement.detected ? s.movement.kind : "none", s.persistence_s, at(m, s.first_seen_t), at(m, s.confirmed_t), s.track_ids.join(" "), s.priority.reasons.join("; ")]);
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

export function survivorsGeoJson(m: MissionRecord) {
  return JSON.stringify({
    type: "FeatureCollection",
    features: m.survivors.filter((s) => s.lat !== null).map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: { id: s.id, priority: s.priority.level, score: s.priority.score, status: s.status, uncertainty_m: s.uncertainty_m,
        confidence: s.confidence, movement: s.movement.kind, confirmed: at(m, s.confirmed_t), mission: m.id },
    })),
  });
}
