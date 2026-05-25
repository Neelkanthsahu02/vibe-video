import path from "node:path";
import { extractFrame } from "../utils/ffmpeg.js";
import type { RawScene } from "./sceneDetector.js";
import { fileExists } from "../utils/paths.js";

export interface BeatFrameRef {
  sceneIndex: number;
  /** Absolute timestamps the frames were sampled at. */
  timestamps: number[];
  /** Absolute file paths of the extracted JPEGs. */
  framePaths: string[];
}

/**
 * For each scene, sample `framesPerScene` frames evenly across the scene,
 * skipping the first/last 10% to avoid transition artefacts.
 */
export async function extractBeatFrames(
  videoPath: string,
  scenes: RawScene[],
  outDir: string,
  framesPerScene = 2,
): Promise<BeatFrameRef[]> {
  const refs: BeatFrameRef[] = [];
  for (const scene of scenes) {
    const dur = Math.max(0.01, scene.duration);
    const pad = Math.min(0.5, dur * 0.1);
    const start = scene.start + pad;
    const end = scene.end - pad;
    const span = Math.max(0, end - start);

    const timestamps: number[] = [];
    if (framesPerScene <= 1 || span <= 0.05) {
      timestamps.push(scene.start + dur / 2);
    } else {
      for (let i = 0; i < framesPerScene; i++) {
        const t = start + (span * (i + 0.5)) / framesPerScene;
        timestamps.push(t);
      }
    }

    const framePaths: string[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i]!;
      const basename = `scene_${scene.index.toString().padStart(5, "0")}_${i}`;
      const expected = path.join(outDir, `${basename}.jpg`);
      if (await fileExists(expected)) {
        framePaths.push(expected);
        continue;
      }
      const out = await extractFrame(videoPath, ts, outDir, basename, 768);
      framePaths.push(out);
    }
    refs.push({
      sceneIndex: scene.index,
      timestamps,
      framePaths,
    });
  }
  return refs;
}
