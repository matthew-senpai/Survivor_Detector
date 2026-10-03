// Video inputs. Live: a camera / HDMI-USB capture card fed by the drone controller, or screen capture of the
// pilot app (DJI Fly, QGroundControl). Recorded: a video file, or the bundled public-domain sample clip.

export type VideoKind = "camera" | "screen" | "file" | "sample";
export interface VideoChoice { kind: VideoKind; label: string; stream?: MediaStream; url?: string; file?: File }

/** Public-domain (CC0) drone footage: ice climbers filmed from above in Tromsø, Norway (Thomas Tapp, Wikimedia Commons). */
export const SAMPLE_CLIP = {
  url: "https://upload.wikimedia.org/wikipedia/commons/transcoded/f/f6/Drone_Footage_of_People_Climbing_Ice_Formation.webm/Drone_Footage_of_People_Climbing_Ice_Formation.webm.720p.vp9.webm",
  page: "https://commons.wikimedia.org/wiki/File:Drone_Footage_of_People_Climbing_Ice_Formation.webm",
  credit: "Thomas Tapp · CC0 · Wikimedia Commons",
  start: 30, // people appear from ~30 s
};

export const isLive = (k: VideoKind) => k === "camera" || k === "screen";

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
}

export async function openCamera(deviceId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't access cameras (needs HTTPS and a modern browser).");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
    });
  } catch (e) {
    const n = (e as DOMException).name;
    if (n === "NotAllowedError") throw new Error("Camera permission was denied. Allow camera access for this site and try again.");
    if (n === "NotFoundError" || n === "OverconstrainedError") throw new Error("Camera unavailable: no matching video device. Is the capture card plugged in?");
    if (n === "NotReadableError") throw new Error("Camera is busy: close other apps using the capture device.");
    throw e;
  }
}

export async function openScreen(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen capture isn't supported in this browser.");
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
  } catch (e) {
    if ((e as DOMException).name === "NotAllowedError") throw new Error("Screen capture was cancelled.");
    throw e;
  }
}

export function stopStream(s?: MediaStream) {
  s?.getTracks().forEach((t) => t.stop());
}

/** Wait until a video element has decodable frames (with a timeout and readable errors). */
export function videoReady(v: HTMLVideoElement, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (v.readyState >= 2 && v.videoWidth) return resolve();
    const done = (err?: Error) => { clearTimeout(timer); v.removeEventListener("loadeddata", ok); v.removeEventListener("error", bad); err ? reject(err) : resolve(); };
    const ok = () => done();
    const bad = () => done(new Error(v.error?.code === 4 ? "This video format can't be decoded by the browser (try MP4/H.264 or WebM)." : "Video failed to load."));
    const timer = setTimeout(() => done(new Error("Video didn't start within 20 s (no signal from the source?).")), timeoutMs);
    v.addEventListener("loadeddata", ok);
    v.addEventListener("error", bad);
  });
}
