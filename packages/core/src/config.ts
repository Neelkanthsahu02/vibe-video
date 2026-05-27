/* Centralized config for the new monorepo. Reads .env via dotenv (the
 * existing src/config.ts also reads it; both can coexist). */
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
  dirs: {
    stylePresets: path.resolve(root, process.env.STYLE_PRESETS_DIR ?? "./style-presets"),
    assetLibrary: path.resolve(root, process.env.ASSET_LIBRARY_DIR ?? "./asset-library"),
    referenceVideos: path.resolve(root, process.env.REFERENCE_VIDEOS_DIR ?? "./reference-videos"),
    projects: path.resolve(root, process.env.LOCAL_RENDER_PATH ?? "./projects"),
    cache: path.resolve(root, process.env.CACHE_DIR ?? "./cache"),
    python: path.resolve(root, "python"),
  },
  bins: {
    ffmpeg: process.env.FFMPEG_PATH ?? process.env.FFMPEG_BIN ?? "ffmpeg",
    ffprobe: process.env.FFPROBE_PATH ?? process.env.FFPROBE_BIN ?? "ffprobe",
    ytDlp: process.env.YTDLP_PATH ?? process.env.YT_DLP_BIN ?? "yt-dlp",
    python: process.env.PYTHON_PATH ?? process.env.PYTHON_BIN ?? "python3",
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    visionModel: process.env.OPENROUTER_VISION_MODEL ?? "google/gemini-2.5-flash",
    reasoningModel: process.env.OPENROUTER_REASONING_MODEL ?? "anthropic/claude-sonnet-4-6",
  },
  apify: {
    apiKey: process.env.APIFY_API_KEY ?? "",
    channelActor: process.env.APIFY_YT_CHANNEL_ACTOR ?? "streamers/youtube-channel-scraper",
    scraperActor: process.env.APIFY_YT_SCRAPER_ACTOR ?? "streamers/youtube-scraper",
  },
  brave: {
    apiKey: process.env.BRAVE_SEARCH_API_KEY ?? "",
  },
  youtube: {
    apiKey: process.env.YOUTUBE_DATA_API_KEY ?? "",
  },
  whisper: {
    model: process.env.WHISPER_MODEL ?? "small",
    device: process.env.WHISPER_DEVICE ?? "cpu",
    computeType: process.env.WHISPER_COMPUTE ?? "int8",
    language: process.env.WHISPER_LANG ?? undefined,
    modelPath: process.env.WHISPER_MODEL_PATH ?? undefined,
  },
  tuning: {
    visionFramesPerBeat: envInt("VISION_FRAMES_PER_BEAT", 2),
    visionConcurrency: envInt("VISION_CONCURRENCY", 3),
    sceneDetectThreshold: envFloat("SCENE_DETECT_THRESHOLD", 27.0),
  },
} as const;

export type AppConfig = typeof config;
