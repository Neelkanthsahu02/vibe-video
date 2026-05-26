#!/usr/bin/env python3
"""Transcribe a voiceover audio file with word-level timestamps using
faster-whisper.

Local-first: model files cache to ~/.cache/huggingface or the path set via
the WHISPER_CACHE env var. CPU is the default; GPU users can pass
--device cuda.

Output schema:
{
  "audio": "...",
  "language": "en",
  "duration": 412.5,
  "model": "small",
  "words": [
    {"text": "and", "start": 1.21, "end": 1.34, "probability": 0.92}, ...
  ],
  "segments": [
    {"id": 0, "start": 0.0, "end": 4.21, "text": "..."}
  ]
}
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import List, Dict

try:
    from faster_whisper import WhisperModel
except ImportError as e:
    print(
        "faster-whisper is required. pip install faster-whisper",
        file=sys.stderr,
    )
    raise


def transcribe(
    audio_path: str,
    model_size: str,
    device: str,
    compute_type: str,
    language: str | None,
) -> Dict:
    cache_dir = os.environ.get("WHISPER_CACHE")
    model = WhisperModel(
        model_size,
        device=device,
        compute_type=compute_type,
        download_root=cache_dir,
    )

    segments_iter, info = model.transcribe(
        audio_path,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        language=language,
    )

    segments: List[Dict] = []
    words: List[Dict] = []
    for seg in segments_iter:
        seg_dict = {
            "id": seg.id,
            "start": float(seg.start),
            "end": float(seg.end),
            "text": seg.text.strip(),
        }
        segments.append(seg_dict)
        if seg.words:
            for w in seg.words:
                words.append({
                    "text": w.word.strip(),
                    "start": float(w.start),
                    "end": float(w.end),
                    "probability": float(w.probability) if w.probability is not None else 0.0,
                })

    return {
        "audio": audio_path,
        "language": info.language,
        "language_probability": float(info.language_probability),
        "duration": float(info.duration),
        "model": model_size,
        "words": words,
        "segments": segments,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", help="Path to voiceover audio (wav/mp3/m4a)")
    ap.add_argument(
        "--model",
        default=os.environ.get("WHISPER_MODEL", "small"),
        help="faster-whisper model size: tiny|base|small|medium|large-v3",
    )
    ap.add_argument("--device", default=os.environ.get("WHISPER_DEVICE", "cpu"))
    ap.add_argument(
        "--compute-type",
        default=os.environ.get("WHISPER_COMPUTE", "int8"),
        help="int8|int8_float16|float16|float32",
    )
    ap.add_argument("--language", default=os.environ.get("WHISPER_LANG"))
    ap.add_argument("--out", type=str, default="-")
    args = ap.parse_args()

    if not Path(args.audio).exists():
        print(f"Audio not found: {args.audio}", file=sys.stderr)
        return 2

    result = transcribe(
        args.audio,
        args.model,
        args.device,
        args.compute_type,
        args.language,
    )
    payload = json.dumps(result, indent=2)
    if args.out == "-":
        sys.stdout.write(payload)
    else:
        Path(args.out).write_text(payload, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
