#!/usr/bin/env python3
"""Scene/shot detection using PySceneDetect.

Emits a JSON document on stdout:
{
  "video": "path",
  "fps": 30.0,
  "frame_count": 12345,
  "duration": 411.5,
  "threshold": 27.0,
  "scenes": [{"index": 0, "start": 0.0, "end": 3.21, "duration": 3.21,
              "start_frame": 0, "end_frame": 96}, ...]
}
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from scenedetect import open_video, SceneManager
from scenedetect.detectors import ContentDetector


def detect(video_path: str, threshold: float, min_scene_len: int) -> dict:
    video = open_video(video_path)
    sm = SceneManager()
    sm.add_detector(ContentDetector(threshold=threshold, min_scene_len=min_scene_len))
    sm.detect_scenes(video=video, show_progress=False)
    scene_list = sm.get_scene_list()
    fps = video.frame_rate
    frame_count = video.duration.get_frames() if video.duration else 0
    duration = frame_count / fps if fps else 0.0

    scenes = []
    if not scene_list:
        # Fallback: entire video as one scene
        scenes.append({
            "index": 0,
            "start": 0.0,
            "end": duration,
            "duration": duration,
            "start_frame": 0,
            "end_frame": frame_count,
        })
    else:
        for i, (start, end) in enumerate(scene_list):
            scenes.append({
                "index": i,
                "start": start.get_seconds(),
                "end": end.get_seconds(),
                "duration": end.get_seconds() - start.get_seconds(),
                "start_frame": start.get_frames(),
                "end_frame": end.get_frames(),
            })

    return {
        "video": video_path,
        "fps": fps,
        "frame_count": frame_count,
        "duration": duration,
        "threshold": threshold,
        "min_scene_len": min_scene_len,
        "scenes": scenes,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", help="Path to input video")
    ap.add_argument("--threshold", type=float, default=27.0)
    ap.add_argument("--min-scene-len", type=int, default=8,
                    help="Minimum scene length in frames")
    ap.add_argument("--out", type=str, default="-",
                    help="Output JSON path or '-' for stdout")
    args = ap.parse_args()

    if not Path(args.video).exists():
        print(f"Video not found: {args.video}", file=sys.stderr)
        return 2

    result = detect(args.video, args.threshold, args.min_scene_len)
    payload = json.dumps(result, indent=2)
    if args.out == "-":
        sys.stdout.write(payload)
    else:
        Path(args.out).write_text(payload, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
