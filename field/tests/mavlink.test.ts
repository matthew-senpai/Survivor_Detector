// MAVLink decoding verified against frames produced by pymavlink (field/scripts/make_fixtures.py).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MavlinkParser, MavlinkTelemetry } from "../src/sources/mavlink";
import type { TelemetrySample } from "../src/pipeline/types";

const cases: { label: string; msgid: number; hex: string; fields: Record<string, number | string | number[]> }[] =
  JSON.parse(readFileSync(new URL("./fixtures/mavlink.json", import.meta.url), "utf8"));
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));

describe("MAVLink parser", () => {
  it.each(cases)("decodes $label", ({ msgid, hex, fields }) => {
    const [m] = new MavlinkParser().feed(bytes(hex));
    expect(m, "frame rejected (CRC or layout mismatch)").toBeDefined();
    expect(m.msgid).toBe(msgid);
    for (const [k, v] of Object.entries(fields)) {
      if (!(k in m.fields)) continue;
      if (typeof v === "number") expect(m.fields[k] as number).toBeCloseTo(v, 4);
      else expect(m.fields[k]).toBe(v);
    }
    if (m.name === "GIMBAL_DEVICE_ATTITUDE_STATUS") expect(m.fields.pitch_deg as number).toBeCloseTo(-90, 3);
  });

  it("resyncs through garbage, split chunks and a corrupted frame", () => {
    const good = cases.map((c) => bytes(c.hex));
    const bad = good[1].slice(); bad[bad.length - 1] ^= 0xff;
    const stream = new Uint8Array([0x00, 0xfd, 0x13, ...good[0], 0x55, ...bad, ...good.slice(1).flatMap((g) => [...g])]);
    const p = new MavlinkParser(), out = [];
    for (let i = 0; i < stream.length; i += 7) out.push(...p.feed(stream.subarray(i, i + 7)));
    expect(out.length).toBe(good.length);
    expect(p.stats.crcErrors).toBeGreaterThanOrEqual(1);
  });

  it("builds telemetry samples with rangefinder height, GPS quality and simulation flag", () => {
    const got: TelemetrySample[] = [];
    const tel = new MavlinkTelemetry(() => 12.5, (s) => got.push(s), { gimbal_pitch_deg: -90 });
    const pick = (label: string) => bytes(cases.find((c) => c.label === label)!.hex);
    for (const l of ["HEARTBEAT v2", "GPS_RAW_INT v2", "SYS_STATUS v2", "DISTANCE_SENSOR v2", "MOUNT_ORIENTATION v2", "STATUSTEXT v2", "GLOBAL_POSITION_INT v2"]) tel.feed(pick(l));
    expect(got).toHaveLength(1);
    const s = got[0];
    expect(s.t).toBe(12.5);
    expect(s.lat).toBeCloseTo(11.4762345, 7);
    expect(s.lon).toBeCloseTo(76.1428765, 7);
    expect(s.alt_m).toBeCloseTo(29.95, 3); // rangefinder 2995 cm beats relative_alt 30.45 m
    expect(s.heading_deg).toBeCloseTo(271.5, 3);
    expect(s.gimbal_pitch_deg).toBeCloseTo(-87.5, 3);
    expect([s.gps_fix, s.sats, s.hdop, s.battery_pct]).toEqual([3, 15, 0.92, 77]);
    expect(tel.state.simulated).toBe(true);
  });
});
