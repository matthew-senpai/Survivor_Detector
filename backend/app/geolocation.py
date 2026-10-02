"""Geolocation engine: image pixel + drone pose -> ground coordinate.

Replaceable by design: the pipeline only depends on the `Geolocator` protocol. The default
model is a flat-ground pinhole camera pointing straight down (nadir gimbal). Upgrades that slot
in behind the same interface: oblique gimbal angles, DEM/terrain ray-casting, RTK poses,
or photogrammetric (orthomosaic) registration.
"""
import math
from typing import Protocol

from .telemetry import TelemetrySample, heading_vectors

M_PER_DEG_LAT = 111_320.0


def offset_latlon(lat: float, lon: float, east_m: float, north_m: float) -> tuple[float, float]:
    return lat + north_m / M_PER_DEG_LAT, lon + east_m / (M_PER_DEG_LAT * math.cos(math.radians(lat)))


def to_local(lat: float, lon: float, origin: tuple[float, float]) -> tuple[float, float]:
    """(east_m, north_m) of a point relative to origin (equirectangular; fine at mission scale)."""
    lat0, lon0 = origin
    return (lon - lon0) * M_PER_DEG_LAT * math.cos(math.radians(lat0)), (lat - lat0) * M_PER_DEG_LAT


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    e, n = to_local(b[0], b[1], a)
    return math.hypot(e, n)


class Geolocator(Protocol):
    def locate(self, u: float, v: float, pose: TelemetrySample) -> tuple[float, float]: ...
    def gsd(self, pose: TelemetrySample) -> float: ...


class NadirPinholeGeolocator:
    def __init__(self, image_width: int, image_height: int, hfov_deg: float, **_):
        self.W, self.H = image_width, image_height
        self.tan_half = math.tan(math.radians(hfov_deg) / 2)

    def gsd(self, pose: TelemetrySample) -> float:
        """Ground sample distance (metres per pixel)."""
        return 2 * pose.alt_m * self.tan_half / self.W

    def footprint_m(self, pose: TelemetrySample) -> tuple[float, float]:
        g = self.gsd(pose)
        return self.W * g, self.H * g

    def pixel_to_offset(self, u: float, v: float, pose: TelemetrySample) -> tuple[float, float]:
        g = self.gsd(pose)
        right_m, fwd_m = (u - self.W / 2) * g, -(v - self.H / 2) * g
        (fe, fn), (re, rn) = heading_vectors(pose.heading_deg)
        return right_m * re + fwd_m * fe, right_m * rn + fwd_m * fn

    def locate(self, u: float, v: float, pose: TelemetrySample) -> tuple[float, float]:
        east, north = self.pixel_to_offset(u, v, pose)
        return offset_latlon(pose.lat, pose.lon, east, north)

    def project(self, east_m: float, north_m: float, pose_e: float, pose_n: float, pose: TelemetrySample):
        """Inverse: local ground point -> pixel (used by the simulator and coverage maths)."""
        g = self.gsd(pose)
        de, dn = east_m - pose_e, north_m - pose_n
        (fe, fn), (re, rn) = heading_vectors(pose.heading_deg)
        return self.W / 2 + (de * re + dn * rn) / g, self.H / 2 - (de * fe + dn * fn) / g
