"""Transparent rescue priority: a points table, never a black box. Every point is shown to the operator."""


def _tier(value, table):
    for threshold, pts in table:
        if value >= threshold:
            return pts
    return 0


def assess(confidence: float, persistence_s: float, movement: bool, location_conf: str, cfg: dict) -> dict:
    conf_max = max(p for _, p in cfg["confidence_points"])
    pers_max = max(p for _, p in cfg["persistence_points"])
    loc_max = max(cfg["location_points"].values())
    breakdown = [
        {"factor": "Detection confidence", "value": f"{confidence * 100:.0f}%",
         "points": _tier(confidence, cfg["confidence_points"]), "max": conf_max},
        {"factor": "Persistent tracking", "value": f"{persistence_s:.1f} s tracked",
         "points": _tier(persistence_s, cfg["persistence_points"]), "max": pers_max},
        {"factor": "Movement / signs of life", "value": "Detected" if movement else "Not observed",
         "points": cfg["movement_points"] if movement else 0, "max": cfg["movement_points"]},
        {"factor": "Location confidence", "value": location_conf,
         "points": cfg["location_points"].get(location_conf, 0), "max": loc_max},
    ]
    score = sum(b["points"] for b in breakdown)
    level = "HIGH" if score >= cfg["high_min"] else "MEDIUM" if score >= cfg["medium_min"] else "LOW"

    reasons = []
    if movement:
        reasons.append("Movement observed: likely conscious survivor able to signal")
    if confidence >= 0.85:
        reasons.append("Strong, consistent person detection")
    elif confidence < 0.45:
        reasons.append("Weak detection: may be debris or clothing; needs visual verification")
    if persistence_s < 1.0:
        reasons.append("Seen only briefly: re-survey recommended")
    if not movement and confidence >= 0.65:
        reasons.append("No movement observed: may be unresponsive, verify immediately")
    if location_conf == "Low":
        reasons.append("Location uncertain: search a wider radius on arrival")
    return {"level": level, "score": score, "max_score": conf_max + pers_max + cfg["movement_points"] + loc_max,
            "breakdown": breakdown, "reasons": reasons,
            "rule": f"HIGH ≥ {cfg['high_min']} pts · MEDIUM ≥ {cfg['medium_min']} pts · otherwise LOW"}
