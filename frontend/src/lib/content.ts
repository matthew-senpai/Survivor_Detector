import {
  Activity, Camera, Copy, Cpu, Crosshair, Database, Drone, EyeOff, Footprints, Hourglass, LayoutDashboard,
  ListOrdered, MapPinned, Mountain, ScanSearch, Server, Waypoints, Maximize, type LucideIcon,
} from "lucide-react";

export interface Stage {
  id: string; title: string; icon: LucideIcon; what: string; input: string; processing: string; output: string;
  real: string; module: string;
}

/** Pipeline stages, in the order the implementation actually runs them. */
export const STAGES: Stage[] = [
  {
    id: "drone", title: "Drone", icon: Drone,
    what: "Flies a lawnmower survey over the search sector at fixed height, so every square metre is imaged with overlap.",
    input: "Mission plan: sector polygon, 30 m AGL, 30 m lane spacing, 5 m/s",
    processing: "Flight controller holds altitude, heading and track; gimbal keeps the camera pointing straight down.",
    output: "A stable nadir view of the ground and a known pose for every frame.",
    real: "Multirotor UAV, PX4 / ArduPilot flight controller, 3-axis gimbal",
    module: "Mission planning: QGroundControl / Mission Planner",
  },
  {
    id: "sensors", title: "Camera + Telemetry", icon: Camera,
    what: "Captures video and the drone's position and attitude on one shared clock.",
    input: "RGB video (1080p, 25–30 fps) · GNSS position · heading · altitude",
    processing: "Frames are resampled to 5 fps; each frame is paired with the telemetry interpolated at its timestamp.",
    output: "(frame, pose) pairs",
    real: "RTSP / CSI camera + MAVLink GLOBAL_POSITION_INT, GPS_RAW_INT, ATTITUDE",
    module: "backend/app/telemetry.py · hardware/video_source.py · hardware/mavlink_source.py",
  },
  {
    id: "detect", title: "AI Detection", icon: ScanSearch,
    what: "Finds people in each frame, including partly buried or occluded ones.",
    input: "One video frame",
    processing: "YOLO-family person detector. Low-confidence boxes are kept, so the tracker can still use weak evidence.",
    output: "Bounding boxes + confidence",
    real: "YOLOv8/YOLO11 via TensorRT FP16 on Jetson Orin · sample mission replays recorded detections",
    module: "backend/app/detection.py: ReplayDetector | YoloDetector",
  },
  {
    id: "geo", title: "Geolocation", icon: MapPinned,
    what: "Turns each box into a ground coordinate. Runs per detection, before tracking, so the tracker works on the ground instead of on a moving image.",
    input: "Box centre (u, v) + drone pose + camera field of view",
    processing: "Flat-ground pinhole model: ground sample distance = 2·alt·tan(FOV/2)/width; pixel offset rotated by heading.",
    output: "Latitude / longitude per detection",
    real: "Replaceable: DEM ray-casting, oblique gimbal, RTK GNSS, orthomosaic registration",
    module: "backend/app/geolocation.py: Geolocator protocol",
  },
  {
    id: "track", title: "Object Tracking", icon: Waypoints,
    what: "Links detections of the same person across frames and gives each a persistent track ID.",
    input: "Geolocated detections for this frame",
    processing: "ByteTrack-style two-stage association (confident boxes first, then weak ones) by ground distance, which compensates for drone motion like BoT-SORT's GMC.",
    output: "Track IDs, confirmed after 3 hits",
    real: "ByteTrack / BoT-SORT logic, ground-plane gating",
    module: "backend/app/tracking.py: GroundTracker",
  },
  {
    id: "analysis", title: "Survivor Analysis", icon: Activity,
    what: "Measures what each track tells us about the person.",
    input: "All observations of a track",
    processing: "Confidence (top-5 mean), persistence (seconds tracked), movement (box-shape change = limb motion; ground velocity = crawling), location spread.",
    output: "Evidence-backed survivor attributes",
    real: "Deployment adds motion-compensated frame differencing inside each box",
    module: "backend/app/analysis.py",
  },
  {
    id: "dedup", title: "Deduplication", icon: Copy,
    what: "One person seen on two survey passes is one survivor, not two.",
    input: "Confirmed tracks",
    processing: "Tracks within 2.5 m merge, unless they were seen in the same frame (then they are different people).",
    output: "Unique survivor records",
    real: "Configurable merge radius; re-identification features can be added",
    module: "backend/app/analysis.py: deduplicate()",
  },
  {
    id: "priority", title: "Priority Assessment", icon: ListOrdered,
    what: "Ranks survivors for dispatch with a points table the operator can read, not a black box.",
    input: "Confidence, persistence, movement, location confidence",
    processing: "Points per factor. HIGH ≥ 6, MEDIUM ≥ 4, else LOW. Every point and reason is shown.",
    output: "Priority + breakdown + reasons",
    real: "Thresholds in config/pipeline.json",
    module: "backend/app/priority.py",
  },
  {
    id: "command", title: "Rescue Command Center", icon: LayoutDashboard,
    what: "One screen for the incident commander: map, survivor list, evidence, mission health.",
    input: "Survivor records, evidence, telemetry",
    processing: "FastAPI serves mission bundles; the dashboard replays or follows the mission and lets operators set rescue status.",
    output: "Dispatch decisions",
    real: "Ground-station laptop or EOC display; works offline from cached data",
    module: "frontend/src/pages/CommandCenter.tsx · backend/app/main.py",
  },
];

