import path from "node:path";
import { extractFrame, ffprobe } from "../utils/ffmpeg.js";
import { ensureDir, fileExists } from "../utils/paths.js";

export interface ClipFrameSamples {
  clipPath: string;
  duration: number;
  framePaths: string[];
  timestamps: number[];
}

/**
 * Sample 3 representative frames from a clip at 20% / 50% / 80% positions
 * so the vision model gets a coherent read of the whole clip rather than
 * just the title card.
 */
export async function sampleClipFrames(
  clipPath: string,
  outDir: string,
  basename: string,
): Promise<ClipFrameSamples> {
  await ensureDir(outDir);
  const probe = await ffprobe(clipPath);
  const dur = probe.duration > 0 ? probe.duration : 1;
  const fractions = [0.2, 0.5, 0.8];
  const timestamps = fractions.map((f) => Math.max(0.1, dur * f));

  const framePaths: string[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i]!;
    const name = `${basename}_p${(fractions[i]! * 100).toFixed(0).padStart(2, "0")}`;
    const expected = path.join(outDir, `${name}.jpg`);
    if (await fileExists(expected)) {
      framePaths.push(expected);
      continue;
    }
    framePaths.push(await extractFrame(clipPath, ts, outDir, name, 768));
  }
  return { clipPath, duration: dur, framePaths, timestamps };
}
