// Transparent rescue priority: a points table, never a black box (port of backend/app/priority.py).
import type { PipelineConfig } from "./config";
import type { Survivor } from "./types";

const tier = (value: number, table: [number, number][]) => {
  for (const [threshold, pts] of table) if (value >= threshold) return pts;
  return 0;
};

/** movement: true/false, or null when it can't be judged (no telemetry to separate camera and person motion). */
export function assess(confidence: number, persistenceS: number, movement: boolean | null, locationConf: string,
  cfg: PipelineConfig["priority"]): Survivor["priority"] {
  const confMax = Math.max(...cfg.confidence_points.map(([, p]) => p));
  const persMax = Math.max(...cfg.persistence_points.map(([, p]) => p));
  const locMax = Math.max(...Object.values(cfg.location_points));
  const breakdown = [
    { factor: "Detection confidence", value: `${(confidence * 100).toFixed(0)}%`, points: tier(confidence, cfg.confidence_points), max: confMax },
    { factor: "Persistent tracking", value: `${persistenceS.toFixed(1)} s tracked`, points: tier(persistenceS, cfg.persistence_points), max: persMax },
    { factor: "Movement / signs of life", value: movement === null ? "Not assessed (no telemetry)" : movement ? "Detected" : "Not observed", points: movement ? cfg.movement_points : 0, max: cfg.movement_points },
    { factor: "Location confidence", value: locationConf, points: cfg.location_points[locationConf] ?? 0, max: locMax },
  ];
  const score = breakdown.reduce((s, b) => s + b.points, 0);
  const level = score >= cfg.high_min ? "HIGH" : score >= cfg.medium_min ? "MEDIUM" : "LOW";
  const reasons: string[] = [];
  if (movement) reasons.push("Movement observed: likely conscious survivor able to signal");
  if (confidence >= 0.85) reasons.push("Strong, consistent person detection");
  else if (confidence < 0.45) reasons.push("Weak detection: may be debris or clothing; needs visual verification");
  if (persistenceS < 1.0) reasons.push("Seen only briefly: re-survey recommended");
  if (movement === false && confidence >= 0.65) reasons.push("No movement observed: may be unresponsive, verify immediately");
  if (locationConf === "Low") reasons.push("Location uncertain: search a wider radius on arrival");
  if (locationConf === "None") reasons.push("No drone position for this footage: location unknown, use the evidence image");
  return {
    level, score, max_score: confMax + persMax + cfg.movement_points + locMax, breakdown, reasons,
    rule: `HIGH ≥ ${cfg.high_min} pts · MEDIUM ≥ ${cfg.medium_min} pts · otherwise LOW`,
  };
}
