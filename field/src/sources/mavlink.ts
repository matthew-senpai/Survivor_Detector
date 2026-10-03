// Minimal MAVLink v1/v2 reader for the messages Landsight needs (read-only: we never command the aircraft).
// Layouts and CRC_EXTRA values are verified against pymavlink in tests/mavlink.test.ts.
import type { TelemetrySample } from "../pipeline/types";

type Decoder = (v: DataView) => Record<string, number | string>;

const f32 = (v: DataView, o: number) => v.getFloat32(o, true);
const MSGS: Record<number, { name: string; len: number; crcExtra: number; decode: Decoder }> = {
  0: { name: "HEARTBEAT", len: 9, crcExtra: 50, decode: (v) => ({ custom_mode: v.getUint32(0, true), type: v.getUint8(4), autopilot: v.getUint8(5), base_mode: v.getUint8(6), system_status: v.getUint8(7) }) },
  1: { name: "SYS_STATUS", len: 31, crcExtra: 124, decode: (v) => ({ voltage_battery: v.getUint16(14, true), battery_remaining: v.getInt8(30) }) },
  24: { name: "GPS_RAW_INT", len: 30, crcExtra: 24, decode: (v) => ({ lat: v.getInt32(8, true), lon: v.getInt32(12, true), alt: v.getInt32(16, true), eph: v.getUint16(20, true), vel: v.getUint16(24, true), cog: v.getUint16(26, true), fix_type: v.getUint8(28), satellites_visible: v.getUint8(29) }) },
  30: { name: "ATTITUDE", len: 28, crcExtra: 39, decode: (v) => ({ time_boot_ms: v.getUint32(0, true), roll: f32(v, 4), pitch: f32(v, 8), yaw: f32(v, 12) }) },
  33: { name: "GLOBAL_POSITION_INT", len: 28, crcExtra: 104, decode: (v) => ({ time_boot_ms: v.getUint32(0, true), lat: v.getInt32(4, true), lon: v.getInt32(8, true), alt: v.getInt32(12, true), relative_alt: v.getInt32(16, true), vx: v.getInt16(20, true), vy: v.getInt16(22, true), vz: v.getInt16(24, true), hdg: v.getUint16(26, true) }) },
  74: { name: "VFR_HUD", len: 20, crcExtra: 20, decode: (v) => ({ airspeed: f32(v, 0), groundspeed: f32(v, 4), alt: f32(v, 8), climb: f32(v, 12), heading: v.getInt16(16, true), throttle: v.getUint16(18, true) }) },
  132: { name: "DISTANCE_SENSOR", len: 14, crcExtra: 85, decode: (v) => ({ time_boot_ms: v.getUint32(0, true), min_distance: v.getUint16(4, true), max_distance: v.getUint16(6, true), current_distance: v.getUint16(8, true), orientation: v.getUint8(12) }) },
  253: { name: "STATUSTEXT", len: 51, crcExtra: 83, decode: (v) => ({ severity: v.getUint8(0), text: new TextDecoder().decode(new Uint8Array(v.buffer, v.byteOffset + 1, 50)).replace(/\0.*$/s, "") }) },
  265: { name: "MOUNT_ORIENTATION", len: 16, crcExtra: 26, decode: (v) => ({ roll: f32(v, 4), pitch: f32(v, 8), yaw: f32(v, 12) }) },
  285: { name: "GIMBAL_DEVICE_ATTITUDE_STATUS", len: 40, crcExtra: 137, decode: (v) => {
    const [w, x, y, z] = [f32(v, 4), f32(v, 8), f32(v, 12), f32(v, 16)];
    return { q_w: w, q_x: x, q_y: y, q_z: z, pitch_deg: (Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))) * 180) / Math.PI };
  } },
};

function crc16(bytes: Uint8Array, start: number, end: number, extra: number) {
  let crc = 0xffff;
  const acc = (b: number) => {
    let t = (b ^ (crc & 0xff)) & 0xff;
    t = (t ^ (t << 4)) & 0xff;
    crc = ((crc >> 8) ^ (t << 8) ^ (t << 3) ^ (t >> 4)) & 0xffff;
  };
  for (let i = start; i < end; i++) acc(bytes[i]);
  acc(extra);
  return crc;
}

export interface MavMessage { msgid: number; name: string; sysid: number; compid: number; fields: Record<string, number | string> }

/** Streaming frame parser: feed arbitrary chunks, get validated messages. Unknown ids are skipped (CRC can't be checked). */
export class MavlinkParser {
  private buf = new Uint8Array(0);
  stats = { frames: 0, crcErrors: 0, unknown: 0 };

