"""Survivor analysis: movement, persistence, location confidence, and deduplication of tracks into survivors."""
import math
import statistics

from .tracking import Track, Observation
from . import priority


def _movement(track: Track, cfg: dict) -> dict:
    obs = track.obs
    duration = obs[-1].t - obs[0].t
    out = {"bbox_cv": 0.0, "speed_mps": 0.0}
    if len(obs) < 5 or duration < cfg["min_duration_s"]:
        return out
    # Limb motion (waving): bounding-box ground area fluctuates. Known blind spot: an arm waving inside
    # the box of a diagonally-lying body barely changes the box. Deployment adds motion-compensated
    # frame differencing inside the box (pixels, not boxes) to close that gap.
    areas = [((o.bbox[2] - o.bbox[0]) * (o.bbox[3] - o.bbox[1])) * o.gsd ** 2 for o in obs]
    out["bbox_cv"] = statistics.pstdev(areas) / statistics.mean(areas)
    # Position change (crawling): least-squares velocity of the geolocated track.
    ts = [o.t for o in obs]
    tm = statistics.mean(ts)
    var_t = sum((t - tm) ** 2 for t in ts)
    slope = lambda xs: sum((t - tm) * (x - statistics.mean(xs)) for t, x in zip(ts, xs)) / var_t
    out["speed_mps"] = math.hypot(slope([o.e for o in obs]), slope([o.n for o in obs]))
    return out


def _centroid(obs: list[Observation]):
    w = sum(o.conf for o in obs)
    return (sum(o.e * o.conf for o in obs) / w, sum(o.n * o.conf for o in obs) / w,
            sum(o.lat * o.conf for o in obs) / w, sum(o.lon * o.conf for o in obs) / w)


def deduplicate(tracks: list[Track], merge_radius_m: float) -> list[list[Track]]:
    """Merge tracks that are the same person seen on different passes. Two tracks seen in the
    same frame are by definition different people and are never merged."""
    parent = list(range(len(tracks)))
    find = lambda i: i if parent[i] == i else find(parent[i])
    cents = [_centroid(t.obs)[:2] for t in tracks]
    frames = [{o.frame for o in t.obs} for t in tracks]
    pairs = sorted(
        (math.dist(cents[i], cents[j]), i, j)
        for i in range(len(tracks)) for j in range(i + 1, len(tracks))
        if math.dist(cents[i], cents[j]) <= merge_radius_m
    )
    for _, i, j in pairs:
        ri, rj = find(i), find(j)
        if ri == rj:
            continue
        gi = set().union(*(frames[k] for k in range(len(tracks)) if find(k) == ri))
        gj = set().union(*(frames[k] for k in range(len(tracks)) if find(k) == rj))
        if not gi & gj:
            parent[rj] = ri
    groups: dict[int, list[Track]] = {}
    for i, t in enumerate(tracks):
        groups.setdefault(find(i), []).append(t)
    return list(groups.values())


def build_survivors(tracks: list[Track], cfg: dict) -> list[dict]:
    survivors = []
    for group in deduplicate(tracks, cfg["dedup"]["merge_radius_m"]):
        obs = sorted((o for t in group for o in t.obs), key=lambda o: o.frame)
        e, n, lat, lon = _centroid(obs)
        spread = math.sqrt(statistics.mean((o.e - e) ** 2 + (o.n - n) ** 2 for o in obs))
        loc = cfg["location"]
        hdop = statistics.mean(o.hdop for o in obs)
        alt = statistics.mean(o.alt for o in obs)
        sigma = math.sqrt((loc["uere_m"] * hdop) ** 2 + spread ** 2 + (loc["alt_error_frac"] * alt) ** 2)
        loc_conf = "High" if sigma <= loc["high_max_m"] else "Medium" if sigma <= loc["medium_max_m"] else "Low"

        top = sorted((o.conf for o in obs), reverse=True)[:5]
        confidence = sum(top) / len(top)
        persistence = sum(t.obs[-1].t - t.obs[0].t for t in group)
        mv = [_movement(t, cfg["movement"]) for t in group]
        cv, speed = max(m["bbox_cv"] for m in mv), max(m["speed_mps"] for m in mv)
        kind = ("limb motion" if cv >= cfg["movement"]["bbox_area_cv"]
                else "position change" if speed >= cfg["movement"]["speed_mps"] else None)
        best = max(obs, key=lambda o: o.conf)

        survivors.append({
            "track_ids": sorted(t.id for t in group),
            "lat": round(lat, 7), "lon": round(lon, 7), "e": round(e, 2), "n": round(n, 2),
            "uncertainty_m": round(sigma, 2), "location_confidence": loc_conf,
            "confidence": round(confidence, 3), "max_confidence": round(max(o.conf for o in obs), 3),
            "observations": len(obs), "passes": len(group), "persistence_s": round(persistence, 1),
            "first_seen_t": obs[0].t, "last_seen_t": obs[-1].t,
            "confirmed_t": min(t.confirmed_t for t in group),
            "movement": {"detected": kind is not None, "kind": kind,
                         "bbox_cv": round(cv, 3), "speed_mps": round(speed, 3)},
            "priority": priority.assess(confidence, persistence, kind is not None, loc_conf, cfg["priority"]),
            "best": {"frame": best.frame, "t": best.t, "bbox": [round(x, 1) for x in best.bbox],
                     "conf": round(best.conf, 3), "alt_m": round(best.alt, 1), "gsd_cm": round(best.gsd * 100, 2)},
            "status": "new",
        })
    survivors.sort(key=lambda s: s["confirmed_t"])
    for i, s in enumerate(survivors, 1):
        s["id"] = f"S-{i:03d}"
    return survivors
