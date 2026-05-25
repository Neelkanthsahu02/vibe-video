import "dotenv/config";
import path from "node:path";

const root = process.cwd();

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  root,
  styleLibraryDir: path.resolve(
    root,
    process.env.STYLE_LIBRARY_DIR ?? "./style-library",
  ),
  assetLibraryDir: path.resolve(
    root,
    process.env.ASSET_LIBRARY_DIR ?? "./asset-library",
  ),
  projectsDir: path.resolve(
    root,
    process.env.PROJECTS_DIR ?? "./projects",
  ),
  pythonDir: path.resolve(root, "python"),

  bins: {
    ffmpeg: process.env.FFMPEG_BIN ?? "ffmpeg",
    ffprobe: process.env.FFPROBE_BIN ?? "ffprobe",
    python: process.env.PYTHON_BIN ?? "python3",
    ytDlp: process.env.YT_DLP_BIN ?? "yt-dlp",
  },

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseUrl:
      process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    visionModel:
      process.env.OPENROUTER_VISION_MODEL ?? "google/gemini-2.5-flash",
    reasoningModel:
      process.env.OPENROUTER_REASONING_MODEL ?? "anthropic/claude-sonnet-4-6",
  },

  brave: {
    apiKey: process.env.BRAVE_SEARCH_API_KEY ?? "",
  },

  tuning: {
    visionFramesPerBeat: envInt("VISION_FRAMES_PER_BEAT", 2),
    visionConcurrency: envInt("VISION_CONCURRENCY", 3),
    sceneDetectThreshold: envFloat("SCENE_DETECT_THRESHOLD", 27.0),
  },
} as const;

export type Config = typeof config;
