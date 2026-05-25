#!/usr/bin/env python3
"""Transition heuristics around scene-cut boundaries.

Reads scene boundaries (from scene_detect.py) and analyses a small frame
window on each side of every cut to classify the transition style as one of:

  hard_cut, flash, fade_to_black, fade_to_white,
  zoom_blur, motion_blur, wipe, glitch, light_leak, dissolve

Outputs:
{
  "video": "...",
  "transitions": [
    {"at": 12.34, "type": "flash", "duration_frames": 3,
     "confidence": 0.71, "reason": "brightness spike + low edge"},
    ...
  ]
}
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Dict

import cv2
import numpy as np


WINDOW = 6  # frames either side of a cut


def frame_stats(frame: np.ndarray) -> Dict:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h, s, v = cv2.split(cv2.cvtColor(frame, cv2.COLOR_BGR2HSV))
    edges = cv2.Canny(gray, 80, 160)
    blur = cv2.Laplacian(gray, cv2.CV_64F).var()
    return {
        "brightness": float(np.mean(v)),
        "saturation": float(np.mean(s)),
        "edge_density": float(np.mean(edges > 0)),
        "blur_score": float(blur),  # low = blurry
        "mean_color": [float(np.mean(frame[:, :, 0])),
                       float(np.mean(frame[:, :, 1])),
                       float(np.mean(frame[:, :, 2]))],
    }


def classify(left: List[Dict], right: List[Dict]) -> Dict:
    if not left or not right:
        return {"type": "hard_cut", "confidence": 0.4,
                "reason": "no surrounding frames"}

    lb = np.mean([s["brightness"] for s in left])
    rb = np.mean([s["brightness"] for s in right])
    peak = max(s["brightness"] for s in left + right)
    trough = min(s["brightness"] for s in left + right)
    edge_min = min(s["edge_density"] for s in left + right)
    blur_min = min(s["blur_score"] for s in left + right)
    sat_min = min(s["saturation"] for s in left + right)

    # Flash: very high brightness spike with low edges (washed-out white frame)
    if peak > 230 and edge_min < 0.05:
        return {"type": "flash", "confidence": 0.78,
                "reason": f"brightness peak {peak:.0f}, edges {edge_min:.3f}"}

    # Fade to/from black
    if trough < 18 and abs(lb - rb) > 60:
        kind = "fade_to_black" if lb > rb else "fade_from_black"
        return {"type": kind, "confidence": 0.7,
                "reason": f"trough {trough:.0f}, delta {abs(lb-rb):.0f}"}

    # Fade to/from white
    if peak > 240 and abs(lb - rb) > 60 and sat_min < 25:
        kind = "fade_to_white" if rb > lb else "fade_from_white"
        return {"type": kind, "confidence": 0.65,
                "reason": f"peak {peak:.0f}, low saturation"}

    # Zoom/motion blur transition: very low blur score (high actual blur)
    if blur_min < 25:
        return {"type": "zoom_blur", "confidence": 0.6,
                "reason": f"laplacian_var min {blur_min:.1f}"}

    # Big colour shift with mid edges -> dissolve/wipe-ish
    lc = np.array([np.mean([s["mean_color"][i] for s in left]) for i in range(3)])
    rc = np.array([np.mean([s["mean_color"][i] for s in right]) for i in range(3)])
    color_delta = float(np.linalg.norm(lc - rc))
    if color_delta > 80 and 0.05 < edge_min < 0.18:
        return {"type": "dissolve", "confidence": 0.55,
                "reason": f"color delta {color_delta:.0f}"}

    # Saturation spike -> light leak
    sat_peak = max(s["saturation"] for s in left + right)
    if sat_peak > 200:
        return {"type": "light_leak", "confidence": 0.5,
                "reason": f"sat peak {sat_peak:.0f}"}

    return {"type": "hard_cut", "confidence": 0.85,
            "reason": "no transition fingerprint detected"}


def analyze(video_path: str, scenes: List[Dict]) -> Dict:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    transitions: List[Dict] = []
    # Each scene boundary == cut at scene.start_frame for index > 0
    for sc in scenes:
        idx = sc.get("index", 0)
        if idx == 0:
            continue
        cut_frame = int(sc["start_frame"])
        lo = max(0, cut_frame - WINDOW)
        hi = min(total - 1, cut_frame + WINDOW)

        left_stats = []
        right_stats = []
        cap.set(cv2.CAP_PROP_POS_FRAMES, lo)
        for f in range(lo, hi + 1):
            ok, frame = cap.read()
            if not ok:
                break
            stats = frame_stats(frame)
            (left_stats if f < cut_frame else right_stats).append(stats)

        cls = classify(left_stats, right_stats)
        transitions.append({
            "at": float(cut_frame / fps),
            "scene_index": idx,
            "duration_frames": min(WINDOW * 2, hi - lo + 1),
            "type": cls["type"],
            "confidence": cls["confidence"],
            "reason": cls["reason"],
        })

    cap.release()
    return {
        "video": video_path,
        "fps": fps,
        "transitions": transitions,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--scenes", required=True,
                    help="Path to scene_detect.py output JSON")
    ap.add_argument("--out", type=str, default="-")
    args = ap.parse_args()
    scenes_doc = json.loads(Path(args.scenes).read_text(encoding="utf-8"))
    result = analyze(args.video, scenes_doc.get("scenes", []))
    payload = json.dumps(result, indent=2)
    if args.out == "-":
        sys.stdout.write(payload)
    else:
        Path(args.out).write_text(payload, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
