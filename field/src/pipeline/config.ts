// Mirror of config/pipeline.json (the backend's single source of truth).
// tests/parity.test.ts fails if these values drift from that file.

export const PIPELINE = {
  tracker: { high_thresh: 0.5, low_thresh: 0.15, new_track_thresh: 0.3, gate_m: 1.6, max_age_frames: 15, min_hits: 3, ema: 0.35 },
  dedup: { merge_radius_m: 2.5 },
  movement: { bbox_area_cv: 0.18, speed_mps: 0.25, min_duration_s: 1.5 },
  location: { uere_m: 1.2, alt_error_frac: 0.02, high_max_m: 2.5, medium_max_m: 5.0 },
  priority: {
    confidence_points: [[0.85, 3], [0.65, 2], [0.45, 1]] as [number, number][],
    persistence_points: [[3.0, 2], [1.0, 1]] as [number, number][],
    movement_points: 2,
    location_points: { High: 1, Medium: 0, Low: 0 } as Record<string, number>,
    high_min: 6,
    medium_min: 4,
  },
};

export type PipelineConfig = typeof PIPELINE;
