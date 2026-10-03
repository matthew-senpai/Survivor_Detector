"""MAVLink -> WebSocket bridge for Landsight Field (the browser can't open UDP sockets).

Relays raw MAVLink bytes, unmodified, to every connected browser tab. Read-only: nothing is sent to the aircraft.

  python mavlink_ws_bridge.py --udp 14550              # QGroundControl / MAVProxy / mavlink-router forwarding
  python mavlink_ws_bridge.py --serial COM5 --baud 57600
  python mavlink_ws_bridge.py --simulate --lat 11.4762 --lon 76.1428   # labelled SIMULATED flight, for testing

Then in Landsight Field choose "MAVLink · WebSocket" with ws://localhost:8765.
Requires: pip install websockets pymavlink (pyserial for --serial).
"""
import argparse
import asyncio
import math
import time

import websockets

clients: set = set()


async def broadcast(data: bytes):
    for ws in list(clients):
        try:
            await ws.send(data)
        except websockets.ConnectionClosed:
            clients.discard(ws)


async def handler(ws):
    clients.add(ws)
    print(f"browser connected ({len(clients)})")
    try:
        await ws.wait_closed()
    finally:
        clients.discard(ws)


class UdpRelay(asyncio.DatagramProtocol):
    def datagram_received(self, data, addr):
        asyncio.ensure_future(broadcast(data))


async def serial_source(port: str, baud: int):
    import serial  # pyserial
    ser = serial.Serial(port, baud, timeout=0)
    while True:
        chunk = ser.read(4096)
        if chunk:
            await broadcast(chunk)
        await asyncio.sleep(0.01)


async def simulate(lat0: float, lon0: float, alt: float):
    """Lawnmower survey around (lat0, lon0). Every packet is from a SIMULATED vehicle and says so."""
    from pymavlink.dialects.v20 import common as mav

    class Sink:
        def write(self, b):
            pass

    link = mav.MAVLink(Sink(), srcSystem=1, srcComponent=1)
    pack = lambda m: m.pack(link)
    t0, last_text = time.monotonic(), -10.0
    m_lat = 111320.0
    m_lon = 111320.0 * math.cos(math.radians(lat0))
    lanes, length, spacing, speed = 4, 120.0, 25.0, 5.0
    path_len = lanes * length + (lanes - 1) * spacing
    while True:
        t = time.monotonic() - t0
        s = (t * speed) % path_len
        lane, pos = divmod(s, length + spacing)
        lane = int(lane)
        if pos < length:
            x = pos if lane % 2 == 0 else length - pos
            y, hdg = lane * spacing, 90.0 if lane % 2 == 0 else 270.0
        else:
            x, y, hdg = (length if lane % 2 == 0 else 0.0), lane * spacing + (pos - length), 0.0
        lat, lon = lat0 + y / m_lat, lon0 + x / m_lon
        boot = int(t * 1000)
        out = [
            pack(link.heartbeat_encode(type=2, autopilot=3, base_mode=81, custom_mode=3, system_status=4)),
            pack(link.gps_raw_int_encode(int(t * 1e6), 3, int(lat * 1e7), int(lon * 1e7), int((alt + 100) * 1000), 90, 140, int(speed * 100), int(hdg * 100), 14)),
            pack(link.sys_status_encode(1, 1, 1, 200, 15800, 1200, max(0, 95 - int(t / 30)), 0, 0, 0, 0, 0, 0)),
            pack(link.mount_orientation_encode(boot, 0.0, -90.0, 0.0, hdg)),
            pack(link.global_position_int_encode(boot, int(lat * 1e7), int(lon * 1e7), int((alt + 100) * 1000), int(alt * 1000),
                                                 int(speed * 100 * math.cos(math.radians(hdg))), int(speed * 100 * math.sin(math.radians(hdg))), 0, int(hdg * 100))),  # vx north, vy east
        ]
        if t - last_text > 5:
            out.append(pack(link.statustext_encode(4, b"LANDSIGHT SIMULATED TELEMETRY")))
            last_text = t
        await broadcast(b"".join(out))
        await asyncio.sleep(0.1)  # 10 Hz


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--udp", type=int, help="listen for MAVLink on this UDP port")
    src.add_argument("--serial", help="read MAVLink from this serial port")
    src.add_argument("--simulate", action="store_true", help="stream a labelled simulated flight")
    ap.add_argument("--baud", type=int, default=57600)
    ap.add_argument("--lat", type=float, default=11.4762)
    ap.add_argument("--lon", type=float, default=76.1428)
    ap.add_argument("--alt", type=float, default=30.0)
    ap.add_argument("--host", default="localhost", help="use 0.0.0.0 to serve other machines on the network")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()

    async with websockets.serve(handler, a.host, a.port, max_size=None):
        print(f"bridge on ws://{a.host}:{a.port}")
        if a.udp:
            await asyncio.get_running_loop().create_datagram_endpoint(UdpRelay, local_addr=("0.0.0.0", a.udp))
            print(f"relaying UDP :{a.udp}")
            await asyncio.Future()
        elif a.serial:
            await serial_source(a.serial, a.baud)
        else:
            print("streaming SIMULATED telemetry")
            await simulate(a.lat, a.lon, a.alt)


if __name__ == "__main__":
    asyncio.run(main())