export interface ArchBlock {
  id: string; title: string; icon: LucideIcon; items: string[]; role: string; prototype: string; deployment: string; iface: string;
}

export const ARCH: ArchBlock[] = [
  {
    id: "uav", title: "UAV / Drone", icon: Drone, items: ["RGB Camera", "GPS / GNSS", "Flight Controller"],
    role: "Produces the two raw inputs: video of the ground and the pose it was taken from.",
    prototype: "Synthetic aerial footage rendered from a scene model + telemetry.csv with GPS drift, compass and baro error, and a 4 s GPS dropout.",
    deployment: "Multirotor with 3-axis gimbal (nadir), PX4/ArduPilot FC, GNSS (RTK optional), telemetry radio + video link.",
    iface: "Video frames + TelemetrySample(t, lat, lon, alt_m, heading_deg, gps_fix, hdop…)",
  },
  {
    id: "edge", title: "Edge Processing", icon: Cpu, items: ["Frame Processing", "Object Detection", "Object Tracking"],
    role: "Runs inference next to the camera so only detections and evidence crops need to cross the radio link.",
    prototype: "ReplayDetector feeds pre-recorded detections; YoloDetector runs on uploaded video if ultralytics is installed.",
    deployment: "Jetson Orin-class computer: TensorRT YOLO, GroundTracker; `python -m app.edge --video rtsp://… --mavlink /dev/ttyTHS1`.",
    iface: "Detector.detect(frame) → [Detection(x1, y1, x2, y2, conf)]",
  },
  {
    id: "analysis", title: "Survivor Analysis", icon: Activity, items: ["Confidence Analysis", "Movement Analysis", "Persistence", "Deduplication"],
    role: "Converts tracks into survivor records that hold up: real, persistent, moving or not, counted once.",
    prototype: "Same code as deployment. Scored against simulation ground truth: 12/12 people found, 0 duplicates.",
    deployment: "Same code; thresholds tuned per camera/altitude in config/pipeline.json.",
    iface: "build_survivors(tracks, cfg) → [Survivor]",
  },
  {
    id: "geo", title: "Geolocation Engine", icon: Crosshair, items: ["GPS / Telemetry", "Camera Parameters", "Coordinate Mapping"],
    role: "Pixel → latitude/longitude, with an uncertainty radius that drives location confidence.",
    prototype: "Nadir pinhole, flat ground. Mean error vs ground truth ≈ 0.7 m at 30 m AGL.",
    deployment: "Swap in DEM ray-casting for steep slopes, oblique gimbal support, or RTK for cm-level poses.",
    iface: "Geolocator.locate(u, v, pose) → (lat, lon)",
  },
  {
    id: "backend", title: "Backend + Database", icon: Database, items: ["Survivor Records", "Evidence", "Mission Data"],
    role: "Stores missions, survivor records, operator status changes and evidence; serves them to dashboards.",
    prototype: "FastAPI + SQLite (portable SQL schema), evidence JPGs on disk.",
    deployment: "Same API on the ground station; PostgreSQL/PostGIS for multi-team operations.",
    iface: "GET /api/missions/{id}/bundle · PATCH …/survivors/{sid}",
  },
  {
    id: "command", title: "Rescue Command Center", icon: LayoutDashboard, items: ["Interactive Map", "Survivor List", "Priority", "Evidence", "Mission Status"],
    role: "Decision surface for the incident commander.",
    prototype: "React dashboard replaying the recorded mission; falls back to a cached copy if the API is down.",
    deployment: "Follows live missions (status 'live') as the edge publishes snapshots.",
    iface: "Browser → REST",
  },
];

export const PROBLEM = [
  { icon: Mountain, title: "Landslide", text: "Mud, rock and trees bury homes and roads in minutes." },
  { icon: Maximize, title: "Large affected area", text: "Debris runs out for kilometres across unstable ground." },
  { icon: EyeOff, title: "Limited visibility", text: "Mud-coloured clothing, canopy and debris hide people." },
  { icon: Footprints, title: "Manual searching", text: "Teams on foot cover slowly, and every step is a risk." },
  { icon: Hourglass, title: "Delayed identification", text: "Survival odds fall with every hour a person stays unfound." },
  { icon: Crosshair, title: "Difficult location tracking", text: "\"Near the broken house\" is not a coordinate a team can navigate to." },
];
