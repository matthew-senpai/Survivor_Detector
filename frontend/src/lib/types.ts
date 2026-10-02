// Shapes of the mission bundle produced by backend/app/pipeline.py:build_bundle.

export type Priority = "HIGH" | "MEDIUM" | "LOW";
export type SurvivorStatus = "new" | "verified" | "dispatched" | "rescued" | "false_positive";
export type MissionMode = "simulation" | "upload" | "deployment";

/** [x1, y1, x2, y2, conf, trackId, survivorId] in camera pixels */
export type Det = [number, number, number, number, number, number | null, string | null];

export interface Survivor {
  id: string;
  track_ids: number[];
  lat: number;
  lon: number;
  uncertainty_m: number;
  location_confidence: "High" | "Medium" | "Low";
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
    level: Priority;
    score: number;
    max_score: number;
    breakdown: { factor: string; value: string; points: number; max: number }[];
    reasons: string[];
    rule: string;
  };
  best: { frame: number; t: number; bbox: number[]; conf: number; alt_m: number; gsd_cm: number };
  status: SurvivorStatus;
  evidence?: { frame?: string; crop?: string; timestamp?: string; frame_index?: number; mission_id?: string; error?: string };
  sim_truth?: { person: string | null; geo_error_m: number | null };
}

export interface Person {
  id: string;
  x: number;
  y: number;
  heading: number;
  pose: "lying" | "occluded" | "sitting" | "standing" | "buried";
  shirt: string;
  pants: string;
  motion: { type?: "wave" | "crawl"; rate?: number; amp?: number; period?: number };
  deep?: boolean;
  note: string;
}

export interface Team { id: string; name: string; members: number; status: string; pos: [number, number] }
export interface Sector { name: string; status: "active" | "searched" | "queued"; bounds: [[number, number], [number, number]] }

export interface Metrics {
  frames_processed: number;
  raw_detections: number;
  detections_without_location: number;
  pipeline_fps: number | null;
  confirmed_tracks: number;
  unique_survivors: number;
  duplicates_suppressed: number;
  priority_counts: Record<Priority, number>;
  area_scanned_m2: number;
  sim_truth?: {
    ground_truth_people: number; found: number; recall: number; duplicate_survivors: number;
    duplicate_rate: number; non_person_detections: number; mean_geo_error_m: number | null; max_geo_error_m: number | null;
  };
}

export interface Bundle {
  mission: {
    id: string; name: string; sector: string; area: string; mode: MissionMode; status: string; start_time: string;
    source: { video: string; telemetry: string; detector: string };
    fps: number; frames_total: number; duration_s: number; asset_base: string;
  };
  camera: { image_width: number; image_height: number; hfov_deg: number; mount: string };
  telemetry: { cols: string[]; rows: number[][] };
  frames: [number, Det[]][];
  survivors: Survivor[];
  metrics: Metrics;
  warnings: string[];
  targets: Record<string, number>;
  video?: string;
  sim?: {
    origin: [number, number]; m_per_px: number; width_px: number; height_px: number;
    persons: Person[]; decoys: { x: number; y: number; label: string }[];
    truth: { cols: string[]; rows: number[][] };
    teams: Team[]; zone: [number, number][]; sectors: Sector[]; terrain: string;
  };
}

export interface Health {
  status: string;
  mode: string;
  components: Record<string, string>;
}

export interface MissionSummary {
  id: string; name: string; mode: MissionMode; status: string; created_at: string; error: string | null;
}
