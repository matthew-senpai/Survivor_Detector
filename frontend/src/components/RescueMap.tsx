import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { Circle, ImageOverlay, MapContainer, Marker, Polygon, Polyline, Rectangle, TileLayer, Tooltip, useMap } from "react-leaflet";
import { asset, PRIORITY_COLOR, telemetryAt, visibleSurvivors } from "../lib/mission";
import type { Bundle, Survivor } from "../lib/types";

interface Props {
  bundle: Bundle;
  t: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  view?: "sector" | "zone";
  className?: string;
  scrollZoom?: boolean;
}

const M_PER_DEG = 111320;
const SECTOR_STYLE = {
  active: { color: "#ff7a1a", weight: 2, fillOpacity: 0.04 },
  searched: { color: "#3ddc84", weight: 1, fillOpacity: 0.08, dashArray: "2 4" },
  queued: { color: "#e7ece9", weight: 1, fillOpacity: 0, opacity: 0.35, dashArray: "4 6" },
};

function footprint(lat: number, lon: number, alt: number, heading: number, hfov: number, aspect: number): [number, number][] {
  const w = 2 * alt * Math.tan((hfov * Math.PI) / 360), h = w / aspect, a = (heading * Math.PI) / 180;
  const f = [Math.sin(a), Math.cos(a)], r = [Math.cos(a), -Math.sin(a)];
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sr, sf]) => {
    const e = (sr * w * r[0] + sf * h * f[0]) / 2, n = (sr * w * r[1] + sf * h * f[1]) / 2;
    return [lat + n / M_PER_DEG, lon + e / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))];
  });
}

const droneIcon = (heading: number) => L.divIcon({
  className: "", iconSize: [34, 34], iconAnchor: [17, 17],
  html: `<svg width="34" height="34" viewBox="0 0 34 34" style="transform:rotate(${heading}deg)"><circle cx="17" cy="17" r="15" fill="rgba(94,242,194,0.15)" stroke="#5ef2c2" stroke-width="1.5"/><path d="M17 5 L24 25 L17 20 L10 25 Z" fill="#5ef2c2"/></svg>`,
});

const survivorIcon = (s: Survivor, selected: boolean) => L.divIcon({
  className: "", iconSize: [22, 22], iconAnchor: [11, 11],
  html: `<div class="ls-marker ${selected ? "sel" : ""}" style="width:22px;height:22px;color:${PRIORITY_COLOR[s.priority.level]}">${s.priority.level === "HIGH" || selected ? '<div class="ring"></div>' : ""}<div class="dot"></div></div>`,
});

const teamIcon = (label: string) => L.divIcon({
  className: "", iconSize: [60, 20], iconAnchor: [9, 9],
  html: `<div style="display:flex;align-items:center;gap:4px;font:600 10px 'IBM Plex Mono',monospace;color:#e7ece9;white-space:nowrap"><span style="width:14px;height:14px;background:#2d6cdf;border:2px solid #e7ece9;display:inline-block;transform:rotate(45deg)"></span>${label}</div>`,
});

