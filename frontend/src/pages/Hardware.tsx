import { motion } from "framer-motion";
import { ArrowRight, Camera, CircleCheck, Cpu, Drone, Radio, TriangleAlert, Wrench } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { Eyebrow } from "../components/ui";

export default function Hardware() {
  return (
    <>
      <Navbar />
      <main className="pt-16">
        <section className="grid-bg relative border-b border-line">
          <div className="absolute inset-0 bg-gradient-to-b from-bg/40 to-bg" />
          <div className="relative mx-auto max-w-[1400px] px-4 pb-16 pt-16 md:px-8 md:pt-24">
            <Eyebrow>Hardware Integration &amp; Setup</Eyebrow>
            <h1 className="mt-4 max-w-4xl font-display text-5xl font-semibold uppercase leading-[0.92] md:text-7xl">From recorded footage to a real UAV</h1>
            <p className="mt-5 max-w-2xl text-[15.5px] leading-relaxed text-muted">
              The prototype replays recorded data through the same pipeline that would run in the field. This page shows
              what plugs in where, over which interface, and how to configure it.
            </p>
            <div className="mt-10 grid gap-px bg-line md:grid-cols-2">
              <ModeCard tag="PROTOTYPE MODE" color="text-medium" line="Recorded video + simulated telemetry"
                items={["Synthetic or uploaded aerial video", "telemetry.csv: GPS drift, compass/baro error, a GPS dropout", "Pre-recorded detections (or YOLO on uploaded video)", "Runs on any laptop, no GPU or hardware needed"]} />
              <ModeCard tag="DEPLOYMENT MODE" color="text-ok" line="Real drone + real camera + real telemetry + edge computing"
                items={["Gimbal camera stream (RTSP / CSI)", "MAVLink telemetry from PX4 / ArduPilot", "YOLO + TensorRT on a Jetson-class edge computer", "Records published to the command center as the drone flies"]} />
            </div>
          </div>
        </section>

        <Section id="diagram" title="Hardware connection diagram" eyebrow="01">
          <ConnectionDiagram />
        </Section>

        <Section id="components" title="Components" eyebrow="02">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card icon={Drone} title="Drone / UAV">
              <Spec rows={[
                ["Airframe", "Quad/hexacopter, 25–40 min endurance, rain-tolerant for monsoon conditions"],
                ["Flight controller", "Pixhawk-class running PX4 or ArduPilot; flies the survey grid autonomously"],
                ["GPS / GNSS", "Multi-band GNSS (RTK optional for cm-level poses); fix type, satellites and HDOP feed location confidence"],
                ["Height above ground", "Downward rangefinder if fitted (DISTANCE_SENSOR), else relative altitude. Slopes make AGL matter"],
                ["Telemetry", "MAVLink 2: GLOBAL_POSITION_INT, GPS_RAW_INT, ATTITUDE, SYS_STATUS"],
              ]} />
            </Card>
            <Card icon={Camera} title="Camera">
              <Spec rows={[
                ["Sensor", "RGB video camera; 1080p minimum, 4K preferred for higher altitude"],
                ["Video stream", "H.264/H.265 over RTSP (gimbal cameras) or MIPI-CSI direct to the edge computer"],
                ["Frame rate", "Capture 25–30 fps; the pipeline samples 5 fps (config). Fast shutter (≤ 1/500 s) avoids motion blur"],
                ["Mounting", "3-axis gimbal locked at −90° (nadir), vibration-damped; the geolocation model assumes nadir"],
                ["Calibration", "Measure horizontal FOV once (OpenCV checkerboard) → config/pipeline.json camera.hfov_deg"],
              ]} />
            </Card>
            <Card icon={Cpu} title="Edge computer">
              <p className="mb-3 text-[13.5px] text-muted">Inference runs on the drone (or at the ground station receiving the video link), so only small records and evidence crops cross the radio instead of a full video stream.</p>
              <FlowRow steps={["Drone camera", "Edge computer", "AI inference", "Telemetry sync", "Survivor records"]} />
              <Spec rows={[
                ["Class", "NVIDIA Jetson Orin Nano / Orin NX class module"],
                ["Inference", "YOLO person detector exported to TensorRT FP16 (`yolo export format=engine half=True`)"],
                ["Power", "Regulated supply from the flight battery (≈ 10–25 W)"],
                ["Sync", "Video frames and MAVLink samples stamped on one monotonic clock; pose interpolated per frame"],
              ]} />
            </Card>
            <Card icon={Radio} title="Communication">
              <FlowRow steps={["Drone", "Telemetry / data link", "Processing system", "Command center"]} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-[12.5px]">
                  <thead><tr className="border-b border-line-2 font-mono text-[10.5px] uppercase tracking-wider text-dim"><th className="py-2 pr-3">Link</th><th className="pr-3">Interface / protocol</th><th>Carries</th></tr></thead>
                  <tbody className="text-ink/85">
                    {[
                      ["Camera → edge", "MIPI-CSI · USB3 · Ethernet RTSP", "Video frames"],
                      ["Flight controller ↔ edge", "UART, MAVLink 2 @ 921600 baud", "Position, attitude, GPS status"],
                      ["Drone ↔ ground station", "Telemetry radio (433/915 MHz) or IP mesh", "MAVLink, mission control"],
                      ["Video downlink (optional)", "Digital HD video / IP radio, H.264 RTSP", "Live view for the pilot"],
                      ["Edge / GCS → backend", "HTTPS REST over LTE, mesh or satellite", "Survivor records + evidence JPGs"],
                      ["Backend → dashboards", "HTTPS (REST)", "Map, survivors, mission status"],
                    ].map(([a, b, c]) => (
                      <tr key={a} className="border-b border-line"><td className="py-2 pr-3 text-ink">{a}</td><td className="pr-3 font-mono text-[11.5px] text-hud">{b}</td><td>{c}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </Section>

        <Section id="gsd" title="Will the camera see a person?" eyebrow="03">
          <GsdCalculator />
        </Section>

        <Section id="setup" title="Configuration & setup" eyebrow="04">
          <ol className="grid gap-4 lg:grid-cols-2">
            <SetupStep n={1} title="Wire the flight controller to the edge computer">
              <p>FC <b>TELEM2</b> TX→RX, RX→TX, GND→GND to the Jetson UART (3.3 V logic). Enable MAVLink 2 on that port:</p>
              <Code>{`# ArduPilot
SERIAL2_PROTOCOL = 2      # MAVLink 2
SERIAL2_BAUD     = 921    # 921600
# PX4
MAV_1_CONFIG     = TELEM 2
SER_TEL2_BAUD    = 921600`}</Code>
            </SetupStep>
            <SetupStep n={2} title="Point the camera straight down & check the stream">
              <p>Lock the gimbal at −90° pitch for the survey. Confirm the video reaches the edge computer:</p>
              <Code>{`ffplay rtsp://192.168.144.25:8554/main
# Jetson CSI camera
gst-launch-1.0 nvarguscamerasrc ! nvvidconv ! xvimagesink`}</Code>
            </SetupStep>
            <SetupStep n={3} title="Set camera parameters">
              <p>Edit <code className="text-hud">config/pipeline.json</code>. Image size is read from the stream automatically; FOV comes from calibration.</p>
              <Code>{`"camera":     { "hfov_deg": 70.0, "mount": "nadir" },
"processing": { "fps": 5 },
"detector":   { "yolo_weights": "yolov8n.engine", "min_conf": 0.15 }`}</Code>
            </SetupStep>
            <SetupStep n={4} title="Install & optimise the model on the edge">
              <Code>{`pip install -r backend/requirements.txt
pip install ultralytics opencv-python pymavlink
yolo export model=yolov8n.pt format=engine half=True`}</Code>
              <p>Fine-tuning on aerial person datasets (e.g. VisDrone, SARD) is recommended before field use.</p>
            </SetupStep>
            <SetupStep n={5} title="Start the edge pipeline">
              <Code>{`cd backend
python -m app.edge \\
  --video rtsp://192.168.144.25:8554/main \\
  --mavlink /dev/ttyTHS1 --baud 921600 \\
  --weights yolov8n.engine --name "Sector B-3 live"`}</Code>
              <p>It waits for a MAVLink heartbeat, then publishes survivor snapshots every 5 s.</p>
            </SetupStep>
            <SetupStep n={6} title="Open the command center">
              <Code>{`uvicorn app.main:app --host 0.0.0.0 --port 8000`}</Code>
              <p>The mission appears with the green <b className="text-ok">DEPLOYMENT MODE</b> label and status LIVE; the dashboard follows new snapshots automatically.</p>
            </SetupStep>
          </ol>
          <div className="mt-6 border border-line bg-panel p-5">
            <div className="label mb-3 flex items-center gap-2"><Wrench size={13} /> Pre-flight checklist</div>
            <ul className="grid gap-2 text-[13.5px] text-ink/85 md:grid-cols-2">
              {["GNSS 3D fix, HDOP < 1.5, ≥ 10 satellites", "Gimbal at −90°, lens clean, exposure locked", "Edge computer receiving frames (check log)", "MAVLink heartbeat received by the edge pipeline", "Survey altitude set so a person spans ≥ 12 px (calculator above)", "Lane spacing gives ≥ 20 % side overlap", "Backend reachable from the ground station", "Rescue teams briefed on coordinate format & uncertainty radius"].map((c) => (
                <li key={c} className="flex gap-2"><span className="mt-1.5 size-2 shrink-0 border border-hud" />{c}</li>
              ))}
            </ul>
          </div>
        </Section>

        <Section id="status" title="What is and isn't verified" eyebrow="05">
          <div className="border border-line">
            {[
              ["Detection → geolocation → tracking → dedup → priority → evidence", "Implemented, scored against simulation ground truth (automated test)", true],
              ["Telemetry CSV parsing & validation, GPS dropout handling", "Implemented and tested", true],
              ["YOLO detector on uploaded video", "Implemented; needs `pip install ultralytics`. Generic COCO weights are weak on small aerial people until fine-tuned", null],
              ["MAVLink telemetry adapter (pymavlink)", "Implemented against the pymavlink API; not flight-tested in this prototype", false],
              ["RTSP / CSI video adapter (OpenCV / GStreamer)", "Implemented against the OpenCV API; not tested with physical cameras", false],
              ["Edge runner (app.edge)", "Implemented; not tested on a Jetson device", false],
            ].map(([k, v, ok]) => (
              <div key={k as string} className="grid gap-1 border-b border-line px-4 py-3 last:border-0 md:grid-cols-[1fr_1.2fr]">
                <span className="flex items-center gap-2 text-[13.5px]">
                  {ok === true ? <CircleCheck size={15} className="text-ok" /> : <TriangleAlert size={15} className={ok === null ? "text-medium" : "text-low"} />}{k}
                </span>
                <span className="text-[13px] text-muted">{v}</span>
              </div>
            ))}
          </div>
          <Link to="/command?demo=1" className="mt-8 inline-flex items-center gap-2 bg-signal px-5 py-3 font-semibold text-black hover:bg-[#ff9445]">
            See the pipeline run in the command center <ArrowRight size={17} />
          </Link>
        </Section>
      </main>
    </>
  );
}

function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow: string; children: ReactNode }) {
  return (
    <section id={id} className="border-b border-line py-20">
      <div className="mx-auto max-w-[1400px] px-4 md:px-8">
        <Eyebrow n={eyebrow}>{title}</Eyebrow>
        <h2 className="mb-10 mt-3 font-display text-4xl font-semibold uppercase md:text-5xl">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function ModeCard({ tag, color, line, items }: { tag: string; color: string; line: string; items: string[] }) {
  return (
    <div className="bg-bg p-6">
      <div className={`font-mono text-xs font-semibold tracking-[0.16em] ${color}`}>● {tag}</div>
      <div className="mt-2 font-display text-2xl font-semibold uppercase">{line}</div>
      <ul className="mt-4 space-y-1.5 text-[14px] text-ink/85">{items.map((i) => <li key={i} className="flex gap-2"><span className={color}>›</span>{i}</li>)}</ul>
    </div>
  );
}

function Card({ icon: Icon, title, children }: { icon: typeof Drone; title: string; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="border border-line bg-panel p-6">
      <div className="mb-4 flex items-center gap-3"><Icon size={24} className="text-signal" strokeWidth={1.6} /><h3 className="font-display text-2xl font-semibold uppercase">{title}</h3></div>
      {children}
    </motion.div>
  );
}

function Spec({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-1">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[130px_1fr] gap-3 border-b border-line py-2 text-[13px] last:border-0">
          <dt className="text-muted">{k}</dt><dd className="text-ink/90">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function FlowRow({ steps }: { steps: string[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="border border-hud/40 bg-hud/5 px-2 py-1 text-hud">{s}</span>
          {i < steps.length - 1 && <ArrowRight size={12} className="text-dim" />}
        </span>
      ))}
    </div>
  );
}

function SetupStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="border border-line bg-panel p-5">
      <div className="flex items-center gap-3"><span className="grid size-8 place-items-center bg-signal font-mono text-sm font-semibold text-black">{n}</span><h3 className="font-display text-xl font-semibold uppercase">{title}</h3></div>
      <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-ink/85">{children}</div>
    </li>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed text-hud">{children}</pre>;
}

/** SVG wiring diagram: camera → edge → (GNSS, FC, telemetry) → processing → backend → dashboard. */
function ConnectionDiagram() {
  const box = (x: number, y: number, w: number, title: string, sub: string, tone = "#e7ece9") => (
    <g>
      <rect x={x} y={y} width={w} height={58} fill="#0d1215" stroke={tone} strokeOpacity={0.55} />
      <text x={x + w / 2} y={y + 25} textAnchor="middle" fill={tone} style={{ font: "600 15px 'Barlow Condensed', sans-serif", letterSpacing: "0.06em" }}>{title.toUpperCase()}</text>
      <text x={x + w / 2} y={y + 43} textAnchor="middle" fill="#8b9792" style={{ font: "11px 'IBM Plex Mono', monospace" }}>{sub}</text>
    </g>
  );
  const link = (d: string, label: string, lx: number, ly: number) => (
    <g>
      <path d={d} fill="none" stroke="#5ef2c2" strokeOpacity={0.35} strokeWidth={1.5} />
      <path d={d} fill="none" stroke="#5ef2c2" strokeWidth={2} strokeDasharray="4 22"><animate attributeName="stroke-dashoffset" from="26" to="0" dur="1s" repeatCount="indefinite" /></path>
      <text x={lx} y={ly} fill="#5ef2c2" style={{ font: "10.5px 'IBM Plex Mono', monospace" }}>{label}</text>
    </g>
  );
  return (
    <div className="overflow-x-auto border border-line bg-bg p-4">
      <svg viewBox="0 0 980 560" className="mx-auto w-full min-w-[760px] max-w-[1100px]" role="img" aria-label="Hardware connection diagram">
        <rect x={20} y={14} width={500} height={330} fill="none" stroke="#ff7a1a" strokeOpacity={0.4} strokeDasharray="6 6" />
        <text x={32} y={34} fill="#ff7a1a" style={{ font: "600 11px 'IBM Plex Mono', monospace", letterSpacing: "0.14em" }}>ON THE UAV</text>
        {box(160, 50, 220, "Drone camera", "RGB · gimbal −90°")}
        {link("M270 108 L270 160", "CSI / USB3 / RTSP", 280, 140)}
        {box(140, 160, 260, "Flight / edge computer", "Jetson-class · YOLO + tracker", "#ff7a1a")}
        {link("M180 218 L180 270 L80 270 L80 282", "", 0, 0)}
        {box(30, 282, 140, "GPS / GNSS", "via FC · fix, HDOP")}
        {link("M270 218 L270 282", "UART MAVLink 2", 280, 256)}
        {box(195, 282, 150, "Flight controller", "PX4 / ArduPilot")}
        {link("M360 218 L360 270 L445 270 L445 282", "", 0, 0)}
        {box(370, 282, 140, "Telemetry", "radio / IP link")}
        {link("M440 340 L440 400 L600 400 L600 120 L640 120", "records + evidence (HTTPS)", 455, 393)}
        {box(640, 92, 300, "Rescue processing", "survivor analysis · dedup · priority")}
        {link("M790 150 L790 230", "REST", 800, 196)}
        {box(640, 230, 300, "Backend server", "FastAPI · SQLite / PostgreSQL")}
        {link("M790 288 L790 370", "HTTPS", 800, 334)}
        {box(640, 370, 300, "Rescue dashboard", "command center · map · evidence", "#5ef2c2")}
        <text x={640} y={470} fill="#5c6762" style={{ font: "11px 'IBM Plex Mono', monospace" }}>Ground station / emergency operations center</text>
        <text x={20} y={470} fill="#5c6762" style={{ font: "11px 'IBM Plex Mono', monospace" }}>Prototype mode replaces the dashed box with recorded video +</text>
        <text x={20} y={488} fill="#5c6762" style={{ font: "11px 'IBM Plex Mono', monospace" }}>telemetry.csv; everything to the right runs unchanged.</text>
      </svg>
    </div>
  );
}

function GsdCalculator() {
  const [alt, setAlt] = useState(30);
  const [fov, setFov] = useState(70);
  const [px, setPx] = useState(1920);
  const width = 2 * alt * Math.tan((fov * Math.PI) / 360);
  const gsd = width / px;
  const shoulders = 0.45 / gsd, body = 1.7 / gsd;
  const ok = shoulders >= 12;
  const lane = width * 0.75; // image width across track, as in the sample mission
  return (
    <div className="grid gap-px bg-line lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-6 bg-panel p-6">
        <Slider label="Altitude above ground" unit="m" value={alt} min={10} max={120} onChange={setAlt} />
        <Slider label="Horizontal field of view" unit="°" value={fov} min={30} max={100} onChange={setFov} />
        <div>
          <div className="label mb-2">Image width</div>
          <div className="flex gap-1">
            {[1280, 1920, 3840].map((w) => (
              <button key={w} onClick={() => setPx(w)} className={`flex-1 border py-2 font-mono text-[12px] ${px === w ? "border-signal text-ink" : "border-line text-muted"}`}>{w}px{w === 3840 ? " (4K)" : ""}</button>
            ))}
          </div>
        </div>
        <p className="font-mono text-[11px] text-dim">GSD = 2 · altitude · tan(FOV / 2) / image width (the same formula the geolocation engine uses).</p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-line">
        {[
          ["Ground sample distance", `${(gsd * 100).toFixed(1)} cm/px`],
          ["Footprint width", `${width.toFixed(0)} m`],
          ["Person (shoulders)", `${shoulders.toFixed(0)} px`],
          ["Person (lying, length)", `${body.toFixed(0)} px`],
          ["Lane spacing (25 % side overlap)", `${lane.toFixed(0)} m`],
        ].map(([k, v]) => (
          <div key={k} className="bg-bg p-5"><div className="label">{k}</div><div className="mt-1 font-display text-3xl font-semibold">{v}</div></div>
        ))}
        <div className={`flex items-center gap-3 p-5 ${ok ? "bg-ok/10 text-ok" : "bg-high/10 text-high"}`}>
          {ok ? <CircleCheck size={22} /> : <TriangleAlert size={22} />}
          <span className="text-[13.5px]">{ok ? "Person spans ≥ 12 px: workable for a fine-tuned detector." : "Too few pixels per person: fly lower or use a higher-resolution camera."}</span>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, unit, value, min, max, onChange }: { label: string; unit: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex justify-between"><span className="label">{label}</span><span className="font-mono text-sm">{value} {unit}</span></div>
      <input type="range" className="scrub mt-3 w-full" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
