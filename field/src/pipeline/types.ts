export interface TelemetrySample {
  t: number;            // seconds on the session clock (video time for recordings)
  lat: number;
  lon: number;
  alt_m: number;        // height above ground
  heading_deg: number;  // camera heading, 0 = north, clockwise
  speed_mps: number;
  gimbal_pitch_deg: number; // -90 = straight down, 0 = horizon
  gps_fix: number;      // 0/1 none, 2 = 2D, 3 = 3D, 4+ = DGPS/RTK
  sats: number;
  hdop: number;
  battery_pct: number;  // -1 = unknown
}

/** A detected person in video pixels. */
export interface Detection { x1: number; y1: number; x2: number; y2: number; conf: number }

export type Priority = "HIGH" | "MEDIUM" | "LOW";

export interface Survivor {
  id: string;
  track_ids: number[];
  lat: number | null;   // null when the mission has no telemetry (detection-only)
  lon: number | null;
  e: number | null;
  n: number | null;
  uncertainty_m: number | null;
  location_confidence: "High" | "Medium" | "Low" | "None";
  confidence: number;
  max_confidence: number;
  observations: number;
  passes: number;
  persistence_s: number;
  first_seen_t: number;
  last_seen_t: number;
  confirmed_t: number;
  movement: { detected: boolean; kind: string | null; bbox_cv: number; speed_mps: number };
  priority: {
    level: Priority; score: number; max_score: number;
    breakdown: { factor: string; value: string; points: number; max: number }[];
    reasons: string[]; rule: string;
  };
  best: { frame: number; t: number; bbox: number[]; conf: number; alt_m: number; gsd_cm: number };
  status: "new" | "verified" | "dispatched" | "rescued" | "false_positive";
}

/** [x1, y1, x2, y2, conf, trackId | null] */
export type FrameDet = [number, number, number, number, number, number | null];