function Fit({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => { map.fitBounds(bounds, { padding: [20, 20] }); }, [map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function PanTo({ s }: { s?: Survivor }) {
  const map = useMap();
  useEffect(() => {
    if (s && !map.getBounds().pad(-0.15).contains([s.lat, s.lon])) map.panTo([s.lat, s.lon]);
  }, [s, map]);
  return null;
}

export default function RescueMap({ bundle, t, selectedId, onSelect, view = "sector", className = "", scrollZoom = true }: Props) {
  const [showMosaic, setShowMosaic] = useState(true);
  const [tilesDown, setTilesDown] = useState(false);
  const sim = bundle.sim;
  const tel = telemetryAt(bundle, t);
  const cols = bundle.telemetry.cols;
  const iLat = cols.indexOf("lat"), iLon = cols.indexOf("lon");

  const { mosaic, path, bounds } = useMemo(() => {
    const rows = bundle.telemetry.rows;
    const path = rows.filter((_, i) => i % 3 === 0).map((r) => [r[0], r[iLat], r[iLon]]);
    let mosaic: [[number, number], [number, number]] | null = null;
    let bounds: L.LatLngBoundsExpression;
    if (sim) {
      const [lat0, lon0] = sim.origin;
      const latB = lat0 - (sim.height_px * sim.m_per_px) / M_PER_DEG;
      const lonR = lon0 + (sim.width_px * sim.m_per_px) / (M_PER_DEG * Math.cos((lat0 * Math.PI) / 180));
      mosaic = [[latB, lon0], [lat0, lonR]];
      bounds = view === "zone" ? sim.zone : mosaic;
    } else {
      bounds = path.length ? path.map((p) => [p[1], p[2]] as [number, number]) : [[0, 0], [0.001, 0.001]];
    }
    return { mosaic, path, bounds };
  }, [bundle, sim, view, iLat, iLon]);

  const flown = path.filter((p) => p[0] <= t).map((p) => [p[1], p[2]] as [number, number]);
  if (tel) flown.push([tel.lat, tel.lon]);
  const survivors = visibleSurvivors(bundle, t);
  const selected = bundle.survivors.find((s) => s.id === selectedId);
  const active = t < bundle.mission.duration_s - 0.5;

  return (
    <div className={className /* caller sets positioning: relative + height, or absolute inset-0 */}>
      <MapContainer center={[0, 0]} zoom={17} maxZoom={21} scrollWheelZoom={scrollZoom} className="h-full w-full" attributionControl>
        <Fit bounds={bounds} />
        <PanTo s={selected} />
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxNativeZoom={18} maxZoom={21}
          attribution="Imagery © Esri, Maxar, Earthstar Geographics"
          eventHandlers={{ tileerror: () => setTilesDown(true), tileload: () => setTilesDown(false) }}
        />
        {sim && <Polygon positions={sim.zone} pathOptions={{ color: "#ff4d3d", weight: 1.5, dashArray: "6 6", fillColor: "#ff4d3d", fillOpacity: 0.07 }}>
          <Tooltip sticky className="ls-tip">Landslide affected zone (illustrative)</Tooltip>
        </Polygon>}
        {sim?.sectors.map((s) => (
          <Rectangle key={s.name} bounds={s.bounds} pathOptions={SECTOR_STYLE[s.status]}>
            <Tooltip sticky className="ls-tip">Sector {s.name} · {s.status}</Tooltip>
          </Rectangle>
        ))}
        {sim && mosaic && showMosaic && <ImageOverlay url={asset(bundle, sim.terrain)} bounds={mosaic} opacity={0.92} />}
        {path.length > 1 && <Polyline positions={path.map((p) => [p[1], p[2]] as [number, number])} pathOptions={{ color: "#e7ece9", weight: 1, opacity: 0.35, dashArray: "3 5" }} />}
        {flown.length > 1 && <Polyline positions={flown} pathOptions={{ color: "#5ef2c2", weight: 2.5, opacity: 0.9 }} />}
        {tel && active && <Polygon positions={footprint(tel.lat, tel.lon, tel.alt_m, tel.heading_deg, bundle.camera.hfov_deg, bundle.camera.image_width / bundle.camera.image_height)}
          pathOptions={{ color: "#5ef2c2", weight: 1, fillColor: "#5ef2c2", fillOpacity: 0.12 }} />}
        {tel && <Marker position={[tel.lat, tel.lon]} icon={droneIcon(tel.heading_deg)} zIndexOffset={1000}>
          <Tooltip className="ls-tip">UAV · {tel.alt_m.toFixed(1)} m AGL · {tel.speed_mps.toFixed(1)} m/s</Tooltip>
        </Marker>}
        {sim?.teams.map((tm) => (
          <Marker key={tm.id} position={tm.pos} icon={teamIcon(tm.id)}>
            <Tooltip className="ls-tip">{tm.name} · {tm.members} · {tm.status} (simulated)</Tooltip>
          </Marker>
        ))}
        {selected && selected.confirmed_t <= t && <Circle center={[selected.lat, selected.lon]} radius={selected.uncertainty_m}
          pathOptions={{ color: PRIORITY_COLOR[selected.priority.level], weight: 1, fillOpacity: 0.15 }} />}
        {survivors.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lon]} icon={survivorIcon(s, s.id === selectedId)} zIndexOffset={s.id === selectedId ? 2000 : 500}
            eventHandlers={{ click: () => onSelect?.(s.id) }}>
            <Tooltip className="ls-tip" direction="top" offset={[0, -10]}>{s.id} · {s.priority.level} · {(s.confidence * 100).toFixed(0)}%</Tooltip>
          </Marker>
        ))}
      </MapContainer>

      <div className="pointer-events-auto absolute bottom-3 left-3 z-[500] border border-line bg-bg/85 p-2.5 font-mono text-[10.5px] leading-5 text-muted backdrop-blur">
        {(["HIGH", "MEDIUM", "LOW"] as const).map((l) => (
          <div key={l} className="flex items-center gap-2"><span className="inline-block size-2.5 rounded-full" style={{ background: PRIORITY_COLOR[l] }} />{l === "LOW" ? "LOW / unverified" : l}</div>
        ))}
        <div className="flex items-center gap-2"><span className="inline-block h-0.5 w-3 bg-hud" />UAV track</div>
        {sim && <>
          <div className="flex items-center gap-2"><span className="inline-block size-2.5 rotate-45 border border-ink bg-[#2d6cdf]" />Rescue teams (sim)</div>
          <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-3 border border-signal" />Active sector</div>
          <label className="mt-1 flex cursor-pointer items-center gap-2 text-ink">
            <input type="checkbox" checked={showMosaic} onChange={(e) => setShowMosaic(e.target.checked)} className="accent-[#ff7a1a]" />Drone mosaic
          </label>
        </>}
      </div>
      {tilesDown && <div className="absolute right-3 top-3 z-[500] border border-medium/40 bg-bg/90 px-2.5 py-1.5 font-mono text-[11px] text-medium">
        Satellite basemap unavailable (offline?). Mission layers still shown.
      </div>}
    </div>
  );
}
