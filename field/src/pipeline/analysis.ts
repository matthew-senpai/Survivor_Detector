// Survivor analysis: movement, persistence, location confidence, dedup (port of backend/app/analysis.py).
import type { PipelineConfig } from "./config";
import { assess } from "./priority";
import type { Observation, Track } from "./tracking";
import type { Survivor } from "./types";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pstdev = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
export const round = (x: number, d: number) => { const k = 10 ** d; return Math.round(x * k) / k; };

function movement(track: Track, cfg: PipelineConfig["movement"], geo: boolean) {
  const obs = track.obs, out = { bbox_cv: 0, speed_mps: 0 };
  if (obs.length < 5 || obs[obs.length - 1].t - obs[0].t < cfg.min_duration_s) return out;
  // Limb motion: box ground area fluctuates. Position change: least-squares velocity on the ground.
  // Without telemetry there is no altitude to normalise box size, so camera zoom/descent looks like limb motion:
  // movement is reported as "not assessed" instead (see buildSurvivors).
  if (!geo) return out;
  const areas = obs.map((o) => (o.bbox[2] - o.bbox[0]) * (o.bbox[3] - o.bbox[1]) * o.gsd ** 2);
  out.bbox_cv = pstdev(areas) / mean(areas);
  const ts = obs.map((o) => o.t), tm = mean(ts), varT = ts.reduce((s, t) => s + (t - tm) ** 2, 0);
  const slope = (xs: number[]) => { const xm = mean(xs); return ts.reduce((s, t, i) => s + (t - tm) * (xs[i] - xm), 0) / varT; };
  out.speed_mps = Math.hypot(slope(obs.map((o) => o.e)), slope(obs.map((o) => o.n)));
  return out;
}

function centroid(obs: Observation[]) {
  const w = obs.reduce((s, o) => s + o.conf, 0);
  const sum = (f: (o: Observation) => number) => obs.reduce((s, o) => s + f(o) * o.conf, 0) / w;
  return { e: sum((o) => o.e), n: sum((o) => o.n), lat: sum((o) => o.lat ?? 0), lon: sum((o) => o.lon ?? 0) };
}

/** Merge tracks that are the same person seen on different passes. Tracks seen in the same frame are
 *  different people and never merge. */
export function deduplicate(tracks: Track[], radius: number): Track[][] {
  const parent = tracks.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : find(parent[i]));
  const cents = tracks.map((t) => centroid(t.obs));
  const frames = tracks.map((t) => new Set(t.obs.map((o) => o.frame)));
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
    const d = Math.hypot(cents[i].e - cents[j].e, cents[i].n - cents[j].n);
    if (d <= radius) pairs.push([d, i, j]);
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (const [, i, j] of pairs) {
    const ri = find(i), rj = find(j);
    if (ri === rj) continue;
    const gi = new Set<number>(), gj = new Set<number>();
    tracks.forEach((_, k) => { const r = find(k); if (r === ri) frames[k].forEach((f) => gi.add(f)); if (r === rj) frames[k].forEach((f) => gj.add(f)); });
    if (![...gi].some((f) => gj.has(f))) parent[rj] = ri;
  }
  const groups = new Map<number, Track[]>();
  tracks.forEach((t, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), t]); });
  return [...groups.values()];
}

export function buildSurvivors(tracks: Track[], cfg: PipelineConfig, geo = true): Survivor[] {
  // Without telemetry the tracker works in pixels; cross-pass dedup by position is impossible, so each track stands alone.
  const groups = geo ? deduplicate(tracks, cfg.dedup.merge_radius_m) : tracks.map((t) => [t]);
  const survivors = groups.map((group) => {
    const obs = group.flatMap((t) => t.obs).sort((a, b) => a.frame - b.frame);
    const c = centroid(obs);
    let sigma: number | null = null, locConf: Survivor["location_confidence"] = "None";
    if (geo) {
      const spread = Math.sqrt(mean(obs.map((o) => (o.e - c.e) ** 2 + (o.n - c.n) ** 2)));
      const L = cfg.location;
      sigma = Math.sqrt((L.uere_m * mean(obs.map((o) => o.hdop))) ** 2 + spread ** 2 + (L.alt_error_frac * mean(obs.map((o) => o.alt))) ** 2);
      locConf = sigma <= L.high_max_m ? "High" : sigma <= L.medium_max_m ? "Medium" : "Low";
    }
    const top = obs.map((o) => o.conf).sort((a, b) => b - a).slice(0, 5);
    const confidence = mean(top);
    const persistence = group.reduce((s, t) => s + (t.obs[t.obs.length - 1].t - t.obs[0].t), 0);
    const mv = group.map((t) => movement(t, cfg.movement, geo));
    const cv = Math.max(...mv.map((m) => m.bbox_cv)), speed = Math.max(...mv.map((m) => m.speed_mps));
    const kind = !geo ? "not assessed" : cv >= cfg.movement.bbox_area_cv ? "limb motion" : speed >= cfg.movement.speed_mps ? "position change" : null;
    const moving = geo ? kind !== null : null; // null = can't be judged without telemetry
    const best = obs.reduce((b, o) => (o.conf > b.conf ? o : b), obs[0]);
    return {
      id: "", track_ids: group.map((t) => t.id).sort((a, b) => a - b),
      lat: geo ? round(c.lat, 7) : null, lon: geo ? round(c.lon, 7) : null,
      e: geo ? round(c.e, 2) : null, n: geo ? round(c.n, 2) : null,
      uncertainty_m: sigma === null ? null : round(sigma, 2), location_confidence: locConf,
      confidence: round(confidence, 3), max_confidence: round(Math.max(...obs.map((o) => o.conf)), 3),
      observations: obs.length, passes: group.length, persistence_s: round(persistence, 1),
      first_seen_t: obs[0].t, last_seen_t: obs[obs.length - 1].t,
      confirmed_t: Math.min(...group.map((t) => t.confirmedT!)),
      movement: { detected: moving === true, kind, bbox_cv: round(cv, 3), speed_mps: round(speed, 3) },
      priority: assess(confidence, persistence, moving, locConf, cfg.priority),
      best: { frame: best.frame, t: best.t, bbox: best.bbox.map((x) => round(x, 1)), conf: round(best.conf, 3),
        alt_m: round(best.alt, 1), gsd_cm: round(best.gsd * 100, 2) },
      status: "new" as const,
    } satisfies Survivor;
  });
  survivors.sort((a, b) => a.confirmed_t - b.confirmed_t);
  survivors.forEach((s, i) => (s.id = `S-${String(i + 1).padStart(3, "0")}`));
  return survivors;
}
