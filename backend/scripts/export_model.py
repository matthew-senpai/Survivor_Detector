"""Export the person detector used by the Landsight Field web app (in-browser inference).

Downloads the official Ultralytics YOLO11n weights and exports a static 640x640 ONNX graph
(opset 17, simplified), which onnxruntime-web runs on WebGPU or WASM.

  cd <work dir>  &&  python backend/scripts/export_model.py [imgsz]   # writes yolo11n.onnx in the cwd

Licence note: YOLO11 weights are AGPL-3.0 (Ultralytics). Commercial use needs an Ultralytics licence.
"""
import sys

from ultralytics import YOLO

imgsz = int(sys.argv[1]) if len(sys.argv) > 1 else 640
path = YOLO("yolo11n.pt").export(format="onnx", imgsz=imgsz, opset=17, simplify=True, dynamic=False)
print(path)
