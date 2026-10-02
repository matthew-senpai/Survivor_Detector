"""Live telemetry from a PX4 / ArduPilot flight controller over MAVLink.

Connection strings (pymavlink): '/dev/ttyTHS1' (Jetson UART wired to FC TELEM2), 'COM5',
'udpin:0.0.0.0:14550' (telemetry radio / companion router). Produces the same TelemetrySample as
the CSV replay, timestamped on the same monotonic clock as the video source.
"""
import math
import threading
import time

from ..telemetry import TelemetrySample, TelemetryTrack


class TelemetrySourceError(RuntimeError):
    pass


class MavlinkTelemetrySource:
    def __init__(self, conn: str, baud: int = 921600, t0: float | None = None, rate_hz: int = 10):
        try:
            from pymavlink import mavutil
        except ImportError as e:
            raise TelemetrySourceError("pymavlink is not installed: `pip install pymavlink`") from e
        self.m = mavutil.mavlink_connection(conn, baud=baud)
        if self.m.wait_heartbeat(timeout=10) is None:
            raise TelemetrySourceError(f"No MAVLink heartbeat on '{conn}': check wiring, baud rate and SERIALx_PROTOCOL")
        self.m.mav.request_data_stream_send(self.m.target_system, self.m.target_component,
                                            mavutil.mavlink.MAV_DATA_STREAM_ALL, rate_hz, 1)
        self.t0 = t0 if t0 is not None else time.monotonic()
        self.track = TelemetryTrack([])
        self.state = {"gps_fix": 0, "sats": 0, "hdop": 99.0, "battery_pct": -1, "yaw_deg": 0.0, "agl_m": None}
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        types = ["GLOBAL_POSITION_INT", "GPS_RAW_INT", "SYS_STATUS", "ATTITUDE", "DISTANCE_SENSOR"]
        while True:
            msg = self.m.recv_match(type=types, blocking=True, timeout=1)
            if msg is None:
                continue
            k, s = msg.get_type(), self.state
            if k == "GPS_RAW_INT":
                s.update(gps_fix=msg.fix_type, sats=msg.satellites_visible, hdop=msg.eph / 100 if msg.eph != 65535 else 99.0)
            elif k == "SYS_STATUS":
                s["battery_pct"] = msg.battery_remaining
            elif k == "ATTITUDE":
                s["yaw_deg"] = math.degrees(msg.yaw) % 360
            elif k == "DISTANCE_SENSOR":  # downward rangefinder gives true height above ground, if fitted
                s["agl_m"] = msg.current_distance / 100
            elif k == "GLOBAL_POSITION_INT":
                alt = s["agl_m"] or msg.relative_alt / 1000  # fallback: height above home
                if alt <= 0:
                    continue
                self.track.append(TelemetrySample(
                    t=time.monotonic() - self.t0, lat=msg.lat / 1e7, lon=msg.lon / 1e7, alt_m=alt,
                    heading_deg=msg.hdg / 100 if msg.hdg != 65535 else s["yaw_deg"],
                    speed_mps=math.hypot(msg.vx, msg.vy) / 100, gps_fix=s["gps_fix"], sats=s["sats"],
                    hdop=s["hdop"], battery_pct=s["battery_pct"]))

    def at(self, t: float) -> TelemetrySample | None:
        return self.track.at(t)
