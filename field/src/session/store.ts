// Missions and evidence persist in this browser (IndexedDB): nothing leaves the laptop, and it works offline.
import type { FrameDet, Survivor } from "../pipeline/types";

export interface MissionRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: "running" | "complete" | "stopped";
  video: { kind: string; label: string; width: number; height: number };
  telemetry: { kind: string; label: string; notes: string[] };
  settings: Record<string, unknown>;
  geo: boolean;
  durationS: number;
  stats: { frames: number; raw: number; tracks: number; withoutLocation: number; avgInferMs: number };
  survivors: Survivor[];
  frames: [number, number, FrameDet[]][]; // frame index, mission time, detections
  trail: [number, number, number, number, number][]; // t, lat, lon, alt, heading
  warnings: string[];
}

export interface EvidenceRecord {
  key: string; // `${missionId}:${trackId}`
  missionId: string;
  trackId: number;
  frame: number;
  t: number;
  bbox: number[]; // in the stored frame image's pixels
  conf: number;
  frameJpeg: Blob;
  cropJpeg: Blob;
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    if (!("indexedDB" in self)) return reject(new Error("IndexedDB unavailable"));
    const r = indexedDB.open("landsight-field", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("missions", { keyPath: "id" });
      d.createObjectStore("evidence", { keyPath: "key" }).createIndex("missionId", "missionId");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB open failed"));
  });
  dbp.catch(() => (dbp = null));
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : (undefined as T));
    t.onerror = t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
  }));
}

export const saveMission = (m: MissionRecord) => tx("missions", "readwrite", (s) => s.put(m));
export const listMissions = async () => (await tx<MissionRecord[]>("missions", "readonly", (s) => s.getAll())).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getMission = (id: string) => tx<MissionRecord | undefined>("missions", "readonly", (s) => s.get(id));
export const saveEvidence = (e: EvidenceRecord) => tx("evidence", "readwrite", (s) => s.put(e));
export const loadEvidence = (missionId: string) => tx<EvidenceRecord[]>("evidence", "readonly", (s) => s.index("missionId").getAll(missionId));

export async function deleteMission(id: string) {
  const ev = await loadEvidence(id);
  await tx("evidence", "readwrite", (s) => { ev.forEach((e) => s.delete(e.key)); });
  await tx("missions", "readwrite", (s) => s.delete(id));
}

export async function storageAvailable() {
  try { await db(); return true; } catch { return false; }
}
