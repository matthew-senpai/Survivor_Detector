import L from "leaflet";
import { MapPinOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Circle, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { Survivor } from "../pipeline/types";
import { PRIORITY_COLOR } from "../ui";

export interface MapProps {
  geo: boolean;
  trail: [number, number][];
  drone: { lat: number; lon: number; heading: number; alt: number } | null;
  footprint: [number, number][];
  survivors: Survivor[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  live: boolean;
}

const droneIcon = (h: number) => L.divIcon({
  className: "", iconSize: [34, 34], iconAnchor: [17, 17],
  html: `<svg width="34" height="34" viewBox="0 0 34 34" style="transform:rotate(${h}deg)"><circle cx="17" cy="17" r="15" fill="rgba(94,242,194,0.15)" stroke="#5ef2c2" stroke-width="1.5"/><path d="M17 5 L24 25 L17 20 L10 25 Z" fill="#5ef2c2"/></svg>`,
});
const survivorIcon = (s: Survivor, sel: boolean) => L.divIcon({
  className: "", iconSize: [22, 22], iconAnchor: [11, 11],
  html: `<div class="ls-marker ${sel ? "sel" : ""}" style="width:22px;height:22px;color:${PRIORITY_COLOR[s.priority.level]}">${s.priority.level === "HIGH" || sel ? '<div class="ring"></div>' : ""}<div class="dot"></div></div>`,
});

function Follow({ to, enabled, fitPts }: { to: [number, number] | null; enabled: boolean; fitPts: [number, number][] }) {
  const map = useMap(), fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && fitPts.length) { map.fitBounds(L.latLngBounds(fitPts).pad(0.3), { maxZoom: 19 }); fitted.current = true; }
    else if (enabled && to && !map.getBounds().pad(-0.25).contains(to)) map.panTo(to);
  }, [to, enabled, fitPts, map]);
  return null;
}

export default function FieldMap({ geo, trail, drone, footprint, survivors, selectedId, onSelect, live }: MapProps) {
  const [follow, setFollow] = useState(true);
  const [tilesDown, setTilesDown] = useState(false);
  if (!geo) {
    return (
      <div className="grid-bg flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-muted">
        <MapPinOff size={22} />Detection-only mission: no drone position, so no map.<span className="text-[12px] text-dim">Add MAVLink, a DJI .SRT/CSV log, or a fixed position to locate survivors.</span>
      </div>
    );
  }
  const located = survivors.filter((s) => s.lat !== null);
  const sel = located.find((s) => s.id === selectedId);
  const fitPts: [number, number][] = [...trail, ...located.map((s) => [s.lat!, s.lon!] as [number, number]), ...(drone ? [[drone.lat, drone.lon] as [number, number]] : [])];
  return (
    <div className="relative h-full w-full">
      <MapContainer center={[0, 0]} zoom={2} maxZoom={21} className="h-full w-full">
        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={18} maxZoom={21}
          attribution="Imagery © Esri, Maxar, Earthstar Geographics" eventHandlers={{ tileerror: () => setTilesDown(true), tileload: () => setTilesDown(false) }} />
        <Follow to={drone ? [drone.lat, drone.lon] : null} enabled={live && follow} fitPts={fitPts} />
        {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: "#5ef2c2", weight: 2.5, opacity: 0.9 }} />}
        {live && footprint.length > 2 && <Polygon positions={footprint} pathOptions={{ color: "#5ef2c2", weight: 1, fillOpacity: 0.12 }} />}
        {drone && <Marker position={[drone.lat, drone.lon]} icon={droneIcon(drone.heading)} zIndexOffset={1000}><Tooltip className="ls-tip">Drone · {drone.alt.toFixed(1)} m · {drone.heading.toFixed(0)}°</Tooltip></Marker>}
        {sel && sel.uncertainty_m !== null && <Circle center={[sel.lat!, sel.lon!]} radius={sel.uncertainty_m} pathOptions={{ color: PRIORITY_COLOR[sel.priority.level], weight: 1, fillOpacity: 0.15 }} />}
        {located.map((s) => (
          <Marker key={s.id} position={[s.lat!, s.lon!]} icon={survivorIcon(s, s.id === selectedId)} zIndexOffset={s.id === selectedId ? 2000 : 500} eventHandlers={{ click: () => onSelect(s.id) }}>
            <Tooltip className="ls-tip" direction="top" offset={[0, -10]}>{s.id} · {s.priority.level} · {(s.confidence * 100).toFixed(0)}%</Tooltip>
          </Marker>
        ))}
      </MapContainer>
      {live && (
        <label className="absolute right-2 top-2 z-[500] flex cursor-pointer items-center gap-1.5 bg-bg/85 px-2 py-1 font-mono text-[11px] text-ink">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />Follow drone
        </label>
      )}
      {!fitPts.length && <div className="absolute inset-x-0 top-1/2 z-[500] mx-auto w-fit -translate-y-1/2 bg-bg/85 px-3 py-1.5 font-mono text-[11.5px] text-muted">Waiting for the first position…</div>}
      {tilesDown && <div className="absolute bottom-2 left-2 z-[500] bg-bg/90 px-2 py-1 font-mono text-[11px] text-medium">Offline: satellite imagery unavailable, positions still shown</div>}
    </div>
  );
}
