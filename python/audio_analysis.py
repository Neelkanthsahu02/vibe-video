#!/usr/bin/env python3
"""Audio analysis: extracts narration vs music characteristics, energy curve,
music change points, and rough mood/intensity tags.

Designed to be cheap and deterministic — feeds higher-level beat building.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import librosa


def analyze(audio_path: str, hop_seconds: float = 1.0) -> dict:
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))
    hop_length = int(sr * hop_seconds)
    frame_length = hop_length * 2

    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length).tolist()

    # Spectral centroid -> brightness proxy (music vs. speech)
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop_length)[0]
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, hop_length=hop_length, roll_percent=0.85)[0]
    zcr = librosa.feature.zero_crossing_rate(y, frame_length=frame_length, hop_length=hop_length)[0]

    # Tempo / beat strength as a music-presence heuristic
    try:
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length)
        tempo = float(tempo)
    except Exception:
        tempo = 0.0

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    # Smooth and find significant change points (music intensity changes)
    if len(onset_env) > 4:
        smooth = np.convolve(onset_env, np.ones(5) / 5, mode="same")
        diff = np.abs(np.diff(smooth))
        thresh = np.percentile(diff, 95)
        change_idxs = np.where(diff > thresh)[0]
        change_times = librosa.frames_to_time(change_idxs, sr=sr, hop_length=hop_length).tolist()
    else:
        change_times = []

    # Heuristic mood tagging from low/high band energy ratio + tempo
    S = np.abs(librosa.stft(y, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr)
    low_mask = freqs < 250
    high_mask = freqs > 4000
    low_e = S[low_mask].mean()
    high_e = S[high_mask].mean()
    if high_e == 0:
        ratio = 0.0
    else:
        ratio = float(low_e / high_e)

    if tempo < 70 and ratio > 1.2:
        mood = "sad_emotional"
    elif tempo < 90:
        mood = "tense_documentary"
    elif tempo < 115:
        mood = "neutral_narrative"
    else:
        mood = "energetic_reveal"

    # Intensity curve: normalized RMS bucketed
    if rms.max() > 0:
        norm = rms / rms.max()
    else:
        norm = rms
    intensity_curve = [
        {"t": float(times[i]), "intensity": float(norm[i])}
        for i in range(len(norm))
    ]

    return {
        "audio": audio_path,
        "sample_rate": int(sr),
        "duration": duration,
        "tempo_bpm": tempo,
        "mood_guess": mood,
        "low_high_energy_ratio": ratio,
        "intensity_curve": intensity_curve,
        "music_change_points": change_times,
        "spectral_centroid_mean": float(np.mean(centroid)),
        "spectral_rolloff_mean": float(np.mean(rolloff)),
        "zero_crossing_rate_mean": float(np.mean(zcr)),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", help="Path to extracted audio (wav/mp3)")
    ap.add_argument("--hop-seconds", type=float, default=1.0)
    ap.add_argument("--out", type=str, default="-")
    args = ap.parse_args()
    if not Path(args.audio).exists():
        print(f"Audio not found: {args.audio}", file=sys.stderr)
        return 2
    result = analyze(args.audio, args.hop_seconds)
    payload = json.dumps(result, indent=2)
    if args.out == "-":
        sys.stdout.write(payload)
    else:
        Path(args.out).write_text(payload, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
