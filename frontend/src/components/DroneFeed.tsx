import { useEffect, useRef, useState } from "react";
import type { Clock } from "../lib/clock";
import { asset, derive, fmtT, fmtUtc, PRIORITY_COLOR, telemetryAt, truthAt } from "../lib/mission";
import { drawParts, personParts } from "../lib/scene";
import type { Bundle, Det } from "../lib/types";

interface Props {
  bundle: Bundle;
  clock: Clock;
  zoom?: number;
  /** where the camera centre sits in the view, as fractions of width/height (hero framing) */
  center?: [number, number];
  /** display the camera rotated 90° so the direction of flight points right (hero framing) */
  sideways?: boolean;
  hud?: boolean;
  selectedId?: string | null;
  onSelect?: (survivorId: string) => void;
  className?: string;
}

const CENTER: [number, number] = [0.5, 0.5];

type Hit = { x1: number; y1: number; x2: number; y2: number; sid: string | null };

/**
 * The drone camera view. Simulation: renders the synthetic footage (terrain + people) from the true
 * flight path. Uploaded missions: plays the real video. Either way, the boxes and labels come from the
 * pipeline's recorded output, not from the scene.
 */
export default function DroneFeed({ bundle, clock, zoom = 1, center = CENTER, sideways = false, hud = true, selectedId, onSelect, className = "" }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hits = useRef<Hit[]>([]);
  const forest = useRef<CanvasPattern | null>(null);
  const [terrain, setTerrain] = useState<HTMLImageElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const sel = useRef(selectedId);
  sel.current = selectedId;

  const sim = bundle.sim;
  const videoUrl = bundle.video ? asset(bundle, bundle.video) : null;

  useEffect(() => {
    setProblem(null);
    if (!sim) {
      if (!videoUrl) setProblem("No video relay for this mission: showing pipeline detections only.");
      return;
    }
    const img = new Image();
    img.onload = () => { forest.current = forestPattern(img, sim.m_per_px); setTerrain(img); };
    img.onerror = () => setProblem("Recorded footage unavailable: showing detections only.");
    img.src = asset(bundle, sim.terrain);
  }, [bundle, sim, videoUrl]);

  useEffect(() => {
    const c = canvas.current!, ctx = c.getContext("2d")!;
    const d = derive(bundle);
    const cam = bundle.camera;
    const W = cam.image_width, H = cam.image_height;
    const tanHalf = Math.tan((cam.hfov_deg * Math.PI) / 360);
    const fps = bundle.mission.fps;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.round(wrap.current!.clientWidth * dpr), ch = Math.round(wrap.current!.clientHeight * dpr);
      if (!cw || !ch) return;
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const t = clock.now();
      const v = video.current;
      let scale: number, ox: number, oy: number;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (v && videoUrl) {
        ctx.clearRect(0, 0, cw, ch);
        if (Math.abs(v.currentTime - t) > 0.35) v.currentTime = t;
        v.playbackRate = Math.min(16, clock.speed);
        if (clock.playing && v.paused) v.play().catch(() => {});
        if (!clock.playing && !v.paused) v.pause();
        scale = Math.min(cw / W, ch / H);
      } else {
        scale = Math.max(cw / W, ch / H) * zoom;
        ctx.fillStyle = "#141c17";
        ctx.fillRect(0, 0, cw, ch);
      }
      const cx = center[0] * cw, cy = center[1] * ch;
      ox = cx - (W / 2) * scale;
      oy = cy - (H / 2) * scale;

      // world <-> camera mapping at the *true* pose (simulation only), used to keep boxes glued to people
      const pose = sim ? truthAt(bundle, t) : null;
      const gsdAt = (alt: number) => (2 * alt * tanHalf) / W;
      if (sim && pose) {
        const gsd = gsdAt(pose.alt), pxPerM = scale / gsd, h = (pose.heading * Math.PI) / 180;
        ctx.save();
        ctx.translate(cx, cy);
        if (sideways) ctx.rotate(Math.PI / 2);
        ctx.scale(pxPerM, pxPerM);
        ctx.rotate(-h);
        ctx.translate(-pose.x, -pose.y);
        ctx.imageSmoothingQuality = "high";
        if (forest.current) { // surroundings outside the mapped sector (seen during turnarounds)
          ctx.fillStyle = forest.current;
          ctx.fillRect(pose.x - 90, pose.y - 90, 180, 180);
        }
        if (terrain) ctx.drawImage(terrain, 0, 0, sim.width_px * sim.m_per_px, sim.height_px * sim.m_per_px);
        for (const p of sim.persons) {
          if (Math.abs(p.x - pose.x) < 60 && Math.abs(p.y - pose.y) < 60) drawParts(ctx, personParts(p, t));
        }
        ctx.restore();
      }
      if (!terrain && !videoUrl) drawGrid(ctx, cw, ch, dpr);

      // detections: latest box per track within the last 2 frames, motion-compensated to the current pose
      const fpos = t * fps, f0 = Math.floor(fpos);
      const shown = new Map<string, { det: Det; f: number }>();
      for (let f = f0; f >= f0 - 2; f--) {
        for (const det of d.frames.get(f) ?? []) {
          const key = det[5] != null ? `t${det[5]}` : `f${f}-${det[0]}`;
          if (det[5] == null && f !== f0) continue;
          if (!shown.has(key)) shown.set(key, { det, f });
        }
      }
      hits.current = [];
      const lw = Math.max(1.5, 1.6 * dpr);
      ctx.font = `600 ${Math.round(11 * dpr)}px "IBM Plex Mono", monospace`;
      ctx.textBaseline = "top";
      for (const { det, f } of shown.values()) {
        let [x1, y1, x2, y2] = det;
        const [, , , , conf, tid, sid] = det;
        if (sim && pose) {
          const then = truthAt(bundle, f / fps);
          const [wx, wy] = camToWorld((x1 + x2) / 2, (y1 + y2) / 2, then, gsdAt(then.alt), W, H);
          const [u, vv] = worldToCam(wx, wy, pose, gsdAt(pose.alt), W, H);
          const hw = (x2 - x1) / 2, hh = (y2 - y1) / 2;
          [x1, y1, x2, y2] = [u - hw, vv - hh, u + hw, vv + hh];
        }
        const pad = 5 * dpr;
        let X1 = ox + x1 * scale - pad, Y1 = oy + y1 * scale - pad, X2 = ox + x2 * scale + pad, Y2 = oy + y2 * scale + pad;
        if (sideways) { // rotate the box 90° clockwise about the view centre: (dx, dy) -> (-dy, dx)
          [X1, Y1, X2, Y2] = [cx - (Y2 - cy), cy + (X1 - cx), cx - (Y1 - cy), cy + (X2 - cx)];
        }
        if (X2 < 0 || Y2 < 0 || X1 > cw || Y1 > ch) continue;
        const s = sid ? bundle.survivors.find((q) => q.id === sid) : undefined;
        const confirmed = s && s.confirmed_t <= t;
        const color = confirmed ? PRIORITY_COLOR[s!.priority.level] : tid != null ? "#5ef2c2" : "rgba(220,220,220,0.6)";
        const isSel = confirmed && s!.id === sel.current;
        ctx.strokeStyle = color;
        ctx.lineWidth = isSel ? lw * 2 : lw;
        ctx.setLineDash(confirmed || tid == null ? [] : [5 * dpr, 4 * dpr]);
        if (isSel) { ctx.shadowColor = color; ctx.shadowBlur = 14 * dpr; }
        bracket(ctx, X1, Y1, X2, Y2, confirmed ? 1 : 0.3);
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);
        const l1 = confirmed ? `${s!.id}  ${(conf * 100).toFixed(0)}%` : tid != null ? `TRK ${tid}  ${(conf * 100).toFixed(0)}%` : `${(conf * 100).toFixed(0)}%`;
        const l2 = confirmed ? `${s!.priority.level}${s!.movement.detected ? " · MOVING" : ""}` : tid != null ? "VERIFYING" : "";
        label(ctx, X1, Y1, l1, l2, color, dpr);
        hits.current.push({ x1: X1 / dpr, y1: Y1 / dpr, x2: X2 / dpr, y2: Y2 / dpr, sid: confirmed ? s!.id : null });
      }

      if (hud) drawHud(ctx, cw, ch, dpr, bundle, t, scale, gsdAt(pose?.alt ?? telemetryAt(bundle, t)?.alt_m ?? 30), !!sim);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [bundle, clock, terrain, zoom, center[0], center[1], sideways, hud, sim, videoUrl]);

  const onClick = (e: React.MouseEvent) => {
    if (!onSelect) return;
    const r = wrap.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const h = hits.current.find((b) => b.sid && x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2);
    if (h?.sid) onSelect(h.sid);
  };

  return (
    <div ref={wrap} className={`relative overflow-hidden bg-[#0b0f0d] ${className}`} onClick={onClick}>
      {videoUrl && <video ref={video} src={videoUrl} muted playsInline className="absolute inset-0 h-full w-full object-contain" onError={() => setProblem("Video failed to load: showing detections only.")} />}
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" style={{ cursor: onSelect ? "crosshair" : "default" }} />
      <div className="scanlines pointer-events-none absolute inset-0 opacity-60" />
      {problem && <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-line-2 bg-bg/85 px-3 py-2 font-mono text-xs text-medium">{problem}</div>}
    </div>
  );
}

/** Seamless forest texture (a forest patch from the terrain, mirror-tiled) in world metres. */
function forestPattern(img: HTMLImageElement, mpp: number): CanvasPattern | null {
  const [sx, sy, n] = [Math.round(2 / mpp), Math.round(88 / mpp), Math.round(30 / mpp)];
  const c = document.createElement("canvas");
  c.width = c.height = n * 2;
  const g = c.getContext("2d")!;
  for (const [fx, fy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    g.save();
    g.translate(fx > 0 ? 0 : 2 * n, fy > 0 ? 0 : 2 * n);
    g.scale(fx, fy);
    g.drawImage(img, sx, sy, n, n, 0, 0, n, n);
    g.restore();
  }
  const p = g.createPattern(c, "repeat");
  p?.setTransform(new DOMMatrix().scale(mpp));
  return p;
}

function camToWorld(u: number, v: number, p: { x: number; y: number; heading: number }, gsd: number, W: number, H: number) {
  const h = (p.heading * Math.PI) / 180, r = (u - W / 2) * gsd, f = -(v - H / 2) * gsd;
  return [p.x + r * Math.cos(h) + f * Math.sin(h), p.y + r * Math.sin(h) - f * Math.cos(h)];
}
function worldToCam(x: number, y: number, p: { x: number; y: number; heading: number }, gsd: number, W: number, H: number) {
  const h = (p.heading * Math.PI) / 180, dx = x - p.x, dy = y - p.y;
  return [W / 2 + (dx * Math.cos(h) + dy * Math.sin(h)) / gsd, H / 2 - (dx * Math.sin(h) - dy * Math.cos(h)) / gsd];
}

function bracket(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, full: number) {
  const k = Math.min(x2 - x1, y2 - y1) * 0.3;
  ctx.beginPath();
  if (full >= 1) ctx.rect(x1, y1, x2 - x1, y2 - y1);
  for (const [x, y, dx, dy] of [[x1, y1, 1, 1], [x2, y1, -1, 1], [x1, y2, 1, -1], [x2, y2, -1, -1]] as const) {
    ctx.moveTo(x + dx * k, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * k);
  }
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, l1: string, l2: string, color: string, dpr: number) {
  const pad = 4 * dpr, lh = 14 * dpr;
  const w = Math.max(ctx.measureText(l1).width, l2 ? ctx.measureText(l2).width : 0) + pad * 2;
  const h = (l2 ? 2 : 1) * lh + pad;
  const top = y - h - 3 * dpr < 0 ? y + 3 * dpr : y - h - 3 * dpr;
  ctx.fillStyle = "rgba(7,9,11,0.82)";
  ctx.fillRect(x, top, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, top, 3 * dpr, h);
  ctx.fillText(l1, x + pad + 2 * dpr, top + pad * 0.7);
  if (l2) {
    ctx.fillStyle = "rgba(231,236,233,0.85)";
    ctx.fillText(l2, x + pad + 2 * dpr, top + pad * 0.7 + lh);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, cw: number, ch: number, dpr: number) {
  ctx.strokeStyle = "rgba(94,242,194,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < cw; x += 40 * dpr) { ctx.moveTo(x, 0); ctx.lineTo(x, ch); }
  for (let y = 0; y < ch; y += 40 * dpr) { ctx.moveTo(0, y); ctx.lineTo(cw, y); }
  ctx.stroke();
}

function drawHud(ctx: CanvasRenderingContext2D, cw: number, ch: number, dpr: number, b: Bundle, t: number, scale: number, gsd: number, sim: boolean) {
  const tel = telemetryAt(b, t);
  const m = 14 * dpr, k = 22 * dpr;
  ctx.strokeStyle = "rgba(94,242,194,0.85)";
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  for (const [x, y, dx, dy] of [[m, m, 1, 1], [cw - m, m, -1, 1], [m, ch - m, 1, -1], [cw - m, ch - m, -1, -1]] as const) {
    ctx.moveTo(x + dx * k, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * k);
  }
  const cx = cw / 2, cy = ch / 2, r = 10 * dpr;
  ctx.moveTo(cx - 2 * r, cy); ctx.lineTo(cx - r * 0.6, cy); ctx.moveTo(cx + r * 0.6, cy); ctx.lineTo(cx + 2 * r, cy);
  ctx.moveTo(cx, cy - 2 * r); ctx.lineTo(cx, cy - r * 0.6); ctx.moveTo(cx, cy + r * 0.6); ctx.lineTo(cx, cy + 2 * r);
  ctx.stroke();

  ctx.font = `500 ${Math.round(10.5 * dpr)}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "top";
  const tx = m + 8 * dpr, ty = m + 6 * dpr;
  ctx.fillStyle = Math.floor(performance.now() / 600) % 2 ? "#ff4d3d" : "rgba(255,77,61,0.35)";
  ctx.beginPath(); ctx.arc(tx + 4 * dpr, ty + 6 * dpr, 4 * dpr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(231,236,233,0.9)";
  ctx.fillText(`REC  CAM-1 NADIR  ${b.camera.image_width}x${b.camera.image_height}`, tx + 14 * dpr, ty);
  ctx.textAlign = "right";
  ctx.fillText(`${fmtUtc(b, t)}  ${fmtT(t)}`, cw - m - 8 * dpr, ty);
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffb020";
  ctx.fillText(sim ? "SIMULATION · RECORDED FOOTAGE" : b.mission.mode === "deployment" ? "DEPLOYMENT · LIVE UAV" : "UPLOADED FOOTAGE", tx, ty + 16 * dpr);
  ctx.textBaseline = "bottom";
  if (tel) {
    const narrow = cw / dpr < 560;
    ctx.fillStyle = tel.gps_fix < 2 ? "#ff4d3d" : "rgba(231,236,233,0.9)";
    ctx.fillText(tel.gps_fix < 2 ? "GPS NO FIX · GEOLOCATION PAUSED" :
      `${tel.lat.toFixed(narrow ? 5 : 6)}  ${tel.lon.toFixed(narrow ? 5 : 6)}  ALT ${tel.alt_m.toFixed(1)}m${narrow ? "" : `  HDG ${String(Math.round(tel.heading_deg)).padStart(3, "0")}°`}`,
      tx, ch - m - 6 * dpr);
  }
  ctx.textAlign = "right";
  // 5 m scale bar
  const bar = (5 / gsd) * scale;
  const bx = cw - m - 8 * dpr - bar, by = ch - m - 26 * dpr;
  ctx.strokeStyle = "rgba(231,236,233,0.9)";
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath(); ctx.moveTo(bx, by - 4 * dpr); ctx.lineTo(bx, by); ctx.lineTo(bx + bar, by); ctx.lineTo(bx + bar, by - 4 * dpr); ctx.stroke();
  ctx.fillStyle = "rgba(231,236,233,0.9)";
  ctx.fillText("5 m", bx + bar, by - 5 * dpr);
  ctx.textAlign = "left";
}
