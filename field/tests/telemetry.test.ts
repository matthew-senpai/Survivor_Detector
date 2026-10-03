// Flight-log parsing: DJI .SRT variants (written to match the formats DJI drones record) and Landsight CSV.
import { describe, expect, it } from "vitest";
import { offsetLatLon } from "../src/pipeline/geo";
import { parseCsv, parseDjiSrt, TelemetryError } from "../src/pipeline/telemetry";

const ts = (s: number) => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
/** n entries at 30 fps, drone moving `speed` m/s along `bearing`; body(i, lat, lon) renders one entry. */
function srt(n: number, speed: number, bearing: number, body: (i: number, lat: number, lon: number) => string) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / 30, d = speed * t, b = (bearing * Math.PI) / 180;
    const [lat, lon] = offsetLatLon(22.54321, 113.958765, d * Math.sin(b), d * Math.cos(b));
    out.push(`${i + 1}\n${ts(t)} --> ${ts(t + 1 / 30)}\n${body(i, lat, lon)}\n`);
  }
  return out.join("\n");
}
const defaults = { heading_deg: 0, gimbal_pitch_deg: -90 };

describe("DJI .SRT", () => {
  it("reads Mini 3/4 / Air / Mavic 3 logs (bracketed fields, rel_alt) and estimates heading from the path", () => {
    const text = srt(300, 5, 0, (i, lat, lon) => `<font size="28">FrameCnt: ${i + 1}, DiffTime: 33ms\n2026-10-03 10:15:33.123\n[iso: 100] [shutter: 1/1000.0] [fnum: 1.7] [ev: 0] [color_md: default] [focal_len: 24.00] [latitude: ${lat.toFixed(6)}] [longitude: ${lon.toFixed(6)}] [rel_alt: 30.100 abs_alt: 120.500] [ct: 5500] </font>`);
    const r = parseDjiSrt(text, defaults);
    expect(r.samples.length).toBeGreaterThan(90);
    expect(r.samples.length).toBeLessThanOrEqual(101); // decimated to 10 Hz
    expect(r.focal35).toBe(24);
    expect(r.headingSource).toBe("course");
    const late = r.samples[r.samples.length - 1];
    expect(late.alt_m).toBeCloseTo(30.1, 3);
    expect(Math.abs(((late.heading_deg + 180) % 360) - 180)).toBeLessThan(3); // flying north
    expect(late.speed_mps).toBeGreaterThan(3);
    expect(late.gimbal_pitch_deg).toBe(-90);
  });

  it("reads Mini 2 logs (spaced colons, 'altitude', focal_len in tenths)", () => {
    const text = srt(150, 4, 270, (i, lat, lon) => `<font size="36">SrtCnt : ${i + 1}, DiffTime : 33ms\n2021-03-04 16:20:31,123,456\n[iso : 100] [shutter : 1/500.0] [fnum : 280] [ev : 0] [ct : 5340] [color_md : default] [focal_len : 240] [latitude: ${lat.toFixed(6)}] [longitude: ${lon.toFixed(6)}] [altitude: 12.300] </font>`);
    const r = parseDjiSrt(text, defaults);
    expect(r.focal35).toBe(24);
    expect(r.samples[r.samples.length - 1].alt_m).toBeCloseTo(12.3, 3);
    expect(r.samples[r.samples.length - 1].heading_deg).toBeCloseTo(270, 0);
  });

  it("reads Mavic 2 / Phantom 4 logs (GPS (lon, lat, n) and H height)", () => {
    const text = srt(90, 3, 90, (_, lat, lon) => `F/2.8, SS 1000, ISO 100, EV 0, DZOOM 1.000, GPS (${lon.toFixed(6)}, ${lat.toFixed(6)}, 19), D 4.32m, H 25.40m, H.S 3.00m/s, V.S 0.00m/s `);
    const r = parseDjiSrt(text, defaults);
    const s = r.samples[r.samples.length - 1];
    expect(s.lat).toBeCloseTo(22.54321, 3);
    expect(s.lon).toBeGreaterThan(113.958765);
    expect(s.alt_m).toBeCloseTo(25.4, 3);
    expect(s.heading_deg).toBeCloseTo(90, 0);
  });

  it("uses gimbal yaw and pitch when the log has them (enterprise models)", () => {
    const text = srt(60, 0, 0, (_, lat, lon) => `[latitude: ${lat}] [longitude: ${lon}] [rel_alt: 50.000 abs_alt: 150.000] [gb_yaw: 123.4 gb_pitch: -88.0 gb_roll: 0.0]`);
    const r = parseDjiSrt(text, defaults);
    expect(r.headingSource).toBe("gimbal");
    expect(r.samples[0].heading_deg).toBeCloseTo(123.4, 3);
    expect(r.samples[0].gimbal_pitch_deg).toBeCloseTo(-88, 3);
  });

  it("falls back to the operator's heading when hovering, and marks no-GPS entries", () => {
    const text = srt(30, 0, 0, (i, lat, lon) => `[latitude: ${i < 5 ? 0 : lat}] [longitude: ${i < 5 ? 0 : lon}] [rel_alt: 20.0 abs_alt: 90.0]`);
    const r = parseDjiSrt(text, { heading_deg: 45, gimbal_pitch_deg: -70 });
    expect(r.headingSource).toBe("default");
    expect(r.samples.every((s) => s.heading_deg === 45 && s.gimbal_pitch_deg === -70)).toBe(true);
    expect(r.samples[0].gps_fix).toBe(0);
    expect(r.samples[r.samples.length - 1].gps_fix).toBe(3);
  });

  it("rejects a log without positions with a clear reason", () => {
    expect(() => parseDjiSrt("1\n00:00:00,000 --> 00:00:00,033\n[iso: 100] [ev: 0]\n", defaults)).toThrow(TelemetryError);
  });
});

describe("CSV", () => {
  it("parses valid logs and fills optional columns", () => {
    const s = parseCsv("t,lat,lon,alt_m,heading_deg\n0,11.47,76.14,30,370\n0.2,11.47001,76.14,30.1,10\n");
    expect(s).toHaveLength(2);
    expect(s[0].heading_deg).toBe(10);
    expect([s[0].gimbal_pitch_deg, s[0].gps_fix, s[0].hdop]).toEqual([-90, 3, 1]);
  });

  it("reports every problem with its row number", () => {
    try {
      parseCsv("t,lat,lon,alt_m,heading_deg\n0,11.47,76.14,30,0\n0,11.47,76.14,30,0\n1,95,76.14,30,0\n2,11.47,76.14,-5,0\n3,abc,76.14,30,0");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as TelemetryError).errors).toEqual([
        "Row 3: timestamp 0 is not increasing", "Row 4: lat/lon out of range", "Row 5: alt_m -5 outside (0, 500) m", "Row 6: non-numeric value",
      ]);
    }
    expect(() => parseCsv("lat,lon\n1,2")).toThrow(/Missing required column/);
  });
});
