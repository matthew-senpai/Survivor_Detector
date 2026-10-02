"""Generate the bundled sample mission (deterministic, seed 7):

  data/sample/terrain.jpg      synthetic 5 cm/px aerial terrain of a landslide sector (200 m x 150 m)
  data/sample/scene.json       people, decoys, true flight path, teams, zone (simulation ground truth)
  data/sample/telemetry.csv    what the drone *recorded*: true path + GPS/baro/compass error, one GPS dropout
  data/sample/detections.json  what the detector *recorded*: per-frame boxes with misses, jitter, false positives

Run: python backend/scripts/generate_sample.py
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.simulation import person_parts, bbox_points  # noqa: E402
from app.telemetry import TelemetrySample, to_csv  # noqa: E402
from app.geolocation import offset_latlon  # noqa: E402

OUT = ROOT / "data" / "sample"
CAM = json.loads((ROOT / "config" / "pipeline.json").read_text())["camera"]
FPS = 5
MPP = 0.05
WM, HM = 200.0, 150.0
WP, HP = int(WM / MPP), int(HM / MPP)
CENTER = (11.4762, 76.1428)  # illustrative location, Western Ghats (Kerala)
ORIGIN = offset_latlon(*CENTER, -WM / 2, HM / 2)  # top-left corner of the sector
rng = np.random.default_rng(7)

CL = np.array([(-10, 10), (60, 45), (120, 85), (170, 120), (215, 155)], float)  # debris-flow centreline (m)
EXT = np.array([(-560, -300), (-300, -120), *CL, (420, 330), (600, 420)], float)


def along(s, d=0.0, line=CL):
    """Point s metres along a polyline, d metres to its right; plus flow heading (deg)."""
    for i in range(len(line) - 1):
        seg = line[i + 1] - line[i]
        L = float(np.hypot(*seg))
        if s <= L or i == len(line) - 2:
            u = seg / L
            p = line[i] + u * s + np.array([-u[1], u[0]]) * d
            return float(p[0]), float(p[1]), math.degrees(math.atan2(u[0], -u[1])) % 360
        s -= L


def noise(h, w, cell, cell_y=None):
    cy = cell_y or cell
    g = rng.random((h // cy + 3, w // cell + 3)).astype(np.float32)
    big = Image.fromarray(g).resize((g.shape[1] * cell, g.shape[0] * cy), Image.BICUBIC)
    ox, oy = rng.integers(0, cell), rng.integers(0, cy)
    return np.asarray(big)[oy:oy + h, ox:ox + w]


def fbm(h, w, cells, amps):
    out = sum(a * noise(h, w, c) for c, a in zip(cells, amps))
    return (out - out.min()) / (out.max() - out.min())


def poly_dist(px, py, line):
    """Distance (m) from grid points to a polyline."""
    best = np.full(px.shape, 1e9, np.float32)
    for a, b in zip(line[:-1], line[1:]):
        d = b - a
        t = np.clip(((px - a[0]) * d[0] + (py - a[1]) * d[1]) / (d @ d), 0, 1)
        best = np.minimum(best, np.hypot(px - a[0] - t * d[0], py - a[1] - t * d[1]))
    return best


def up(arr):
    return np.asarray(Image.fromarray(arr.astype(np.float32)).resize((WP, HP), Image.BILINEAR))


def P(x, y):
    return x / MPP, y / MPP


def rot_rect(cx, cy, w, h, ang):
    a = math.radians(ang)
    ca, sa = math.cos(a), math.sin(a)
    return [P(cx + dx * ca - dy * sa, cy + dx * sa + dy * ca) for dx, dy in
            ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]


def blob(cx, cy, r, n=10, jitter=0.35):
    return [P(cx + r * (1 + jitter * (rng.random() - 0.5)) * math.cos(2 * math.pi * k / n),
              cy + r * (1 + jitter * (rng.random() - 0.5)) * math.sin(2 * math.pi * k / n)) for k in range(n)]


def jit(c, k=14):
    """Brightness jitter (same offset on every channel, so rocks stay grey instead of turning purple)."""
    dv = int(rng.integers(-k, k + 1))
    return tuple(int(np.clip(v + dv + rng.integers(-2, 3), 0, 255)) for v in c)


# ----------------------------------------------------------------------------- terrain
def make_terrain():
    q = 4  # low-frequency fields at quarter resolution
    gy, gx = np.mgrid[0:HP // q, 0:WP // q].astype(np.float32)
    mx, my = (gx + 0.5) * MPP * q, (gy + 0.5) * MPP * q
    dist = poly_dist(mx, my, CL)
    hw = 30 + 6 * (noise(HP // q, WP // q, 120) - 0.5) + 4 * (noise(HP // q, WP // q, 30) - 0.5)
    stream_line = np.array([along(s, 3 * math.sin(s / 11))[:2] for s in range(0, 270, 3)])
    sdist = poly_dist(mx, my, stream_line)
    dist, hw, sdist = up(dist), up(hw), up(sdist)
    scar = np.clip((hw - dist) / 0.8, 0, 1)[..., None]

    n1 = fbm(HP, WP, [400, 160, 60, 20], [1, .6, .35, .2])[..., None]
    n2 = fbm(HP, WP, [90, 30, 9, 3], [1, .7, .5, .4])[..., None]
    forest_ground = np.array([30, 40, 24]) * (0.7 + 0.6 * n2)
    img = forest_ground

    # mud: ochre, flow-aligned streaks, wetter and darker toward the centreline
    S = int(math.hypot(WP, HP)) + 8
    streak = Image.fromarray(noise(S, S, 140, 7)).rotate(-33, Image.BILINEAR)
    o = ((S - WP) // 2, (S - HP) // 2)
    streak = np.asarray(streak)[o[1]:o[1] + HP, o[0]:o[0] + WP][..., None]
    patches = noise(HP, WP, 220)[..., None]
    light, mid, wet = np.array([168, 136, 98]), np.array([128, 100, 70]), np.array([84, 67, 48])
    mud = mid + (light - mid) * n1 * 1.2
    wetness = np.clip((12 - dist) / 9, 0, 1)[..., None] * 0.65
    mud = mud * (1 - wetness) + wet * wetness
    mud *= 0.86 + 0.2 * streak + 0.14 * (n2 - 0.5) + 0.18 * (patches - 0.5)
    laterite = np.clip(1 - (hw - dist) / 3.5, 0, 1)[..., None] * (0.55 + 0.45 * n1)
    mud = mud * (1 - laterite) + np.array([152, 84, 52]) * (0.8 + 0.3 * n2) * laterite

    water = np.clip((1.1 - sdist) / 0.5, 0, 1)[..., None] * scar
    mud = mud * (1 - water) + np.array([92, 86, 70]) * (0.85 + 0.3 * streak) * water

    base = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(base)
    # village road (destroyed where the slide crossed it)
    road = [P(x, 132 + 7 * math.sin(x / 35)) for x in np.arange(-10, 212, 2)]
    d.line(road, fill=(92, 90, 86), width=int(5.2 / MPP))
    d.line(road, fill=(104, 101, 96), width=int(4.4 / MPP))

    canopy = Image.new("RGBA", (WP, HP), (0, 0, 0, 0))
    cd = ImageDraw.Draw(canopy)
    dist_s = dist[::20, ::20]
    hw_s = hw[::20, ::20]
    greens = [(38, 70, 32), (52, 86, 38), (70, 98, 42), (44, 78, 50), (82, 104, 48), (34, 60, 30)]
    trees = []
    for ty in np.arange(-2, HM + 3, 3.6):
        for tx in np.arange(-2, WM + 3, 3.6):
            x, y = tx + rng.uniform(-1.6, 1.6), ty + rng.uniform(-1.6, 1.6)
            ix, iy = int(np.clip(x / MPP / 20, 0, dist_s.shape[1] - 1)), int(np.clip(y / MPP / 20, 0, dist_s.shape[0] - 1))
            if dist_s[iy, ix] < hw_s[iy, ix] + 1.5 or abs(y - (132 + 7 * math.sin(x / 35))) < 4.5:
                continue
            trees.append((x, y, rng.uniform(1.8, 3.4), greens[rng.integers(len(greens))]))
    trees.sort(key=lambda t: t[2])
    for x, y, r, c in trees:
        cd.polygon(blob(x + 0.7, y + 0.8, r * 1.05, 12, 0.4), fill=(8, 14, 6, 150))
        for _ in range(int(rng.integers(4, 7))):  # crown = cluster of leaf clumps, lit from the north-west
            bx, by, br = x + rng.normal(0, r * 0.3), y + rng.normal(0, r * 0.3), r * rng.uniform(0.45, 0.7)
            k = rng.uniform(0.85, 1.1)
            cd.polygon(blob(bx, by, br, 10, 0.45), fill=tuple(int(v * k) for v in c) + (255,))
            cd.polygon(blob(bx - br * 0.2, by - br * 0.22, br * 0.6, 8, 0.4), fill=tuple(min(255, int(v * k * 1.25)) for v in c) + (255,))
            cd.polygon(blob(bx - br * 0.3, by - br * 0.35, br * 0.25, 6, 0.4), fill=tuple(min(255, int(v * k * 1.5)) for v in c) + (210,))
    base = base.convert("RGBA")
    base.alpha_composite(canopy)
    arr = np.asarray(base.convert("RGB")).astype(np.float32)
    arr *= 0.78 + 0.44 * noise(HP, WP, 5)[..., None]  # leaf texture
    arr = arr * (1 - scar) + mud * scar
    terrain = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    shadow = Image.new("L", (WP, HP), 0)
    sd = ImageDraw.Draw(shadow)
    d = ImageDraw.Draw(terrain)

    def in_scar(x, y, margin=0.0):
        ix, iy = int(np.clip(x / MPP, 0, WP - 1)), int(np.clip(y / MPP, 0, HP - 1))
        return dist[iy, ix] < hw[iy, ix] - margin

    # road fragments carried by the flow
    for _ in range(14):
        x = rng.uniform(140, 200)
        y = 132 + 7 * math.sin(x / 35) + rng.uniform(-6, 10)
        if in_scar(x, y):
            pts = rot_rect(x, y, rng.uniform(0.8, 2.6), rng.uniform(0.6, 1.8), rng.uniform(0, 180))
            sd.polygon([(a + 6, b + 5) for a, b in pts], fill=120)
            d.polygon(pts, fill=jit((100, 98, 92), 8))

    # standing water / wet patches
    for _ in range(40):
        x, y, _ = along(rng.uniform(0, 270), rng.normal(0, 9))
        if in_scar(x, y, 2):
            r = rng.uniform(0.6, 2.2)
            d.polygon(blob(x, y, r, 14, 0.6), fill=jit((76, 66, 52), 6))
            d.polygon(blob(x - r * 0.25, y - r * 0.2, r * 0.45, 10, 0.6), fill=jit((104, 104, 98), 6))

    # gravel
    for _ in range(9000):
        x, y = rng.uniform(0, WM), rng.uniform(0, HM)
        if in_scar(x, y):
            r = rng.uniform(0.04, 0.16)
            d.ellipse([*P(x - r, y - r), *P(x + r, y + r)], fill=jit((118, 110, 98), 24))

    # houses (Kerala village: tin sheet, concrete with water tank, Mangalore tile)
    houses = [(45, 17, "tile"), (95, -18, "tin"), (165, 18, "concrete"), (232, -20, "tin")]
    for s, off, kind in houses:
        x, y, fh = along(s, off)
        ang = fh - 90 + rng.uniform(-25, 25)
        w, h = 8.5, 6.5
        sd.polygon([(a + 30, b + 24) for a, b in rot_rect(x, y, w, h, ang)], fill=170)
        if kind == "tile":
            d.polygon(rot_rect(x, y, w, h, ang), fill=(150, 72, 48))
            d.polygon(rot_rect(x, y - 0.0, w, h / 2, ang), fill=(172, 86, 56))
            for k in np.arange(-w / 2 + 0.3, w / 2, 0.35):
                a = math.radians(ang)
                p1 = P(x + k * math.cos(a) - (-h / 2) * math.sin(a), y + k * math.sin(a) + (-h / 2) * math.cos(a))
                p2 = P(x + k * math.cos(a) - (h / 2) * math.sin(a), y + k * math.sin(a) + (h / 2) * math.cos(a))
                d.line([p1, p2], fill=(120, 58, 40), width=2)
        elif kind == "tin":
            d.polygon(rot_rect(x, y, w, h, ang), fill=(118, 126, 132))
            a = math.radians(ang)
            for k in np.arange(-h / 2 + 0.15, h / 2, 0.22):
                p1 = P(x - (w / 2) * math.cos(a) - k * math.sin(a), y - (w / 2) * math.sin(a) + k * math.cos(a))
                p2 = P(x + (w / 2) * math.cos(a) - k * math.sin(a), y + (w / 2) * math.sin(a) + k * math.cos(a))
                d.line([p1, p2], fill=(96, 104, 110), width=2)
            for _ in range(5):
                d.polygon(blob(x + rng.uniform(-3, 3), y + rng.uniform(-2, 2), rng.uniform(0.4, 1.0)), fill=(136, 82, 50))
        else:
            d.polygon(rot_rect(x, y, w, h, ang), fill=(168, 166, 158))
            d.polygon(rot_rect(x, y, w - 0.5, h - 0.5, ang), fill=(150, 148, 140))
            tx, ty = x + 2, y - 1.2
            sd.ellipse([*P(tx - 0.4, ty - 0.3), *P(tx + 1.4, ty + 1.3)], fill=200)
            d.ellipse([*P(tx - 0.55, ty - 0.55), *P(tx + 0.55, ty + 0.55)], fill=(28, 30, 34))
            for _ in range(6):
                d.polygon(blob(x + rng.uniform(-3, 3), y + rng.uniform(-2, 2), rng.uniform(0.3, 0.9)), fill=(112, 112, 104))
        for _ in range(4):  # mud flowed over part of the roof
            d.polygon(blob(x + rng.uniform(-4, 4), y + rng.uniform(-3, 3), rng.uniform(1.2, 2.6), 12, 0.5),
                      fill=jit((126, 98, 68), 10))
        for _ in range(26):  # scattered debris
            px_, py_ = x + rng.normal(0, 6), y + rng.normal(0, 5)
            col = [(150, 72, 48), (118, 126, 132), (170, 140, 100), (90, 70, 50), (200, 200, 190)][rng.integers(5)]
            d.polygon(rot_rect(px_, py_, rng.uniform(0.3, 1.6), rng.uniform(0.1, 0.5), rng.uniform(0, 180)), fill=jit(col, 10))

    # uprooted trees and logs
    for _ in range(46):
        s, off = rng.uniform(0, 270), rng.uniform(-26, 26)
        x, y, fh = along(s, off)
        if not in_scar(x, y, 1):
            continue
        L, wd = rng.uniform(4, 13), rng.uniform(0.25, 0.6)
        ang = math.radians(fh - 90 + rng.normal(0, 35))
        x2, y2 = x + L * math.cos(ang), y + L * math.sin(ang)
        sd.line([(a + 8, b + 6) for a, b in (P(x, y), P(x2, y2))], fill=150, width=int(wd / MPP))
        d.line([P(x, y), P(x2, y2)], fill=jit((112, 94, 72), 10), width=int(wd / MPP))
        d.line([P(x, y), P(x2, y2)], fill=jit((140, 120, 94), 8), width=max(1, int(wd / MPP / 3)))
        for _ in range(rng.integers(2, 5)):
            k = rng.uniform(0.3, 0.95)
            bx, by = x + (x2 - x) * k, y + (y2 - y) * k
            ba = ang + rng.choice([-1, 1]) * rng.uniform(0.5, 1.1)
            bl = rng.uniform(0.8, 2.4)
            d.line([P(bx, by), P(bx + bl * math.cos(ba), by + bl * math.sin(ba))], fill=(100, 84, 64), width=3)
        if rng.random() < 0.45:  # root plate
            d.polygon(blob(x, y, rng.uniform(0.8, 1.4), 12, 0.5), fill=jit((74, 58, 42), 8))
        if rng.random() < 0.35:  # wilted crown still attached
            for _ in range(5):
                d.polygon(blob(x2 + rng.normal(0, 1.2), y2 + rng.normal(0, 1.2), rng.uniform(0.6, 1.4)), fill=jit((72, 84, 40), 12))

    # boulders
    for _ in range(170):
        s, off = rng.uniform(0, 270), rng.normal(0, 13)
        x, y, _ = along(s, off)
        if not in_scar(x, y, 0.5):
            continue
        r = float(np.clip(rng.exponential(0.6) + 0.25, 0.25, 2.4))
        c = jit((132, 126, 116), 16)
        sd.polygon([(a + r * 9, b + r * 7) for a, b in blob(x, y, r)], fill=200)
        d.polygon(blob(x, y, r, 9, 0.45), fill=c)
        d.polygon(blob(x - r * 0.2, y - r * 0.22, r * 0.62, 8, 0.4), fill=tuple(min(255, int(v * 1.18)) for v in c))
        d.polygon(blob(x - r * 0.3, y - r * 0.35, r * 0.25, 6, 0.3), fill=tuple(min(255, int(v * 1.32)) for v in c))

    # decoys: person-sized clutter the detector may fire on
    decoys = []
    for s, off, kind in ((118, 12, "blue tarp"), (190, -2, "clothing pile"), (70, -20, "white sack")):
        x, y, fh = along(s, off)
        if kind == "blue tarp":
            pts = blob(x, y, 1.3, 9, 0.6)
            d.polygon(pts, fill=(46, 92, 170))
            d.line(pts[:5], fill=(70, 122, 200), width=4)
            size = (2.6, 2.4)
        elif kind == "clothing pile":
            d.polygon(blob(x, y, 0.5, 9, 0.5), fill=(178, 40, 44))
            d.polygon(blob(x + 0.2, y + 0.1, 0.3, 7, 0.5), fill=(50, 60, 120))
            size = (1.0, 1.0)
        else:
            d.polygon(rot_rect(x, y, 0.55, 0.85, fh), fill=(222, 218, 205))
            size = (0.6, 0.9)
        decoys.append({"x": round(x, 2), "y": round(y, 2), "w": size[0], "h": size[1], "label": kind})

    shadow = shadow.filter(ImageFilter.GaussianBlur(5))
    arr = np.asarray(terrain).astype(np.float32) * (1 - 0.5 * np.asarray(shadow, np.float32)[..., None] / 255)

    # relief: broad hillshade + micro relief, lit from the north-west
    h = up(fbm(HP // q, WP // q, [200, 60, 15], [1, .4, .15]) * 180) + noise(HP, WP, 12) * 6 + noise(HP, WP, 4) * 2.5
    gy_, gx_ = np.gradient(h.astype(np.float32))
    shade = np.clip(1 + 0.11 * (-gx_ - gy_), 0.6, 1.35)[..., None]
    arr *= shade
    arr *= 1 + 0.07 * (rng.random((HP, WP, 1), dtype=np.float32) - 0.5)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    img.save(OUT / "terrain.jpg", quality=80, optimize=True)
    return decoys


# ----------------------------------------------------------------------------- people
PEOPLE = [  # (arc length s, offset d, pose, shirt, motion, det_prob, base_conf, note)
    (60, -6, "lying", "#d23b2c", {"type": "wave", "rate": 1.1}, 0.92, 0.9, "Lying beside collapsed house, waving"),
    (85, 8, "standing", "#e6c229", {"type": "wave", "rate": 0.9}, 0.95, 0.93, "Standing on debris, waving both arms"),
    (100, -10, "buried", "#2f6fd0", {}, 0.72, 0.6, "Partially buried near house"),
    (128, 4, "lying", "#e2702a", {}, 0.9, 0.87, "Lying motionless on debris"),
    (140, -14, "lying", "#3fae5f", {"type": "crawl", "amp": 2.5, "period": 30}, 0.88, 0.84, "Crawling slowly"),
    (172, 6, "sitting", "#ecebe6", {"type": "wave", "rate": 1.0}, 0.93, 0.91, "Sitting, waving (family group)"),
    (176, 10.5, "lying", "#d0508a", {}, 0.88, 0.84, "Lying, no movement (family group)"),
    (169.5, 12, "standing", "#7a52d1", {}, 0.95, 0.92, "Standing still (family group)"),
    (205, -8, "buried", "#c9a227", {}, 0.55, 0.48, "Deeply buried, head and one arm visible"),
    (115, -27, "occluded", "#d84b3a", {}, 0.62, 0.55, "Under fallen branches at slide edge"),
    (225, 3, "lying", "#7fb8e6", {}, 0.88, 0.78, "Lying near stream, no movement"),
    (45, 14, "sitting", "#1fb5ad", {"type": "wave", "rate": 1.2}, 0.93, 0.9, "Sitting on roof, waving"),
]


def make_people():
    people = []
    for i, (s, off, pose, shirt, motion, pdet, conf, note) in enumerate(PEOPLE, 1):
        x, y, fh = along(s, off)
        p = {"id": f"P{i:02d}", "x": round(x, 2), "y": round(y, 2), "heading": round(float(rng.uniform(0, 360)), 1),
             "pose": pose, "shirt": shirt, "pants": ["#2b2f3a", "#3a3328", "#1f2a44"][i % 3], "motion": motion,
             "det_prob": pdet, "base_conf": conf, "note": note}
        if note.startswith("Deeply"):
            p["deep"] = True
        if motion.get("type") == "crawl":
            p["heading"] = round((fh + 90) % 360, 1)
        if i == 1:  # near-axis pose: a waving arm on a diagonal body stays inside its own bbox (see analysis._movement)
            p["heading"] = 0.0
        people.append(p)
    return people


# ----------------------------------------------------------------------------- flight
def make_flight():
    lanes = [135, 105, 75, 45, 15]
    pts = [np.array([-25.0, 160.0])]
    x_lo, x_hi, R = -5.0, 205.0, 15.0
    for k, y in enumerate(lanes):
        xa, xb = (x_lo, x_hi) if k % 2 == 0 else (x_hi, x_lo)
        pts += [np.array([xa, y]), np.array([xb, y])]
        if k < len(lanes) - 1:
            sgn = 1 if xb == x_hi else -1
            cx, cy = xb, y - R
            for a in np.linspace(math.pi / 2, -math.pi / 2, 24)[1:-1]:
                pts.append(np.array([cx + sgn * R * math.cos(a), cy + R * math.sin(a)]))
    dense = [pts[0]]
    for a, b in zip(pts[:-1], pts[1:]):
        n = max(1, int(np.hypot(*(b - a)) / 0.25))
        dense += [a + (b - a) * k / n for k in range(1, n + 1)]
    dense = np.array(dense)
    seg = np.hypot(*np.diff(dense, axis=0).T)
    cum = np.concatenate([[0], np.cumsum(seg)])
    speed = 5.0
    ts = np.arange(0, cum[-1] / speed, 1 / FPS)
    xs = np.interp(ts * speed, cum, dense[:, 0])
    ys = np.interp(ts * speed, cum, dense[:, 1])
    hd = np.degrees(np.arctan2(np.gradient(xs), -np.gradient(ys))) % 360
    alt = 30 + 0.3 * np.sin(ts / 7)
    return np.stack([ts, xs, ys, alt, hd], 1)


def make_telemetry(truth):
    samples, bias = [], np.zeros(2)
    sats, battery = 16, 97.0
    for t, x, y, alt, hd in truth:
        bias = bias * 0.995 + rng.normal(0, 0.05, 2)
        e, n = x + bias[0] + rng.normal(0, 0.25), -y + bias[1] + rng.normal(0, 0.25)
        lat, lon = offset_latlon(*ORIGIN, e, n)
        sats = int(np.clip(sats + rng.choice([-1, 0, 0, 0, 0, 1]), 13, 19))
        dropout = 106 < t < 110  # simulated GPS loss during a turn, outside the search area
        samples.append(TelemetrySample(
            t=round(float(t), 2), lat=lat, lon=lon, alt_m=float(alt + 0.5 + rng.normal(0, 0.15)),
            heading_deg=float((hd + 0.8 + rng.normal(0, 0.4)) % 360), speed_mps=5.0 + float(rng.normal(0, 0.1)),
            gimbal_pitch_deg=-90.0, gps_fix=1 if dropout else 3, sats=4 if dropout else sats,
            hdop=9.9 if dropout else round(0.8 + 0.08 * (19 - sats) + float(rng.normal(0, 0.03)), 2),
            battery_pct=round(battery - t * 0.055, 1)))
    return samples


def project(pts, pose):
    _, X, Y, alt, hd = pose
    W, H = CAM["image_width"], CAM["image_height"]
    gsd = 2 * alt * math.tan(math.radians(CAM["hfov_deg"]) / 2) / W
    h = math.radians(hd)
    fx, fy, rx, ry = math.sin(h), -math.cos(h), math.cos(h), math.sin(h)
    out = []
    for px, py in pts:
        dx, dy = px - X, py - Y
        out.append((W / 2 + (dx * rx + dy * ry) / gsd, H / 2 - (dx * fx + dy * fy) / gsd))
    return out


def make_detections(truth, people, decoys):
    W, H = CAM["image_width"], CAM["image_height"]
    frames = []
    for i, pose in enumerate(truth):
        t, dets = pose[0], []
        for p in people:
            uv = project(bbox_points(person_parts(p, t)), pose)
            us, vs = [a for a, _ in uv], [b for _, b in uv]
            x1, y1, x2, y2 = min(us), min(vs), max(us), max(vs)
            if x2 < 0 or y2 < 0 or x1 > W or y1 > H:
                continue
            cx1, cy1, cx2, cy2 = max(0, x1), max(0, y1), min(W, x2), min(H, y2)
            frac = (cx2 - cx1) * (cy2 - cy1) / ((x2 - x1) * (y2 - y1))
            if frac < 0.6 or rng.random() > p["det_prob"] * (1 if frac > 0.99 else 0.75):
                continue
            j = rng.normal(0, 0.8, 4)
            conf = float(np.clip(p["base_conf"] + rng.normal(0, 0.035) - (0 if frac > 0.99 else 0.06), 0.05, 0.99))
            dets.append({"bbox": [round(float(v), 1) for v in (cx1 + j[0], cy1 + j[1], cx2 + j[2], cy2 + j[3])],
                         "conf": round(conf, 3)})
        for dc in decoys:
            u, v = project([(dc["x"], dc["y"])], pose)[0]
            if 20 < u < W - 20 and 20 < v < H - 20 and rng.random() < 0.4:
                gsd = 2 * pose[3] * math.tan(math.radians(CAM["hfov_deg"]) / 2) / W
                hw, hh = dc["w"] / gsd / 2, dc["h"] / gsd / 2
                dets.append({"bbox": [round(u - hw, 1), round(v - hh, 1), round(u + hw, 1), round(v + hh, 1)],
                             "conf": round(float(rng.uniform(0.3, 0.47)), 3)})
        if rng.random() < 0.015:  # random clutter, single frame
            u, v, s = rng.uniform(40, W - 40), rng.uniform(40, H - 40), rng.uniform(15, 40)
            dets.append({"bbox": [round(u, 1), round(v, 1), round(u + s, 1), round(v + s * 1.6, 1)],
                         "conf": round(float(rng.uniform(0.15, 0.28)), 3)})
        if dets:
            frames.append({"i": i, "t": round(float(t), 2), "dets": dets})
    return {"fps": FPS, "total_frames": len(truth), "image_size": [W, H], "frames": frames}


def make_map_context():
    """Affected zone polygon, sector grid and rescue teams (illustrative)."""
    def ll(x, y):
        return [round(v, 7) for v in offset_latlon(*ORIGIN, x, -y)]
    left, right = [], []
    total = sum(float(np.hypot(*(b - a))) for a, b in zip(EXT[:-1], EXT[1:]))
    for s in np.linspace(0, total, 60):
        k = s / total
        w = 45 + 70 * math.sin(math.pi * min(1, k * 1.3)) + 8 * math.sin(s / 37)
        x, y, _ = along(s, w, EXT)
        right.append(ll(x, y))
        x, y, _ = along(s, -w, EXT)
        left.append(ll(x, y))
    zone = right + left[::-1]
    sectors = []
    for r in range(-1, 3):
        for c in range(-2, 4):
            x0, y0 = c * 200, r * 150
            cx, cy = x0 + 100, y0 + 75
            if poly_dist(np.array([cx], float), np.array([cy], float), EXT)[0] > 170:
                continue
            status = "active" if (r, c) == (0, 0) else "searched" if (c < 0 or (c == 0 and r < 0)) else "queued"
            sectors.append({"name": f"{chr(ord('B') + r)}-{3 + c}", "status": status,
                            "bounds": [ll(x0, y0 + 150), ll(x0 + 200, y0)]})
    teams = [
        {"id": "RT-A", "name": "Rescue Team Alpha", "members": 8, "status": "Staging", "pos": ll(-30, 168)},
        {"id": "RT-B", "name": "Rescue Team Bravo", "members": 6, "status": "En route", "pos": ll(236, 30)},
        {"id": "K9-1", "name": "K9 Search Unit", "members": 3, "status": "Standby", "pos": ll(-48, 70)},
        {"id": "MED-1", "name": "Field Medical Post", "members": 5, "status": "Ready", "pos": ll(-60, 190)},
    ]
    return zone, sectors, teams


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("terrain ...")
    decoys = make_terrain()
    people = make_people()
    truth = make_flight()
    print(f"flight: {len(truth)} frames, {truth[-1, 0]:.0f} s")
    (OUT / "telemetry.csv").write_text(to_csv(make_telemetry(truth)))
    det = make_detections(truth, people, decoys)
    (OUT / "detections.json").write_text(json.dumps(det, separators=(",", ":")))
    print(f"detections: {sum(len(f['dets']) for f in det['frames'])} in {len(det['frames'])} frames")
    zone, sectors, teams = make_map_context()
    scene = {
        "mission_name": "Landslide SAR · Sector B-3", "sector": "B-3",
        "area": "Western Ghats, Kerala (illustrative sample location)",
        "start_time": "2026-10-02T00:40:00Z", "origin": [round(v, 8) for v in ORIGIN], "m_per_px": MPP,
        "width_px": WP, "height_px": HP, "persons": people, "decoys": decoys,
        "truth": {"cols": ["t", "x", "y", "alt", "heading"], "rows": [[round(float(v), 3) for v in r] for r in truth]},
        "zone": zone, "sectors": sectors, "teams": teams,
    }
    (OUT / "scene.json").write_text(json.dumps(scene, separators=(",", ":")))
    print("done ->", OUT)


if __name__ == "__main__":
    main()
