import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export async function ensureDir(p: string): Promise<string> {
  await fs.mkdir(p, { recursive: true });
  return p;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export interface VideoAnalysisPaths {
  channelDir: string;
  videoDir: string;
  framesDir: string;
  audioDir: string;
  cacheDir: string;
  videoAnalysisJson: string;
  styleSummaryMd: string;
  detectedAssetsJson: string;
  assetUsageReportJson: string;
}

export async function videoAnalysisPaths(
  channelSlug: string,
  videoSlug: string,
): Promise<VideoAnalysisPaths> {
  const channelDir = path.join(config.styleLibraryDir, channelSlug);
  const videoDir = path.join(channelDir, "video_analyses", videoSlug);
  const framesDir = path.join(videoDir, "frames");
  const audioDir = path.join(videoDir, "audio");
  const cacheDir = path.join(videoDir, "cache");
  await ensureDir(framesDir);
  await ensureDir(audioDir);
  await ensureDir(cacheDir);
  await ensureDir(path.join(channelDir, "detected_assets"));
  await ensureDir(path.join(channelDir, "asset_usage_reports"));
  return {
    channelDir,
    videoDir,
    framesDir,
    audioDir,
    cacheDir,
    videoAnalysisJson: path.join(videoDir, "video_analysis.json"),
    styleSummaryMd: path.join(videoDir, "style_summary.md"),
    detectedAssetsJson: path.join(
      channelDir,
      "detected_assets",
      `${videoSlug}.json`,
    ),
    assetUsageReportJson: path.join(
      channelDir,
      "asset_usage_reports",
      `${videoSlug}.json`,
    ),
  };
}

export async function readJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw) as T;
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

export async function writeText(file: string, text: string): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, text, "utf-8");
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
