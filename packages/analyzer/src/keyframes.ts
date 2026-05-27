/* Keyframe selection: picks meaningful timestamps for vision analysis.
 * Per PHASE 2 spec, we want:
 *   - first frame of each scene
 *   - middle frame of each scene
 *   - frame before transition (last frame of prev scene)
 *   - frame after transition (first frame of next scene)
 *   - frames around audio spikes
 *   - frames where text appears (we can't detect text without vision —
 *     but the per-beat vision pass handles text classification later)
 *
 * To keep cost predictable, we deduplicate by proximity (within 0.5s). */
import path from "node:path";
import { extractFrame } from "../../integrations/ffmpeg/src/index.js";
import { ensureDir, fileExists } from "../../../packages/utils/src/paths.js";
import type { RawScene } from "../../integrations/scenedetect/src/index.js";

export interface AudioSpike {
  /** Absolute timestamp in seconds. */
  t: number;
}

export interface KeyframeRequest {
  sceneIndex: number;
  /** Beat-aligned timestamps. */
  timestamps: number[];
  /** What this keyframe set is meant to capture. */
  purpose: "scene_start" | "scene_middle" | "scene_end" | "transition" | "audio_spike";
}

export interface KeyframeExtractResult {
  sceneIndex: number;
  timestamps: number[];
  framePaths: string[];
  purpose: KeyframeRequest["purpose"];
}

export interface SelectKeyframeOptions {
  /** How many frames to sample inside each scene's body. */
  framesPerScene?: number;
  /** Whether to include pre/post-cut frames. */
  includeTransitions?: boolean;
  /** Optional audio spike timestamps to include. */
  audioSpikes?: AudioSpike[];
  /** Minimum spacing between any two keyframes to avoid duplicates. */
  dedupeWithinSeconds?: number;
}

export function buildKeyframeRequests(
  scenes: RawScene[],
  opts: SelectKeyframeOptions = {},
): KeyframeRequest[] {
  const framesPerScene = Math.max(1, opts.framesPerScene ?? 2);
  const includeTransitions = opts.includeTransitions ?? true;
  const dedupe = opts.dedupeWithinSeconds ?? 0.5;
  const requests: KeyframeRequest[] = [];

  for (const scene of scenes) {
    const dur = Math.max(0.01, scene.duration);
    const pad = Math.min(0.5, dur * 0.1);
    const start = scene.start + pad;
    const end = scene.end - pad;
    const span = Math.max(0, end - start);

    const inside: number[] = [];
    if (framesPerScene <= 1 || span <= 0.05) {
      inside.push(scene.start + dur / 2);
    } else {
      for (let i = 0; i < framesPerScene; i++) {
        inside.push(start + (span * (i + 0.5)) / framesPerScene);
      }
    }
    requests.push({
      sceneIndex: scene.index,
      timestamps: inside,
      purpose: "scene_middle",
    });

    if (includeTransitions) {
      // Pre-cut frame: very near end of this scene.
      requests.push({
        sceneIndex: scene.index,
        timestamps: [Math.max(scene.start, scene.end - 0.1)],
        purpose: "transition",
      });
    }
  }

  // Audio spikes are not tied to a single scene; bucket each into the scene it falls inside.
  if (opts.audioSpikes && opts.audioSpikes.length > 0) {
    for (const spike of opts.audioSpikes) {
      const scene = scenes.find(
        (s) => spike.t >= s.start && spike.t < s.end,
      );
      if (!scene) continue;
      requests.push({
        sceneIndex: scene.index,
        timestamps: [spike.t],
        purpose: "audio_spike",
      });
    }
  }

  // Dedup by proximity within the same scene.
  for (const req of requests) {
    req.timestamps = dedupeNear(req.timestamps, dedupe);
  }
  return requests;
}

export async function extractKeyframes(
  videoPath: string,
  requests: KeyframeRequest[],
  outDir: string,
  width = 768,
): Promise<KeyframeExtractResult[]> {
  await ensureDir(outDir);
  const out: KeyframeExtractResult[] = [];
  for (const req of requests) {
    const framePaths: string[] = [];
    for (let i = 0; i < req.timestamps.length; i++) {
      const ts = req.timestamps[i]!;
      const basename =
        `scene_${req.sceneIndex.toString().padStart(5, "0")}_` +
        `${req.purpose}_${i}_${ts.toFixed(3)}`;
      const expected = path.join(outDir, `${basename}.jpg`);
      if (await fileExists(expected)) {
        framePaths.push(expected);
        continue;
      }
      framePaths.push(await extractFrame(videoPath, ts, outDir, basename, width));
    }
    out.push({
      sceneIndex: req.sceneIndex,
      timestamps: req.timestamps,
      framePaths,
      purpose: req.purpose,
    });
  }
  return out;
}

function dedupeNear(values: number[], minGap: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1]! >= minGap) {
      out.push(v);
    }
  }
  return out;
}
