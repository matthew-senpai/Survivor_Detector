import { useEffect, useState, useSyncExternalStore } from "react";

/** Mission replay clock. Canvases read `now()` every animation frame; React UI subscribes at a low rate,
 *  so a 60 fps video feed never forces the map and panels to re-render 60 times a second. */
export interface Clock {
  now(): number;
  playing: boolean;
  speed: number;
  start: number;
  end: number;
  loop: boolean;
  play(): void;
  pause(): void;
  seek(t: number): void;
  setSpeed(s: number): void;
  setRange(start: number, end: number): void;
  subscribe(fn: () => void): () => void;
  version: number;
}

export function createClock(end: number, opts: { start?: number; speed?: number; loop?: boolean; playing?: boolean } = {}): Clock {
  let base = opts.start ?? 0;
  let wall = performance.now();
  const subs = new Set<() => void>();
  const c: Clock = {
    playing: opts.playing ?? false,
    speed: opts.speed ?? 1,
    start: opts.start ?? 0,
    end,
    loop: opts.loop ?? false,
    version: 0,
    now() {
      if (!c.playing) return base;
      let t = base + ((performance.now() - wall) / 1000) * c.speed;
      if (t >= c.end) {
        if (c.loop) {
          t = c.start + ((t - c.start) % (c.end - c.start));
        } else {
          t = c.end;
          base = t;
          c.playing = false;
          queueMicrotask(emit);
        }
      }
      return t;
    },
    play() {
      if (base >= c.end - 0.01) base = c.start;
      wall = performance.now();
      c.playing = true;
      emit();
    },
    pause() {
      base = c.now();
      c.playing = false;
      emit();
    },
    seek(t) {
      base = Math.max(c.start, Math.min(c.end, t));
      wall = performance.now();
      emit();
    },
    setSpeed(s) {
      base = c.now();
      wall = performance.now();
      c.speed = s;
      emit();
    },
    setRange(start, end) {
      c.start = start;
      c.end = end;
      c.seek(start);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
  function emit() {
    c.version++;
    subs.forEach((f) => f());
  }
  return c;
}

/** Re-renders on play/pause/seek/speed changes. */
export function useClockState(clock: Clock) {
  useSyncExternalStore(clock.subscribe, () => clock.version);
  return clock;
}

/** Current clock time, sampled `hz` times per second while playing (and immediately on seek). */
export function useClockTime(clock: Clock, hz = 6): number {
  const [t, setT] = useState(() => clock.now());
  useClockState(clock);
  useEffect(() => {
    setT(clock.now());
    if (!clock.playing) return;
    const id = setInterval(() => setT(clock.now()), 1000 / hz);
    return () => clearInterval(id);
  }, [clock, clock.version, hz]);
  return t;
}
