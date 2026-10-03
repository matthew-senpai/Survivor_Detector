import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

const Code = ({ children }: { children: string }) => (
  <pre className="mt-2 overflow-x-auto border border-line bg-bg p-2.5 font-mono text-[11.5px] leading-relaxed text-hud">{children}</pre>
);
const Step = ({ n, title, children }: { n: number; title: string; children: ReactNode }) => (
  <li className="border-b border-line py-3">
    <div className="flex items-center gap-2"><span className="grid size-5 place-items-center bg-ok font-mono text-[11px] font-semibold text-black">{n}</span><span className="font-display text-[17px] font-semibold uppercase">{title}</span></div>
    <div className="mt-1.5 space-y-1.5 text-[13px] leading-relaxed text-ink/85">{children}</div>
  </li>
);

export default function HelpDrawer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[3000] flex justify-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label="Connect a real drone">
      <aside className="h-full w-full max-w-[560px] overflow-y-auto border-l border-line-2 bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="label text-ok">Field guide</div>
            <h2 className="font-display text-3xl font-semibold uppercase">Connect a real drone</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink"><X size={18} /></button>
        </div>
        <p className="mt-2 text-[13px] text-muted">Use Chrome or Edge on a laptop. Everything runs in this browser tab: video, detection and mission records never leave the machine unless you export them.</p>

        <h3 className="label mt-6">Video</h3>
        <ol>
          <Step n={1} title="HDMI out → capture card">
            <p>Most controllers (DJI RC Pro / smart controllers, Autel, Skydio, SIYI ground units) have HDMI out. Plug it into a USB HDMI capture card, then pick <b>Capture card / camera</b> in setup.</p>
          </Step>
          <Step n={2} title="Or capture the pilot app window">
            <p>If the live view is on this laptop (QGroundControl, Mission Planner, DJI Assistant, a phone mirrored with scrcpy), pick <b>Screen / app window</b> and select that window. Hide on-screen overlays for best detection.</p>
          </Step>
          <Step n={3} title="Or process the recording afterwards">
            <p>Pick <b>Video file</b>. Recordings are processed frame by frame, so nothing is skipped.</p>
          </Step>
        </ol>

        <h3 className="label mt-6">Position (telemetry)</h3>
        <ol>
          <Step n={1} title="PX4 / ArduPilot: USB telemetry radio">
            <p>Plug the ground-side radio (SiK, 57600 baud) or the flight controller's USB into the laptop. Choose <b>MAVLink · USB serial</b>, then <b>Connect</b>. Landsight only listens; it never sends commands.</p>
            <p>Make sure position streams are on (ArduPilot: <code className="text-hud">SR1_POSITION = 5</code>; PX4 streams by default). Close Mission Planner/QGC first, or use the bridge below to share the link.</p>
          </Step>
          <Step n={2} title="Share a link with QGroundControl (bridge)">
            <p>Forward MAVLink to UDP 14550 (QGC: Application Settings → MAVLink → Forwarding), then run the bridge on this laptop and choose <b>MAVLink · WebSocket</b> with <code className="text-hud">ws://localhost:8765</code>:</p>
            <Code>{`pip install pymavlink websockets
python backend/tools/mavlink_ws_bridge.py --udp 14550`}</Code>
            <p>No drone? <code className="text-hud">--simulate</code> streams labelled simulated telemetry to test the whole path.</p>
          </Step>
          <Step n={3} title="DJI: the .SRT flight log">
            <p>DJI doesn't expose live telemetry to browsers. Turn on <b>Video Subtitles</b> in DJI Fly (camera settings), then after landing load the video <b>and</b> its <code className="text-hud">.SRT</code> file. Most logs have no compass heading: Landsight estimates it from the flight path, which is accurate when flying forward. During the flight, run detection-only on the live view.</p>
          </Step>
        </ol>

        <h3 className="label mt-6">Camera</h3>
        <ul className="space-y-1.5 py-2 text-[13px] text-ink/85">
          <li>• Field of view: enter the 35 mm-equivalent focal length (24 mm on most DJI cameras ≈ 73.7°).</li>
          <li>• Point the gimbal straight down (-90°) for the most accurate positions; oblique angles work but errors grow with distance.</li>
          <li>• Altitude is height above the take-off point. If the search area is lower or higher, set an altitude offset.</li>
        </ul>
        <a href="https://survivor-detector.vercel.app/hardware" target="_blank" rel="noreferrer" className="mt-3 inline-block text-[13px] text-hud underline">Full hardware integration guide ↗</a>
      </aside>
    </div>
  );
}
