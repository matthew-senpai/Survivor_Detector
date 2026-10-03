// Live MAVLink links. Serial: a USB telemetry radio (SiK) or the flight controller's USB port, via Web Serial
// (Chrome/Edge). WebSocket: MAVLink bytes relayed by backend/tools/mavlink_ws_bridge.py (UDP/serial -> WS).
import { MavlinkTelemetry } from "./mavlink";
import type { TelemetrySample } from "../pipeline/types";
import { TelemetryTrack } from "../pipeline/telemetry";

export interface MavLink {
  kind: "serial" | "ws";
  label: string;
  telemetry: MavlinkTelemetry;
  track: TelemetryTrack;          // samples stamped with performance.now()/1000
  error: string | null;
  closed: boolean;
  close(): void;
}

export const nowS = () => performance.now() / 1000;

function makeTelemetry(defaults: { gimbal_pitch_deg: number }) {
  const track = new TelemetryTrack();
  const telemetry = new MavlinkTelemetry(nowS, (s: TelemetrySample) => {
    if (s.t > (track.latest()?.t ?? -1)) track.append(s);
  }, defaults);
  return { track, telemetry };
}

export const serialSupported = () => "serial" in navigator;

export async function connectSerial(baudRate: number, defaults: { gimbal_pitch_deg: number }): Promise<MavLink> {
  if (!serialSupported()) throw new Error("Web Serial isn't available: use Chrome or Edge on a desktop, over HTTPS.");
  let port: SerialPort;
  try {
    port = await navigator.serial.requestPort();
  } catch {
    throw new Error("No serial port selected.");
  }
  try {
    await port.open({ baudRate });
  } catch (e) {
    throw new Error(`Couldn't open the port (${(e as Error).message}). Is another app (Mission Planner, QGC) using it?`);
  }
  const { track, telemetry } = makeTelemetry(defaults);
  const info = port.getInfo();
  const link: MavLink = {
    kind: "serial", label: `USB serial ${info.usbVendorId ? `${info.usbVendorId.toString(16)}:${info.usbProductId?.toString(16)}` : ""} @ ${baudRate}`,
    telemetry, track, error: null, closed: false,
    close() { link.closed = true; reader?.cancel().catch(() => {}); },
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  (async () => {
    try {
      while (!link.closed && port.readable) {
        reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) telemetry.feed(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
    } catch (e) {
      link.error = `Telemetry link lost: ${(e as Error).message}`;
    } finally {
      link.closed = true;
      await port.close().catch(() => {});
    }
  })();
  return link;
}

export function connectWebSocket(url: string, defaults: { gimbal_pitch_deg: number }): Promise<MavLink> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return reject(new Error(`Invalid WebSocket URL: ${(e as Error).message}`));
    }
    ws.binaryType = "arraybuffer";
    const { track, telemetry } = makeTelemetry(defaults);
    const link: MavLink = { kind: "ws", label: url, telemetry, track, error: null, closed: false, close() { link.closed = true; ws.close(); } };
    const timer = setTimeout(() => { ws.close(); reject(new Error(`No answer from ${url} within 5 s. Is the bridge running?`)); }, 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(link); };
    ws.onerror = () => { clearTimeout(timer); link.error = `Can't reach ${url}. Start the bridge (see Connect a drone).`; reject(new Error(link.error)); };
    ws.onclose = () => { if (!link.closed) link.error = "Telemetry bridge disconnected."; link.closed = true; };
    ws.onmessage = (e) => { if (e.data instanceof ArrayBuffer) telemetry.feed(new Uint8Array(e.data)); };
  });
}
