import { runPython } from "../utils/python.js";
import { config } from "../config.js";
import { fileExists, writeJson, readJson } from "../utils/paths.js";

export interface RawScene {
  index: number;
  start: number;
  end: number;
  duration: number;
  start_frame: number;
  end_frame: number;
}

export interface SceneDetectResult {
  video: string;
  fps: number;
  frame_count: number;
  duration: number;
  threshold: number;
  min_scene_len: number;
  scenes: RawScene[];
}

export async function detectScenes(
  videoPath: string,
  cacheFile: string,
  threshold = config.tuning.sceneDetectThreshold,
  minSceneLen = 8,
): Promise<SceneDetectResult> {
  if (await fileExists(cacheFile)) {
    return readJson<SceneDetectResult>(cacheFile);
  }
  const result = await runPython<SceneDetectResult>("scene_detect.py", [
    videoPath,
    "--threshold",
    String(threshold),
    "--min-scene-len",
    String(minSceneLen),
  ]);
  await writeJson(cacheFile, result);
  return result;
}
