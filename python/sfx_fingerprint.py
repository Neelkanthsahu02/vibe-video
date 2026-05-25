#!/usr/bin/env python3
"""SFX fingerprint match.

Builds chroma/MFCC-based fingerprints for every audio file in an SFX pack,
then slides each fingerprint across the target audio and reports the best
matching timestamps and confidence per SFX.

This is intentionally a classical DSP matcher — no model dependency — and
returns a confidence score so the caller can defer uncertain matches.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Dict

import numpy as np
import librosa


SR = 22050
HOP = 512
N_MFCC = 20


def fingerprint(y: np.ndarray, sr: int = SR) -> np.ndarray:
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=N_MFCC, hop_length=HOP)
    # Normalize each frame
    norms = np.linalg.norm(mfcc, axis=0, keepdims=True) + 1e-9
    return mfcc / norms


def load_audio(path: str) -> np.ndarray:
    y, _ = librosa.load(path, sr=SR, mono=True)
    return y


def best_match(target_fp: np.ndarray, query_fp: np.ndarray) -> Dict:
    """Slide query across target, return best alignment offset + score."""
    tlen = target_fp.shape[1]
    qlen = query_fp.shape[1]
    if qlen >= tlen:
        return {"score": 0.0, "frame_offset": 0}
    # Cross-correlation per coefficient, summed.
    # Use cosine similarity at each offset via dot product of unit columns.
    best_score = -1.0
    best_off = 0
    step = max(1, qlen // 8)  # coarse pass
    for off in range(0, tlen - qlen, step):
        window = target_fp[:, off:off + qlen]
        # Normalize per frame to compare directionally
        wn = np.linalg.norm(window, axis=0, keepdims=True) + 1e-9
        cs = float(np.mean(np.sum(window / wn * query_fp, axis=0)))
        if cs > best_score:
            best_score = cs
            best_off = off
    # Refine around best with fine pass
    lo = max(0, best_off - step)
    hi = min(tlen - qlen, best_off + step)
    for off in range(lo, hi + 1):
        window = target_fp[:, off:off + qlen]
        wn = np.linalg.norm(window, axis=0, keepdims=True) + 1e-9
        cs = float(np.mean(np.sum(window / wn * query_fp, axis=0)))
        if cs > best_score:
            best_score = cs
            best_off = off
    return {"score": best_score, "frame_offset": best_off}


def match_pack(target_audio: str, sfx_pack_dir: str,
               score_threshold: float = 0.45,
               max_matches_per_sfx: int = 8) -> Dict:
    target_y = load_audio(target_audio)
    target_fp = fingerprint(target_y)
    target_duration = librosa.get_duration(y=target_y, sr=SR)

    pack = Path(sfx_pack_dir)
    exts = {".wav", ".mp3", ".aiff", ".flac", ".ogg", ".m4a"}
    sfx_files = sorted([p for p in pack.rglob("*") if p.suffix.lower() in exts])

    results: List[Dict] = []
    for sfx in sfx_files:
        try:
            q_y = load_audio(str(sfx))
            if len(q_y) < SR * 0.05:
                continue
            q_fp = fingerprint(q_y)
            q_duration = librosa.get_duration(y=q_y, sr=SR)

            # Multi-match: repeatedly find best, mask, re-search
            target_fp_work = target_fp.copy()
            matches: List[Dict] = []
            for _ in range(max_matches_per_sfx):
                m = best_match(target_fp_work, q_fp)
                if m["score"] < score_threshold:
                    break
                t_off_sec = m["frame_offset"] * HOP / SR
                matches.append({
                    "timestamp": float(t_off_sec),
                    "duration": float(q_duration),
                    "confidence": float(m["score"]),
                })
                # Mask the matched region so the next pass finds the next-best
                qlen = q_fp.shape[1]
                target_fp_work[:, m["frame_offset"]:m["frame_offset"] + qlen] = 0

            if matches:
                results.append({
                    "sfx": str(sfx),
                    "sfx_filename": sfx.name,
                    "matches": matches,
                })
        except Exception as e:
            print(f"[sfx_fingerprint] skip {sfx}: {e}", file=sys.stderr)

    return {
        "target": target_audio,
        "target_duration": float(target_duration),
        "pack_dir": str(sfx_pack_dir),
        "threshold": score_threshold,
        "results": results,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="Target audio (extracted from video)")
    ap.add_argument("--pack", required=True, help="SFX pack directory")
    ap.add_argument("--threshold", type=float, default=0.45)
    ap.add_argument("--max-matches", type=int, default=8)
    ap.add_argument("--out", type=str, default="-")
    args = ap.parse_args()
    if not Path(args.target).exists():
        print(f"Target audio not found: {args.target}", file=sys.stderr)
        return 2
    if not Path(args.pack).exists():
        # Allow empty pack — still emit valid JSON
        result = {
            "target": args.target,
            "pack_dir": args.pack,
            "threshold": args.threshold,
            "results": [],
            "note": "pack_dir not found — returning empty",
        }
    else:
        result = match_pack(args.target, args.pack, args.threshold, args.max_matches)
    payload = json.dumps(result, indent=2)
    if args.out == "-":
        sys.stdout.write(payload)
    else:
        Path(args.out).write_text(payload, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
