"""Fine-tune the person detector on aerial imagery, for small people seen from altitude.

The stock YOLO11n (COCO) finds clearly visible people from a drone but misses tiny, straight-down
figures. Fine-tuning on aerial data such as VisDrone (drone footage; "pedestrian" and "people" classes) is the
standard way to improve that (not benchmarked in this repo: measure on your own footage).
Run on a machine with an NVIDIA GPU (or Google Colab); on CPU it would take days.

  pip install ultralytics
  python backend/scripts/train_aerial.py --epochs 80 --imgsz 960

Ultralytics downloads VisDrone (~2 GB) automatically. Output: runs/detect/<name>/weights/best.onnx.
Load it in Landsight Field with "Custom model (.onnx)" and set "Person class ids" to: 0, 1
(VisDrone: 0 = pedestrian, 1 = people). For search-and-rescue imagery, add SARD or HERIDAL
data in YOLO format and point --data at your own dataset YAML.

Licence: YOLO11 weights and their fine-tunes are AGPL-3.0 (Ultralytics); commercial use needs their licence.
"""
import argparse

from ultralytics import YOLO

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--data", default="VisDrone.yaml", help="dataset YAML (default: VisDrone, auto-download)")
ap.add_argument("--classes", default="0,1", help="class ids to train on (VisDrone pedestrian, people)")
ap.add_argument("--epochs", type=int, default=80)
ap.add_argument("--imgsz", type=int, default=960, help="larger keeps small people visible; the web app reads this from the model")
ap.add_argument("--batch", type=int, default=16)
ap.add_argument("--name", default="landsight-aerial")
a = ap.parse_args()

model = YOLO("yolo11n.pt")
model.train(data=a.data, classes=[int(c) for c in a.classes.split(",")], epochs=a.epochs, imgsz=a.imgsz,
            batch=a.batch, name=a.name, close_mosaic=10, patience=20)
metrics = model.val(data=a.data, imgsz=a.imgsz)
print(f"mAP50 (person classes): {metrics.box.map50:.3f}")
print(model.export(format="onnx", imgsz=a.imgsz, opset=17, simplify=True, dynamic=False))
