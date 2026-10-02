// Mirror of backend/app/simulation.py:person_parts. Renders simulated people into the synthetic camera feed.
// Keep the geometry identical to the Python version, or boxes in the recorded detections won't line up.
import type { Person } from "./types";

type Pt = [number, number];
export type Part =
  | { k: "poly"; pts: Pt[]; c: string; a: number }
  | { k: "line"; p1: Pt; p2: Pt; w: number; c: string; a: number }
  | { k: "circle"; p: Pt; r: number; c: string; a: number };

const SKIN = "#b07a55", HAIR = "#1d1611", MUD = "#6e5236", LEAF = "#2f4a22";
const TAU = Math.PI * 2;

const ellipse = (cf: number, cr: number, sf: number, sr: number, n = 14): Pt[] =>
  Array.from({ length: n }, (_, k) => [cf + sf * Math.cos((TAU * k) / n), cr + sr * Math.sin((TAU * k) / n)]);

export function personParts(p: Person, t: number): Part[] {
  const a = (p.heading * Math.PI) / 180;
  const f: Pt = [Math.sin(a), -Math.cos(a)], r: Pt = [Math.cos(a), Math.sin(a)];
  let x0 = p.x, y0 = p.y;
  const m = p.motion ?? {};
  const wave = m.type === "wave" ? Math.sin(TAU * (m.rate ?? 1) * t) : null;
  if (m.type === "crawl") {
    const off = m.amp! * Math.sin((TAU * t) / m.period!);
    x0 += f[0] * off;
    y0 += f[1] * off;
  }
  const W = (lf: number, lr: number): Pt => [x0 + lf * f[0] + lr * r[0], y0 + lf * f[1] + lr * r[1]];
  const poly = (pts: Pt[], c: string, al = 1): Part => ({ k: "poly", pts: pts.map(([u, v]) => W(u, v)), c, a: al });
  const line = (p1: Pt, p2: Pt, w: number, c: string): Part => ({ k: "line", p1: W(...p1), p2: W(...p2), w, c, a: 1 });
  const circ = (q: Pt, rad: number, c: string): Part => ({ k: "circle", p: W(...q), r: rad, c, a: 1 });
  const { shirt, pants = "#2b2f3a", pose } = p;
  const parts: Part[] = pose === "lying" || pose === "occluded" ? [poly(ellipse(-0.25, 0.12, 0.85, 0.42), "#000000", 0.28)] : [];

  if (pose === "lying" || pose === "occluded") {
    parts.push(line([-0.28, -0.1], [-1.1, -0.16], 0.15, pants), line([-0.28, 0.1], [-1.1, 0.16], 0.15, pants),
      poly(ellipse(0, 0, 0.32, 0.2), shirt), line([0.2, -0.2], [-0.3, -0.3], 0.1, shirt));
    let end: Pt;
    if (wave !== null) {
      const phi = 0.5 + 1.1 * wave;
      end = [0.2 + 0.62 * Math.cos(phi), 0.2 + 0.62 * Math.sin(phi)];
    } else if (m.type === "crawl") {
      end = [0.2 + 0.55 * (0.7 + 0.3 * Math.sin(t * 2)), 0.32];
    } else end = [-0.3, 0.3];
    parts.push(line([0.2, 0.2], end, 0.1, shirt), circ(end, 0.05, SKIN), circ([0.47, 0], 0.11, SKIN), circ([0.5, 0], 0.085, HAIR));
    if (pose === "occluded") {
      parts.push({ k: "circle", p: W(-0.6, 0.1), r: 0.5, c: LEAF, a: 0.92 }, { k: "circle", p: W(-0.1, -0.35), r: 0.38, c: "#3c5a2a", a: 0.9 },
        { k: "line", p1: W(-1.4, 0.6), p2: W(0.4, -0.6), w: 0.12, c: "#5a4a38", a: 1 });
    }
  } else if (pose === "sitting") {
    parts.push(poly(ellipse(0.25, 0.3, 0.7, 0.4), "#000000", 0.28),
      line([0, -0.1], [0.7, -0.13], 0.15, pants), line([0, 0.1], [0.7, 0.13], 0.15, pants), poly(ellipse(-0.05, 0, 0.16, 0.22), shirt));
    for (const s of [-1, 1]) {
      const end: Pt = wave !== null ? [0.05 + 0.1 * wave, s * (0.22 + 0.25 + 0.4 * Math.abs(wave))] : [0.3, s * 0.18];
      parts.push(line([0, s * 0.2], end, 0.1, shirt), circ(end, 0.05, SKIN));
    }
    parts.push(circ([-0.02, 0], 0.11, HAIR));
  } else if (pose === "standing") {
    const sx = x0 + 0.62 * 0.8, sy = y0 + 0.5 * 0.8, ang = Math.atan2(0.5, 0.62);
    const shadow: Pt[] = Array.from({ length: 14 }, (_, i) => {
      const k = (TAU * i) / 14;
      return [sx + 0.85 * Math.cos(ang) * Math.cos(k) - 0.2 * Math.sin(ang) * Math.sin(k),
        sy + 0.85 * Math.sin(ang) * Math.cos(k) + 0.2 * Math.cos(ang) * Math.sin(k)];
    });
    parts.push({ k: "poly", pts: shadow, c: "#000000", a: 0.38 }, poly(ellipse(0, 0, 0.13, 0.23), shirt));
    for (const s of [-1, 1]) {
      const L = wave !== null ? 0.15 + 0.45 * Math.abs(wave) : 0.05;
      const end: Pt = [0.05, s * (0.22 + L)];
      parts.push(line([0, s * 0.2], end, 0.09, shirt), circ(end, 0.045, SKIN));
    }
    parts.push(circ([0, 0], 0.1, HAIR));
  } else if (pose === "buried") {
    if (!p.deep) parts.push(poly(ellipse(0.05, 0, 0.22, 0.2), shirt));
    const end: Pt = wave !== null
      ? [0.2 + 0.4 * Math.cos(0.9 + 0.5 * wave), 0.2 + 0.4 * Math.sin(0.9 + 0.5 * wave)] : [0.55, 0.45];
    parts.push(line([0.2, 0.2], end, 0.1, shirt), circ(end, 0.05, SKIN), circ([0.4, 0], 0.11, SKIN), circ([0.43, 0], 0.085, HAIR),
      poly(ellipse(p.deep ? 0 : -0.25, 0, 0.36, 0.4), MUD));
  }
  return parts;
}

/** Draw parts in world metres; ctx must already map metres -> pixels (scale by 1/m_per_px). */
export function drawParts(ctx: CanvasRenderingContext2D, parts: Part[]) {
  ctx.lineCap = "round";
  for (const pt of parts) {
    ctx.globalAlpha = pt.a;
    ctx.fillStyle = ctx.strokeStyle = pt.c;
    ctx.beginPath();
    if (pt.k === "poly") {
      pt.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    } else if (pt.k === "line") {
      ctx.lineWidth = pt.w;
      ctx.moveTo(...pt.p1);
      ctx.lineTo(...pt.p2);
      ctx.stroke();
    } else {
      ctx.arc(pt.p[0], pt.p[1], pt.r, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
