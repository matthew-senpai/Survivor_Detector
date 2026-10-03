import { CircleCheck, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Detector } from "../detector/client";
import type { Box } from "../detector/yolo";

// Reference: Ultralytics YOLO11n on the same image (field/tests/fixtures/det_expected.json).
const REFERENCE: Box[] = [
  [308.6, 465.5, 505.0, 622.3, 0.774],
  [941.3, 494.5, 1027.9, 581.9, 0.675],
];
const iou = (a: Box, b: Box) => {
  const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const i = iw * ih;
  return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
};

/** Runs the detector on a public-domain drone frame and compares with the reference implementation. */
export default function SelfTest({ detector, onClose }: { detector: Detector; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [res, setRes] = useState<{ boxes: Box[]; ms: number; matched: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const img = new Image();
        img.src = "/selftest.jpg";
        await img.decode();
        const r = await detector.detect(await createImageBitmap(img), "fast", 0.25, [0]);
        const c = canvas.current!, ctx = c.getContext("2d")!;
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        ctx.lineWidth = 4;
        ctx.font = "600 28px IBM Plex Mono, monospace";
        for (const b of r.boxes) {
          ctx.strokeStyle = "#3ddc84";
          ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
          ctx.fillStyle = "#3ddc84";
          ctx.fillText(`${(b[4] * 100).toFixed(0)}%`, b[0], b[1] - 8);
        }
        const matched = REFERENCE.filter((ref) => r.boxes.some((b) => iou(b, ref) > 0.85 && Math.abs(b[4] - ref[4]) < 0.08)).length;
        setRes({ boxes: r.boxes, ms: r.ms, matched });
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [detector]);

  const pass = res && res.matched === REFERENCE.length && res.boxes.length === REFERENCE.length;
  return (
    <div className="fixed inset-0 z-[3000] grid place-items-center bg-black/75 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Detector self-test">
      <div className="w-full max-w-4xl border border-line-2 bg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="label">Detector self-test</div>
            <div className="text-[13px] text-muted">Public-domain drone frame (ice climbers, Tromsø). Expected: 2 people, same boxes as the reference implementation.</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink"><X size={18} /></button>
        </div>
        <canvas ref={canvas} className="block w-full bg-black" />
        <div className="flex items-center gap-2 px-4 py-3 text-[13px]">
          {err ? <><TriangleAlert size={16} className="text-high" /><span className="text-high">{err}</span></>
            : !res ? <><LoaderCircle size={16} className="animate-spin text-hud" />Running…</>
            : pass ? <><CircleCheck size={16} className="text-ok" /><span className="text-ok">Pass: {res.boxes.length} people, matching the reference ({res.ms.toFixed(0)} ms on this machine).</span></>
            : <><TriangleAlert size={16} className="text-medium" /><span className="text-medium">Found {res.boxes.length} people; {res.matched}/{REFERENCE.length} match the reference. Small differences come from browser image scaling; large ones mean the model or runtime is misbehaving.</span></>}
        </div>
      </div>
    </div>
  );
}
