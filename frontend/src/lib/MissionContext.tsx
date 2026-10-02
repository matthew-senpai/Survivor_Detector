import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, loadBundle, SAMPLE_ID, STATIC_DEMO, type DataSource } from "./api";
import type { Bundle, Health } from "./types";

interface Ctx {
  bundle: Bundle | null;
  source: DataSource | null;
  error: string | null;
  loading: boolean;
  health: Health | null;
  apiOnline: boolean | null;
  latencyMs: number | null;
  missionId: string;
  openMission: (id: string) => Promise<void>;
  replaceBundle: (b: Bundle) => void;
}

const MissionCtx = createContext<Ctx | null>(null);

export function MissionProvider({ children }: { children: ReactNode }) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [latencyMs, setLatency] = useState<number | null>(null);
  const [missionId, setMissionId] = useState(SAMPLE_ID);

  const openMission = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await loadBundle(id);
      setBundle(r.bundle);
      setSource(r.source);
      setMissionId(r.bundle.mission.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { openMission(SAMPLE_ID); }, [openMission]);

  useEffect(() => {
    if (STATIC_DEMO) { setApiOnline(false); return; }
    let alive = true;
    const ping = async () => {
      const t0 = performance.now();
      try {
        const h = await api.health();
        if (!alive) return;
        setHealth(h);
        setApiOnline(true);
        setLatency(Math.round(performance.now() - t0));
      } catch {
        if (!alive) return;
        setApiOnline(false);
        setLatency(null);
      }
    };
    ping();
    const id = setInterval(ping, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Backend came back after we fell back to the cached copy: switch to live data quietly.
  useEffect(() => {
    if (apiOnline && source === "cached") openMission(missionId);
  }, [apiOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MissionCtx.Provider value={{ bundle, source, error, loading, health, apiOnline, latencyMs, missionId, openMission, replaceBundle: setBundle }}>
      {children}
    </MissionCtx.Provider>
  );
}

export function useMission() {
  const c = useContext(MissionCtx);
  if (!c) throw new Error("useMission outside MissionProvider");
  return c;
}