  feed(chunk: Uint8Array): MavMessage[] {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf);
    b.set(chunk, this.buf.length);
    const out: MavMessage[] = [];
    let i = 0;
    while (i < b.length) {
      const stx = b[i];
      if (stx !== 0xfd && stx !== 0xfe) { i++; continue; }
      const v2 = stx === 0xfd, hdr = v2 ? 10 : 6;
      if (i + 2 > b.length) break;
      const len = b[i + 1];
      const signed = v2 && i + 3 <= b.length && (b[i + 2] & 0x01) !== 0;
      const total = hdr + len + 2 + (signed ? 13 : 0);
      if (i + total > b.length) break;
      const msgid = v2 ? b[i + 7] | (b[i + 8] << 8) | (b[i + 9] << 16) : b[i + 5];
      const def = MSGS[msgid];
      // Unknown id: its CRC can't be checked, so this may be a false start byte inside noise. Step one byte and
      // resync rather than trusting its length (which could swallow real frames). Real known frames are CRC-checked.
      if (!def) { this.stats.unknown++; i++; continue; }
      const crc = b[i + hdr + len] | (b[i + hdr + len + 1] << 8);
      if (crc16(b, i + 1, i + hdr + len, def.crcExtra) !== crc) { this.stats.crcErrors++; i++; continue; }
      const payload = new Uint8Array(Math.max(def.len, len)); // v2 strips trailing zero bytes: pad back
      payload.set(b.subarray(i + hdr, i + hdr + len));
      this.stats.frames++;
      out.push({ msgid, name: def.name, sysid: b[i + (v2 ? 5 : 3)], compid: b[i + (v2 ? 6 : 4)], fields: def.decode(new DataView(payload.buffer)) });
      i += total;
    }
    this.buf = b.slice(i);
    if (this.buf.length > 4096) this.buf = this.buf.slice(-280); // never grow unbounded on line noise
    return out;
  }
}

export interface LinkState {
  heartbeatAt: number | null; gpsFix: number; sats: number; hdop: number; battery: number;
  yawDeg: number | null; aglM: number | null; gimbalPitch: number | null; simulated: boolean; lastText: string | null;
  autopilot: number | null;
}

/** Turns a MAVLink byte stream into TelemetrySamples on the session clock. */
export class MavlinkTelemetry {
  private parser = new MavlinkParser();
  state: LinkState = { heartbeatAt: null, gpsFix: 0, sats: 0, hdop: 99, battery: -1, yawDeg: null, aglM: null, gimbalPitch: null, simulated: false, lastText: null, autopilot: null };

  constructor(private clock: () => number, private onSample: (s: TelemetrySample) => void, private defaults: { gimbal_pitch_deg: number }) {}

  get linkStats() { return this.parser.stats; }

  feed(chunk: Uint8Array) {
    for (const m of this.parser.feed(chunk)) this.handle(m);
  }

  private handle(m: MavMessage) {
    const f = m.fields as Record<string, number>, s = this.state;
    switch (m.name) {
      case "HEARTBEAT": if (f.type !== 6) { s.heartbeatAt = this.clock(); s.autopilot = f.autopilot; } break; // 6 = GCS, ignore
      case "GPS_RAW_INT": s.gpsFix = f.fix_type; s.sats = f.satellites_visible; s.hdop = f.eph === 65535 ? 99 : f.eph / 100; break;
      case "SYS_STATUS": s.battery = f.battery_remaining; break;
      case "ATTITUDE": s.yawDeg = (((f.yaw * 180) / Math.PI) % 360 + 360) % 360; break;
      case "DISTANCE_SENSOR": if (f.orientation === 25 && f.current_distance > f.min_distance && f.current_distance < f.max_distance) s.aglM = f.current_distance / 100; break;
      case "MOUNT_ORIENTATION": s.gimbalPitch = f.pitch; break;
      case "GIMBAL_DEVICE_ATTITUDE_STATUS": s.gimbalPitch = f.pitch_deg; break;
      case "STATUSTEXT": s.lastText = String(m.fields.text); if (/SIMULATED/i.test(s.lastText)) s.simulated = true; break;
      case "GLOBAL_POSITION_INT": {
        const alt = s.aglM ?? f.relative_alt / 1000; // downward rangefinder if fitted, else height above home
        this.onSample({
          t: this.clock(), lat: f.lat / 1e7, lon: f.lon / 1e7, alt_m: alt,
          heading_deg: f.hdg !== 65535 ? f.hdg / 100 : s.yawDeg ?? 0,
          speed_mps: Math.hypot(f.vx, f.vy) / 100, gimbal_pitch_deg: s.gimbalPitch ?? this.defaults.gimbal_pitch_deg,
          gps_fix: s.gpsFix, sats: s.sats, hdop: s.hdop, battery_pct: s.battery,
        });
      }
    }
  }
}
