import { runPython } from "../utils/python.js";
import { fileExists, readJson, writeJson } from "../utils/paths.js";
import type { TransitionType } from "../schemas/videoAnalysis.js";

export interface RawTransitionResult {
  video: string;
  fps: number;
  transitions: Array<{
    at: number;
    scene_index: number;
    duration_frames: number;
    type: string;
    confidence: number;
    reason: string;
  }>;
}

export async function detectTransitions(
  videoPath: string,
  sceneCacheFile: string,
  cacheFile: string,
): Promise<RawTransitionResult> {
  if (await fileExists(cacheFile)) {
    return readJson<RawTransitionResult>(cacheFile);
  }
  const result = await runPython<RawTransitionResult>("transition_detect.py", [
    videoPath,
    "--scenes",
    sceneCacheFile,
  ]);
  await writeJson(cacheFile, result);
  return result;
}

const VALID: ReadonlySet<TransitionType> = new Set<TransitionType>([
  "hard_cut",
  "flash",
  "fade_to_black",
  "fade_from_black",
  "fade_to_white",
  "fade_from_white",
  "zoom_blur",
  "motion_blur",
  "wipe",
  "glitch",
  "light_leak",
  "dissolve",
  "overlay",
  "unknown",
]);

export function normalizeTransitionType(t: string): TransitionType {
  return VALID.has(t as TransitionType) ? (t as TransitionType) : "unknown";
}
