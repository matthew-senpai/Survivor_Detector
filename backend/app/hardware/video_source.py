"""Video input: a recorded file (prototype upload) or a live camera (deployment).

src may be a file path, an RTSP/UDP URL (gimbal camera / video downlink), a GStreamer pipeline string
(Jetson CSI camera), or a device index (USB/HDMI capture card). Frames are resampled to the
pipeline rate (config processing.fps) so inference load is fixed regardless of camera fps.
"""
import os
import time


class VideoSourceError(RuntimeError):
    pass


class OpenCVVideoSource:
    def __init__(self, src: str, target_fps: float, t0: float | None = None):
        try:
            import cv2
        except ImportError as e:
            raise VideoSourceError("OpenCV is not installed: `pip install opencv-python`") from e
        self.cv2 = cv2
        self.live = not os.path.isfile(str(src))
        api = cv2.CAP_GSTREAMER if str(src).startswith(("nvarguscamerasrc", "v4l2src", "rtspsrc")) else cv2.CAP_ANY
        self.cap = cv2.VideoCapture(int(src) if str(src).isdigit() else src, api)
        if not self.cap.isOpened():
            raise VideoSourceError(f"Camera/video unavailable: could not open '{src}'")
        self.src_fps = self.cap.get(cv2.CAP_PROP_FPS) or 30.0
        self.size = (int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
        self.target_fps = target_fps
        self.t0 = t0 if t0 is not None else time.monotonic()
        n = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.total_frames = None if self.live else int(n / self.src_fps * target_fps)

    def frames(self):
        """Yields (frame_idx, t_seconds, bgr_ndarray) at the target rate."""
        idx, next_t = 0, 0.0
        while True:
            ok, frame = self.cap.read()
            if not ok:
                if self.live:
                    raise VideoSourceError("Camera stream lost")
                return
            t = (time.monotonic() - self.t0) if self.live else self.cap.get(self.cv2.CAP_PROP_POS_MSEC) / 1000
            if t + 1e-6 < next_t:
                continue
            yield idx, t, frame
            idx += 1
            next_t = idx / self.target_fps
