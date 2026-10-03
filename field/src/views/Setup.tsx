import { Camera as CamIcon, Cpu, FileVideo2, FlaskConical, Monitor, Play, Radio, Satellite, Upload, Video } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DetectorState } from "../App";
import Header from "../components/Header";
import SelfTest from "../components/SelfTest";
import { MODES, type Mode } from "../detector/yolo";
import { hfovFromFocal35 } from "../pipeline/geo";
import { parseCsv, parseDjiSrt, TelemetryError, TelemetryTrack } from "../pipeline/telemetry";
import type { SessionSettings, TelemetryChoice } from "../session/session";
import { storageAvailable } from "../session/store";
import { connectSerial, connectWebSocket, nowS, serialSupported, type MavLink } from "../sources/links";
import { isLive, listCameras, openCamera, openScreen, SAMPLE_CLIP, stopStream, type VideoKind } from "../sources/video";
import { Dot, fmtBytes, Note } from "../ui";

type TKind = "serial" | "ws" | "srt" | "csv" | "fixed" | "none";
const LIVE_T: TKind[] = ["serial", "ws", "fixed", "none"], REC_T: TKind[] = ["srt", "csv", "fixed", "none"];

function Card({ n, title, icon: Icon, children, aside }: { n: number; title: string; icon: typeof Cpu; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border border-line bg-panel">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="grid size-6 place-items-center bg-ok font-mono text-[12px] font-semibold text-black">{n}</span>
        <Icon size={17} className="text-muted" />
        <h2 className="font-display text-xl font-semibold uppercase tracking-wide">{title}</h2>
        <div className="ml-auto">{aside}</div>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function Opt({ on, disabled, onClick, icon: Icon, title, sub }: { on: boolean; disabled?: boolean; onClick: () => void; icon: typeof Cpu; title: string; sub: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      className={`flex items-start gap-2.5 border p-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-35 ${on ? "border-ok bg-ok/10" : "border-line hover:border-line-2"}`}>
      <Icon size={17} className={on ? "mt-0.5 text-ok" : "mt-0.5 text-muted"} />
      <span><span className="block text-[13px] font-medium">{title}</span><span className="block text-[11.5px] leading-snug text-muted">{sub}</span></span>
    </button>
  );
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="block"><span className="label mb-1 block">{label}</span>{children}{hint && <span className="mt-1 block text-[11px] text-dim">{hint}</span>}</label>
);

export default function Setup({ det, onStart }: { det: DetectorState; onStart: (s: SessionSettings) => void }) {
  const [caps, setCaps] = useState({ webgpu: "gpu" in navigator, serial: serialSupported(), camera: !!navigator.mediaDevices?.getUserMedia, storage: true });
  const [selfTest, setSelfTest] = useState(false);
  const [backend, setBackend] = useState<"auto" | "webgpu" | "wasm">("auto");
  const [classIds, setClassIds] = useState("0");

  const [vkind, setVkind] = useState<VideoKind>("sample");
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [videoErr, setVideoErr] = useState<string | null>(null);
  const preview = useRef<HTMLVideoElement>(null);

  const [tkind, setTkind] = useState<TKind>("none");
  const [baud, setBaud] = useState(57600);
  const [wsUrl, setWsUrl] = useState("ws://localhost:8765");
  const [link, setLink] = useState<MavLink | null>(null);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logTrack, setLogTrack] = useState<{ track: TelemetryTrack; label: string; notes: string[] } | null>(null);
  const [logErr, setLogErr] = useState<string[] | null>(null);
  const [fixed, setFixed] = useState({ lat: "", lon: "", alt: "30", heading: "0" });

  const [focal, setFocal] = useState("24");
  const [pitch, setPitch] = useState("-90");
  const [altOffset, setAltOffset] = useState("0");
  const [headingOv, setHeadingOv] = useState("");
  const [latency, setLatency] = useState("150");
  const [offset, setOffset] = useState("0");
  const [startAt, setStartAt] = useState(String(SAMPLE_CLIP.start));
  const [mode, setMode] = useState<Mode>("balanced");
  const [conf, setConf] = useState(0.25);
  const [maxFps, setMaxFps] = useState("3");
  const [name, setName] = useState("Sample: ice-climb survey");
  const [, tick] = useState(0);

  const live = isLive(vkind);
  useEffect(() => { storageAvailable().then((ok) => setCaps((c) => ({ ...c, storage: ok }))); listCameras().then(setCams); }, []);
  useEffect(() => { if (!link) return; const id = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(id); }, [link]);

  // video preview
  useEffect(() => {
    const v = preview.current;
    if (!v) return;
    v.srcObject = null;
    v.removeAttribute("src");
    if ((vkind === "camera" || vkind === "screen") && stream) v.srcObject = stream;
    else if (vkind === "file" && file) v.src = URL.createObjectURL(file);
    else if (vkind === "sample") { v.crossOrigin = "anonymous"; v.src = SAMPLE_CLIP.url; v.currentTime = SAMPLE_CLIP.start + 6; }
    v.play().catch(() => {});
  }, [vkind, stream, file]);

  const pickVideo = (k: VideoKind) => {
    setVideoErr(null);
    if (k !== vkind && (vkind === "camera" || vkind === "screen")) { stopStream(stream ?? undefined); setStream(null); }
    setVkind(k);
    const okT = isLive(k) ? LIVE_T : REC_T;
    if (!okT.includes(tkind)) setTkind("none");
    if (k === "sample") { setStartAt(String(SAMPLE_CLIP.start)); setMaxFps("3"); setName("Sample: ice-climb survey"); setTkind("none"); }
    else if (k !== "file") { setMaxFps("8"); if (name.startsWith("Sample")) setName("Sector search"); }
    else { setStartAt("0"); setMaxFps("4"); if (name.startsWith("Sample")) setName("Recorded flight"); }
  };
  const connectCam = async (id = camId) => {
    setVideoErr(null);
    try { stopStream(stream ?? undefined); const s = await openCamera(id || undefined); setStream(s); setCams(await listCameras()); } catch (e) { setVideoErr((e as Error).message); }
  };
  const connectScreen = async () => {
    setVideoErr(null);
    try { stopStream(stream ?? undefined); setStream(await openScreen()); } catch (e) { setVideoErr((e as Error).message); }
  };

  const pitchN = Number(pitch);
  const connectLink = async () => {
    setLinkErr(null); setBusy(true);
    try {
      link?.close();
      setLink(tkind === "serial" ? await connectSerial(baud, { gimbal_pitch_deg: pitchN }) : await connectWebSocket(wsUrl, { gimbal_pitch_deg: pitchN }));
    } catch (e) { setLinkErr((e as Error).message); } finally { setBusy(false); }
  };
  const loadLog = async (f: File) => {
    setLogErr(null); setLogTrack(null);
    try {
      const text = await f.text();
      if (tkind === "srt") {
        const r = parseDjiSrt(text, { heading_deg: Number(headingOv) || 0, gimbal_pitch_deg: pitchN });
        if (r.focal35) setFocal(String(r.focal35));
        setLogTrack({ track: new TelemetryTrack(r.samples), label: `${f.name} (DJI log)`, notes: r.notes });
      } else setLogTrack({ track: new TelemetryTrack(parseCsv(text)), label: `${f.name} (CSV)`, notes: [] });
    } catch (e) { setLogErr(e instanceof TelemetryError ? e.errors : [(e as Error).message]); }
  };

  const hfov = hfovFromFocal35(Number(focal) || 24);
  const st = link?.telemetry.state, lastPos = link?.track.latest();
  const hbAge = st?.heartbeatAt ? nowS() - st.heartbeatAt : null;

  const problems: string[] = [];
  if (det.status !== "ready") problems.push(det.status === "error" ? "Detector failed to load (see step 1)." : "Detector is still loading.");
  if ((vkind === "camera" || vkind === "screen") && !stream) problems.push("Connect the video source (step 2).");
  if (vkind === "file" && !file) problems.push("Choose a video file (step 2).");
  if ((tkind === "serial" || tkind === "ws") && (!link || link.closed)) problems.push("Connect the MAVLink link (step 3).");
  if ((tkind === "srt" || tkind === "csv") && !logTrack) problems.push("Load a valid flight log (step 3).");
  if (tkind === "fixed" && !(Math.abs(Number(fixed.lat)) <= 90 && fixed.lat && Math.abs(Number(fixed.lon)) <= 180 && fixed.lon && Number(fixed.alt) > 0)) problems.push("Enter a valid fixed position and height (step 3).");
  const ids = classIds.split(/[\s,]+/).filter(Boolean).map(Number);
  if (!ids.length || ids.some((i) => !Number.isInteger(i) || i < 0 || (det.info && i >= det.info.classes))) problems.push("Person class ids must be valid class indices of the model.");

  const start = () => {
    let telemetry: TelemetryChoice;
    if (tkind === "serial" || tkind === "ws") telemetry = { kind: "mavlink", link: link!, label: `MAVLink ${link!.label}` };
    else if (tkind === "srt" || tkind === "csv") telemetry = { kind: "file", ...logTrack! };
    else if (tkind === "fixed") telemetry = { kind: "fixed", label: "Fixed position (manual)", pose: { lat: Number(fixed.lat), lon: Number(fixed.lon), alt_m: Number(fixed.alt), heading_deg: Number(fixed.heading) || 0 } };
    else telemetry = { kind: "none", label: "None (detection only)" };
    const video = vkind === "sample" ? { kind: vkind, label: "Sample clip (CC0, real drone footage)", url: SAMPLE_CLIP.url }
      : vkind === "file" ? { kind: vkind, label: file!.name, file: file! }
      : { kind: vkind, label: vkind === "camera" ? (stream!.getVideoTracks()[0]?.label || "Camera") : "Screen capture", stream: stream! };
    onStart({
      name: name.trim() || "Mission", video, telemetry, hfovDeg: hfov, gimbalPitchDeg: pitchN, altOffsetM: Number(altOffset) || 0,
      headingOverride: headingOv.trim() === "" ? null : Number(headingOv), latencyMs: Number(latency) || 0, offsetS: Number(offset) || 0,
      startAtS: live ? 0 : Math.max(0, Number(startAt) || 0), mode, conf, classIds: ids, maxFps: Math.max(0.5, Math.min(30, Number(maxFps) || 3)),
    });
  };

  const cap = (ok: boolean, label: string, note: string) => (
    <span className="flex items-center gap-1.5 font-mono text-[11px]" title={note}><Dot tone={ok ? "ok" : "warn"} />{label}</span>
  );

  return (
    <div className="min-h-full">
      <Header>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {cap(caps.webgpu, "WebGPU", caps.webgpu ? "GPU inference available" : "No WebGPU: detection runs on the CPU (slower)")}
          {cap(caps.serial, "Web Serial", caps.serial ? "USB telemetry radios supported" : "No Web Serial: use Chrome/Edge desktop for USB telemetry")}
          {cap(caps.camera, "Camera", "Camera / capture card access")}
          {cap(caps.storage, "Storage", caps.storage ? "Missions are saved in this browser" : "Private mode: missions won't be saved; export them")}
        </div>
      </Header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label text-ok">Field station</div>
            <h1 className="font-display text-4xl font-semibold uppercase leading-none md:text-5xl">Real drone. Real detection.</h1>
            <p className="mt-2 max-w-2xl text-[14px] text-muted">Feed a drone's video and position into this tab: people are detected with a neural network running on this machine's GPU, tracked, located on the map, and ranked for rescue. Nothing is uploaded.</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card n={1} title="Detector" icon={Cpu} aside={det.status === "ready" && <button onClick={() => setSelfTest(true)} className="flex items-center gap-1.5 border border-line px-2 py-1 text-[12px] text-muted hover:text-ink"><FlaskConical size={13} />Self-test</button>}>
            {det.status === "loading" && <Note tone="info">Loading YOLO11n person detector… {det.progress[1] ? `${fmtBytes(det.progress[0])} / ${fmtBytes(det.progress[1])}` : ""}</Note>}
            {det.status === "error" && <Note tone="bad">Detector failed: {det.error}</Note>}
            {det.info && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-4">
                <span><span className="label block">Model</span>{det.info.model}</span>
                <span><span className="label block">Runs on</span><span className={det.info.backend === "webgpu" ? "text-ok" : "text-medium"}>{det.info.backend === "webgpu" ? "GPU (WebGPU)" : `CPU (${det.info.threads} thread${det.info.threads > 1 ? "s" : ""})`}</span></span>
                <span><span className="label block">Input</span>{det.info.size}×{det.info.size}, {det.info.classes} classes</span>
                <span><span className="label block">Warm-up</span>{det.info.warmupMs.toFixed(0)} ms</span>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Run on">
                <select value={backend} onChange={(e) => { const b = e.target.value as typeof backend; setBackend(b); det.load(undefined, b); }}>
                  <option value="auto">Auto (GPU if available)</option><option value="webgpu">GPU only</option><option value="wasm">CPU only</option>
                </select>
              </Field>
              <Field label="Person class ids" hint="COCO: 0. Custom models: their person classes.">
                <input type="text" value={classIds} onChange={(e) => setClassIds(e.target.value)} />
              </Field>
              <Field label="Custom model (.onnx)" hint="YOLOv8/11 detect export, e.g. fine-tuned on aerial SAR data.">
                <label className="flex cursor-pointer items-center gap-2 border border-dashed border-line-2 px-2 py-1.5 text-[12px] text-muted hover:text-ink">
                  <Upload size={13} />Load model…
                  <input type="file" accept=".onnx" className="sr-only" onChange={(e) => e.target.files?.[0] && det.load(e.target.files[0], backend)} />
                </label>
              </Field>
            </div>
            <p className="text-[11.5px] text-dim">YOLO11n is a general-purpose detector (COCO). From altitude it finds clearly visible people well; tiny, straight-down figures need High sensitivity or an aerial fine-tuned model. Weights: AGPL-3.0 (Ultralytics).</p>
          </Card>

          <Card n={2} title="Video" icon={Video}>
            <div className="grid grid-cols-2 gap-2">
              <Opt on={vkind === "camera"} onClick={() => pickVideo("camera")} icon={CamIcon} title="Capture card / camera" sub="Controller HDMI → USB capture, or a USB camera" />
              <Opt on={vkind === "screen"} onClick={() => pickVideo("screen")} icon={Monitor} title="Screen / app window" sub="Pilot app live view (QGC, DJI, mirrored phone)" />
              <Opt on={vkind === "file"} onClick={() => pickVideo("file")} icon={FileVideo2} title="Video file" sub="A recorded flight, processed frame by frame" />
              <Opt on={vkind === "sample"} onClick={() => pickVideo("sample")} icon={Play} title="Sample clip" sub="Real public-domain drone footage of climbers" />
            </div>
            {vkind === "camera" && (
              <div className="flex gap-2">
                <select value={camId} onChange={(e) => { setCamId(e.target.value); if (stream) connectCam(e.target.value); }} aria-label="Video device">
                  <option value="">Default device</option>
                  {cams.map((c, i) => <option key={c.deviceId || i} value={c.deviceId}>{c.label || `Video device ${i + 1}`}</option>)}
                </select>
                <button onClick={() => connectCam()} className="shrink-0 bg-ok px-3 text-[13px] font-semibold text-black">{stream ? "Reconnect" : "Connect"}</button>
              </div>
            )}
            {vkind === "screen" && <button onClick={connectScreen} className="bg-ok px-3 py-1.5 text-[13px] font-semibold text-black">{stream ? "Choose another window" : "Choose window or screen"}</button>}
            {vkind === "file" && (
              <label className="flex cursor-pointer items-center gap-2 border border-dashed border-line-2 px-3 py-2 text-[13px] text-muted hover:text-ink">
                <Upload size={14} />{file ? `${file.name} · ${fmtBytes(file.size)}` : "Choose drone video (MP4 / WebM / MOV)…"}
                <input type="file" accept="video/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
            {vkind === "sample" && <p className="text-[12px] text-muted">Streams from Wikimedia Commons ({SAMPLE_CLIP.credit}). No flight log exists for it, so it runs detection-only. <a className="text-hud underline" href={SAMPLE_CLIP.page} target="_blank" rel="noreferrer">Source</a></p>}
            {videoErr && <Note tone="bad">{videoErr}</Note>}
            <video ref={preview} muted playsInline className="aspect-video w-full bg-black object-contain" />
          </Card>

          <Card n={3} title="Position (telemetry)" icon={Satellite}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Opt on={tkind === "serial"} disabled={!live || !caps.serial} onClick={() => setTkind("serial")} icon={Radio} title="MAVLink · USB serial" sub="Telemetry radio or flight controller USB" />
              <Opt on={tkind === "ws"} disabled={!live} onClick={() => setTkind("ws")} icon={Radio} title="MAVLink · WebSocket" sub="Via the bridge (shares link with QGC)" />
              <Opt on={tkind === "srt"} disabled={live} onClick={() => setTkind("srt")} icon={FileVideo2} title="DJI .SRT log" sub="Saved next to DJI videos" />
              <Opt on={tkind === "csv"} disabled={live} onClick={() => setTkind("csv")} icon={FileVideo2} title="CSV log" sub="t, lat, lon, alt_m, heading_deg…" />
              <Opt on={tkind === "fixed"} onClick={() => setTkind("fixed")} icon={Satellite} title="Fixed position" sub="Hovering drone at a known point" />
              <Opt on={tkind === "none"} onClick={() => setTkind("none")} icon={Video} title="None" sub="Detection & tracking only, no map" />
            </div>
            {(tkind === "serial" || tkind === "ws") && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  {tkind === "serial"
                    ? <select value={baud} onChange={(e) => setBaud(Number(e.target.value))} aria-label="Baud rate">{[57600, 115200, 230400, 460800, 921600].map((b) => <option key={b} value={b}>{b} baud{b === 57600 ? " (SiK radio)" : b === 115200 ? " (FC USB)" : ""}</option>)}</select>
                    : <input type="text" value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} aria-label="Bridge URL" />}
                  <button disabled={busy} onClick={connectLink} className="shrink-0 bg-ok px-3 text-[13px] font-semibold text-black disabled:opacity-50">{link && !link.closed ? "Reconnect" : "Connect"}</button>
                </div>
                {linkErr && <Note tone="bad">{linkErr}</Note>}
                {link && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 border border-line bg-bg p-2.5 font-mono text-[11.5px] sm:grid-cols-4">
                    <span className="flex items-center gap-1.5"><Dot tone={hbAge !== null && hbAge < 3 ? "ok" : "bad"} />{hbAge === null ? "no heartbeat" : hbAge < 3 ? "heartbeat" : `silent ${hbAge.toFixed(0)} s`}</span>
                    <span className="flex items-center gap-1.5"><Dot tone={(st?.gpsFix ?? 0) >= 3 ? "ok" : "warn"} />GPS fix {st?.gpsFix ?? 0} · {st?.sats ?? 0} sats</span>
                    <span>{lastPos ? `${lastPos.lat.toFixed(6)}, ${lastPos.lon.toFixed(6)}` : "waiting for position"}</span>
                    <span>{lastPos ? `${lastPos.alt_m.toFixed(1)} m · ${lastPos.heading_deg.toFixed(0)}°` : `${link.telemetry.linkStats.frames} msgs`}</span>
                    {st?.simulated && <span className="col-span-full text-medium">⚠ Source reports SIMULATED telemetry ({st.lastText}).</span>}
                    {link.error && <span className="col-span-full text-high">{link.error}</span>}
                  </div>
                )}
              </div>
            )}
            {(tkind === "srt" || tkind === "csv") && (
              <>
                <label className="flex cursor-pointer items-center gap-2 border border-dashed border-line-2 px-3 py-2 text-[13px] text-muted hover:text-ink">
                  <Upload size={14} />{logTrack ? logTrack.label : tkind === "srt" ? "Choose the .SRT file recorded with this video…" : "Choose telemetry CSV…"}
                  <input type="file" accept={tkind === "srt" ? ".srt,.SRT" : ".csv,text/csv"} className="sr-only" onChange={(e) => e.target.files?.[0] && loadLog(e.target.files[0])} />
                </label>
                {logErr && <Note tone="bad"><b>Log rejected.</b> {logErr.slice(0, 6).join(" · ")}</Note>}
                {logTrack && <Note tone="ok">{logTrack.track.length} positions over {(logTrack.track.latest().t - logTrack.track.samples[0].t).toFixed(0)} s. {logTrack.notes.join(" ")}</Note>}
              </>
            )}
            {tkind === "fixed" && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="Latitude"><input type="number" step="any" value={fixed.lat} onChange={(e) => setFixed({ ...fixed, lat: e.target.value })} /></Field>
                <Field label="Longitude"><input type="number" step="any" value={fixed.lon} onChange={(e) => setFixed({ ...fixed, lon: e.target.value })} /></Field>
                <Field label="Height above ground (m)"><input type="number" value={fixed.alt} onChange={(e) => setFixed({ ...fixed, alt: e.target.value })} /></Field>
                <Field label="Camera heading (°)"><input type="number" value={fixed.heading} onChange={(e) => setFixed({ ...fixed, heading: e.target.value })} /></Field>
                <p className="col-span-full text-[11.5px] text-medium">Only valid while the drone hovers at this point. If the camera moves, positions drift and people appear to move.</p>
              </div>
            )}
            {tkind === "none" && <p className="text-[12px] text-muted">People are detected, tracked and saved with evidence, but without positions: no map, no cross-pass merging.</p>}
          </Card>

          <Card n={4} title="Camera & detection" icon={CamIcon}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Lens (35 mm eq.)" hint={`= ${hfov.toFixed(1)}° horizontal`}><input type="number" value={focal} onChange={(e) => setFocal(e.target.value)} /></Field>
              <Field label="Gimbal pitch (°)" hint="-90 = straight down; used if telemetry has none"><input type="number" value={pitch} onChange={(e) => setPitch(e.target.value)} /></Field>
              <Field label="Altitude offset (m)" hint="Search area lower than take-off: +"><input type="number" value={altOffset} onChange={(e) => setAltOffset(e.target.value)} /></Field>
              <Field label="Heading override (°)" hint="Blank = from telemetry"><input type="number" value={headingOv} placeholder="auto" onChange={(e) => setHeadingOv(e.target.value)} /></Field>
              {live
                ? <Field label="Video latency (ms)" hint="How far video lags telemetry"><input type="number" value={latency} onChange={(e) => setLatency(e.target.value)} /></Field>
                : <><Field label="Log time offset (s)" hint="Log time = video time + offset"><input type="number" step="0.1" value={offset} onChange={(e) => setOffset(e.target.value)} /></Field>
                  <Field label="Start at (s)"><input type="number" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></Field></>}
              <Field label={live ? "Max frames / s" : "Frames per video second"}><input type="number" step="0.5" value={maxFps} onChange={(e) => setMaxFps(e.target.value)} /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(MODES) as Mode[]).map((m) => <Opt key={m} on={mode === m} onClick={() => setMode(m)} icon={Cpu} title={MODES[m].label} sub={MODES[m].hint} />)}
            </div>
            <Field label={`Confidence threshold: ${(conf * 100).toFixed(0)}%`} hint="Lower finds more people and more false alarms. The tracker still needs 3 consistent hits.">
              <input type="range" min={0.1} max={0.6} step={0.05} value={conf} onChange={(e) => setConf(Number(e.target.value))} className="w-full" />
            </Field>
          </Card>
        </div>

        <div className="mt-4 flex flex-col gap-3 border border-line bg-panel p-4 md:flex-row md:items-end">
          <Field label="Mission name"><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="flex-1 text-[12.5px] text-medium">{problems.map((p) => <div key={p}>• {p}</div>)}</div>
          <button onClick={start} disabled={problems.length > 0} className="flex items-center justify-center gap-2 bg-ok px-6 py-3 font-semibold text-black transition hover:bg-[#5be89b] disabled:cursor-not-allowed disabled:opacity-40">
            <Play size={17} />Start mission
          </button>
        </div>
      </main>
      {selfTest && <SelfTest detector={det.detector} onClose={() => setSelfTest(false)} />}
    </div>
  );
}
