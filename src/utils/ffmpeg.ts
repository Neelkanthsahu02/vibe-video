import { execa } from "execa";
import path from "node:path";
import { config } from "../config.js";
import { ensureDir } from "./paths.js";
import { createLogger } from "./logger.js";

const log = createLogger("ffmpeg");

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  bitrate: number | null;
  rawJson: unknown;
}

export async function ffprobe(videoPath: string): Promise<ProbeResult> {
  const { stdout } = await execa(config.bins.ffprobe, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<{
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
    }>;
  };
  const video = parsed.streams?.find((s) => s.codec_type === "video");
  const audio = parsed.streams?.find((s) => s.codec_type === "audio");
  let fps = 0;
  const fpsExpr = video?.avg_frame_rate ?? video?.r_frame_rate ?? "0/1";
  const [num, den] = fpsExpr.split("/").map((n) => parseFloat(n));
  if (num && den) fps = num / den;

  return {
    duration: parseFloat(parsed.format?.duration ?? "0"),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps,
    videoCodec: video?.codec_name ?? "",
    audioCodec: audio?.codec_name ?? null,
    bitrate: parsed.format?.bit_rate
      ? parseInt(parsed.format.bit_rate, 10)
      : null,
    rawJson: parsed,
  };
}

/**
 * Extract one JPEG frame at the given timestamp (seconds).
 * Returns the absolute file path.
 */
export async function extractFrame(
  videoPath: string,
  timestamp: number,
  outDir: string,
  basename: string,
  width = 768,
): Promise<string> {
  await ensureDir(outDir);
  const outPath = path.join(outDir, `${basename}.jpg`);
  await execa(config.bins.ffmpeg, [
    "-y",
    "-ss", String(timestamp),
    "-i", videoPath,
    "-frames:v", "1",
    "-vf", `scale=${width}:-2`,
    "-q:v", "3",
    outPath,
  ]);
  return outPath;
}

/**
 * Extract frames at the provided timestamps. Done in a single ffmpeg call per
 * frame because seeking accuracy beats throughput here.
 */
export async function extractFrames(
  videoPath: string,
  timestamps: number[],
  outDir: string,
  prefix = "f",
  width = 768,
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i]!;
    const name = `${prefix}_${i.toString().padStart(5, "0")}_${ts.toFixed(3)}`;
    out.push(await extractFrame(videoPath, ts, outDir, name, width));
  }
  return out;
}

/**
 * Extract a mono 22050Hz WAV of the full audio track for analysis.
 */
export async function extractAudio(
  videoPath: string,
  outDir: string,
  basename = "audio",
): Promise<string> {
  await ensureDir(outDir);
  const outPath = path.join(outDir, `${basename}.wav`);
  await execa(config.bins.ffmpeg, [
    "-y",
    "-i", videoPath,
    "-vn",
    "-ac", "1",
    "-ar", "22050",
    "-c:a", "pcm_s16le",
    outPath,
  ]);
  return outPath;
}

export async function checkBinaries(): Promise<{
  ffmpeg: boolean;
  ffprobe: boolean;
  python: boolean;
}> {
  async function ok(bin: string, args: string[]): Promise<boolean> {
    try {
      await execa(bin, args, { timeout: 5000 });
      return true;
    } catch (e) {
      log.warn(`Binary check failed: ${bin}`, (e as Error).message);
      return false;
    }
  }
  return {
    ffmpeg: await ok(config.bins.ffmpeg, ["-version"]),
    ffprobe: await ok(config.bins.ffprobe, ["-version"]),
    python: await ok(config.bins.python, ["--version"]),
  };
}
