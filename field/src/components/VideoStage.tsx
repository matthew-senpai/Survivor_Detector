import { useEffect, useRef } from "react";
import type { Session } from "../session/session";
import { PRIORITY_COLOR } from "../ui";

/** The drone video with detections drawn on top (redrawn every display frame, independent of React). */
export default function VideoStage({ session, selectedId, onSelect, controls }: { session: Session; selectedId: string | null; onSelect: (id: string) => void; controls: boolean }) {
    const host = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const hits = useRef<{ x1: number; y1: number; x2: number; y2: number; id: string }[]>([]);
    const sel = useRef(selectedId);
    sel.current = selectedId;
    useEffect(() => {
      const v = session.video;
      host.current!.prepend(v);
      return () => v.remove();
    }, [session]);
    useEffect(() => { session.video.controls = controls; }, [session, controls]);

    useEffect(() => {
      let raf = 0;
      const draw = () => {
        raf = requestAnimationFrame(draw);
        const v = session.video, c = canvas.current;
        if (!v || !c) return;
        const dpr = Math.min(2, devicePixelRatio || 1), cw = Math.round(c.clientWidth * dpr), ch = Math.round(c.clientHeight * dpr);
        if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, cw, ch);
        const [fw, fh] = session.snap.frameSize;
        if (!fw) return;
        const s = Math.min(cw / fw, ch / fh), ox = (cw - fw * s) / 2, oy = (ch - fh * s) / 2;
        const snap = session.snap;
        // while processing: latest result; once a recording is done: the result nearest the playhead
        let dets = snap.dets;
        if (!session.live && (snap.state === "finished" || snap.state === "stopped")) {
          const t = v.currentTime;
          let best: (typeof session.frameLog)[number] | null = null;
          for (const e of session.frameLog) if (Math.abs(e[1] - t) < 0.6 / session.settings.maxFps && (!best || Math.abs(e[1] - t) < Math.abs(best[1] - t))) best = e;
          dets = best ? best[2].map((d) => ({ box: [d[0], d[1], d[2], d[3], d[4]], trackId: d[5] })) : [];
        }
        hits.current = [];
        ctx.font = `600 ${Math.round(11 * dpr)}px "IBM Plex Mono", monospace`;
        ctx.textBaseline = "top";
        for (const { box, trackId } of dets) {
          const [x1, y1, x2, y2, conf] = box;
          const X1 = ox + x1 * s, Y1 = oy + y1 * s, X2 = ox + x2 * s, Y2 = oy + y2 * s;
          const sid = trackId !== null ? snap.trackToSurvivor.get(trackId) : undefined;
          const surv = sid ? snap.survivors.find((q) => q.id === sid) : undefined;
          const color = surv ? PRIORITY_COLOR[surv.priority.level] : trackId !== null ? "#5ef2c2" : "rgba(231,236,233,0.7)";
          const isSel = !!surv && surv.id === sel.current;
          ctx.strokeStyle = color;
          ctx.lineWidth = (isSel ? 3 : 1.75) * dpr;
          ctx.setLineDash(surv || trackId === null ? [] : [5 * dpr, 4 * dpr]);
          ctx.strokeRect(X1 - 3 * dpr, Y1 - 3 * dpr, X2 - X1 + 6 * dpr, Y2 - Y1 + 6 * dpr);
          ctx.setLineDash([]);
          const label = surv ? `${surv.id} ${(conf * 100).toFixed(0)}% ${surv.priority.level}${surv.movement.detected ? " · MOVING" : ""}` : trackId !== null ? `TRK ${trackId} ${(conf * 100).toFixed(0)}% · verifying` : `${(conf * 100).toFixed(0)}%`;
          const w = ctx.measureText(label).width + 8 * dpr, h = 16 * dpr, top = Y1 - h - 4 * dpr < 0 ? Y2 + 4 * dpr : Y1 - h - 4 * dpr;
          ctx.fillStyle = "rgba(7,9,11,0.85)";
          ctx.fillRect(X1 - 3 * dpr, top, w, h);
          ctx.fillStyle = color;
          ctx.fillText(label, X1 + dpr, top + 2.5 * dpr);
          if (surv) hits.current.push({ x1: (X1 - 6) / dpr, y1: (Y1 - 6) / dpr, x2: (X2 + 6) / dpr, y2: (Y2 + 6) / dpr, id: surv.id });
        }
      };
      raf = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(raf);
    }, [session]);

    const click = (e: React.MouseEvent) => {
      const r = canvas.current!.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const h = hits.current.find((b) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2);
      if (h) onSelect(h.id);
    };

    return (
      <div ref={host} className="relative h-full min-h-[280px] w-full overflow-hidden bg-black">
        <canvas ref={canvas} onClick={click} className={`absolute inset-0 h-full w-full ${controls ? "pointer-events-none" : "cursor-crosshair"}`} />
      </div>
    );
}
