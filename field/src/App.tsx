import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_MODEL, Detector, type DetectorInfo } from "./detector/client";
import type { SessionSettings } from "./session/session";
import Live from "./views/Live";
import Missions, { Review } from "./views/Missions";
import Setup from "./views/Setup";

export interface DetectorState {
  detector: Detector;
  status: "loading" | "ready" | "error";
  info: DetectorInfo | null;
  error: string | null;
  progress: [number, number];
  load: (model?: string | File, backend?: "auto" | "webgpu" | "wasm") => void;
}

// One detector (one worker, one GPU session) for the whole app, created once even under React's dev double-render.
let shared: Detector | null = null;
let initialLoad = false;

function useDetector(): DetectorState {
  const ref = useRef<Detector | null>(null);
  ref.current = shared ??= new Detector();
  const [s, setS] = useState<Omit<DetectorState, "detector" | "load">>({ status: "loading", info: null, error: null, progress: [0, 0] });
  const load = useCallback((model: string | File = DEFAULT_MODEL, backend: "auto" | "webgpu" | "wasm" = "auto") => {
    const d = ref.current!;
    setS({ status: "loading", info: null, error: null, progress: [0, 0] });
    d.onProgress = (loaded, total) => setS((p) => ({ ...p, progress: [loaded, total] }));
    d.init(model, backend).then(
      (info) => setS((p) => ({ ...p, status: "ready", info })),
      (e: Error) => setS((p) => ({ ...p, status: "error", error: e.message })),
    );
  }, []);
  useEffect(() => {
    if (initialLoad) { const info = ref.current!.info; if (info) setS((p) => ({ ...p, status: "ready", info })); return; }
    initialLoad = true;
    load();
  }, [load]);
  return { detector: ref.current, load, ...s };
}

function useHash() {
  const [h, setH] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => setH(location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return h;
}
export const go = (h: string) => { location.hash = h; };

export default function App() {
  const hash = useHash();
  const det = useDetector();
  const [settings, setSettings] = useState<SessionSettings | null>(null);

  if (hash.startsWith("#/live") && settings) {
    return <Live settings={settings} detector={det.detector} onClose={(id) => { setSettings(null); go(id ? `#/mission/${id}` : "#/"); }} />;
  }
  if (hash.startsWith("#/mission/")) return <Review id={decodeURIComponent(hash.slice("#/mission/".length))} />;
  if (hash.startsWith("#/missions")) return <Missions />;
  return <Setup det={det} onStart={(s) => { setSettings(s); go("#/live"); }} />;
}
