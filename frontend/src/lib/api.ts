import type { Bundle, Health, MissionSummary, SurvivorStatus } from "./types";

export const SAMPLE_ID = "SIM-B3-0001";
/** Static hosting (e.g. Vercel): no API; replay the pipeline output precomputed by backend/scripts/export_static.py. */
export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === "1";

export class ApiError extends Error {
  constructor(message: string, public status = 0, public errors: string[] = []) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit, timeoutMs = 6000): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ApiError("Backend unavailable: is the API server running on port 8000?", 0);
  }
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    let errors: string[] = [];
    try {
      const j = await r.json();
      msg = j.detail?.message ?? (typeof j.detail === "string" ? j.detail : msg);
      errors = j.detail?.errors ?? [];
    } catch { /* non-JSON error body (e.g. dev proxy with backend down) */ }
    throw new ApiError(msg, r.status, errors);
  }
  return r.json() as Promise<T>;
}

export const api = {
  health: () => req<Health>("/api/health", undefined, 3000),
  missions: () => req<MissionSummary[]>("/api/missions"),
  bundle: (id: string) => req<Bundle>(`/api/missions/${id}/bundle`, undefined, 15000),
  runSample: () => req<{ id: string }>("/api/missions/sample", { method: "POST" }),
  upload: (fd: FormData) => req<{ id: string }>("/api/missions/upload", { method: "POST", body: fd }, 600000),
  setStatus: (mid: string, sid: string, status: SurvivorStatus) =>
    req<{ ok: boolean }>(`/api/missions/${mid}/survivors/${sid}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    }),
};

export type DataSource = "api" | "cached" | "static";

/** Loads a mission from the API; for the sample mission, falls back to the cached copy shipped with the
 *  frontend so the demo still works when the backend is down. */
export async function loadBundle(id = SAMPLE_ID): Promise<{ bundle: Bundle; source: DataSource; note?: string }> {
  if (STATIC_DEMO) {
    const r = await fetch("/sample/bundle.json").catch(() => null);
    if (!r?.ok) throw new ApiError("Precomputed mission data missing (sample/bundle.json).");
    return { bundle: await r.json(), source: "static" };
  }
  try {
    return { bundle: await api.bundle(id), source: "api" };
  } catch (e) {
    if (id !== SAMPLE_ID) throw e;
    const r = await fetch("/sample/bundle.json").catch(() => null);
    if (!r?.ok) throw new ApiError("No mission data: backend unreachable and cached sample missing (run backend/scripts/export_static.py).");
    return { bundle: await r.json(), source: "cached", note: (e as Error).message };
  }
}
