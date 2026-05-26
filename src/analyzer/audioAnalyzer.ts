import { runPython } from "../utils/python.js";
import { fileExists, readJson, writeJson } from "../utils/paths.js";

export interface AudioAnalysisResult {
  audio: string;
  sample_rate: number;
  duration: number;
  tempo_bpm: number;
  mood_guess: string;
  low_high_energy_ratio: number;
  intensity_curve: Array<{ t: number; intensity: number }>;
  music_change_points: number[];
  spectral_centroid_mean: number;
  spectral_rolloff_mean: number;
  zero_crossing_rate_mean: number;
}

export async function analyzeAudio(
  audioPath: string,
  cacheFile: string,
  hopSeconds = 1.0,
): Promise<AudioAnalysisResult> {
  if (await fileExists(cacheFile)) {
    return readJson<AudioAnalysisResult>(cacheFile);
  }
  const result = await runPython<AudioAnalysisResult>("audio_analysis.py", [
    audioPath,
    "--hop-seconds",
    String(hopSeconds),
  ]);
  await writeJson(cacheFile, result);
  return result;
}

export interface SfxFingerprintResult {
  target: string;
  target_duration?: number;
  pack_dir: string;
  threshold: number;
  results: Array<{
    sfx: string;
    sfx_filename: string;
    matches: Array<{
      timestamp: number;
      duration: number;
      confidence: number;
    }>;
  }>;
  note?: string;
}

export async function matchSfxPack(
  audioPath: string,
  packDir: string,
  cacheFile: string,
  threshold = 0.45,
  maxMatches = 8,
): Promise<SfxFingerprintResult> {
  if (await fileExists(cacheFile)) {
    return readJson<SfxFingerprintResult>(cacheFile);
  }
  const result = await runPython<SfxFingerprintResult>("sfx_fingerprint.py", [
    audioPath,
    "--pack",
    packDir,
    "--threshold",
    String(threshold),
    "--max-matches",
    String(maxMatches),
  ]);
  await writeJson(cacheFile, result);
  return result;
}
