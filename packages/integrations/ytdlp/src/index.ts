import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../../../core/src/config.js";
import { createLogger } from "../../../utils/src/logger.js";
import { ensureDir, fileExists } from "../../../utils/src/paths.js";

const log = createLogger("ytdlp");

export interface DownloadOptions {
  /** yt-dlp format selector. Defaults to ≤1080p mp4. */
  formatSpec?: string;
  /** Skip videos longer than this many seconds. */
  maxDurationSeconds?: number;
  /** Cookies file path (when downloading age-restricted content). */
  cookiesFile?: string;
  /** Force re-download even if a file is already present. */
  force?: boolean;
}

export interface DownloadResult {
  videoId: string;
  url: string;
  localPath: string;
  bytes: number;
  format: string;
}

const DEFAULT_FORMAT =
  "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/best";

/** Download one YouTube video to destDir. Filename is <videoId>.mp4. */
export async function downloadVideo(
  videoUrl: string,
  destDir: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  await ensureDir(destDir);
  const videoId = extractVideoId(videoUrl);
  const expected = path.join(destDir, `${videoId}.mp4`);
  if (!opts.force && (await fileExists(expected))) {
    const stat = await fs.stat(expected);
    return {
      videoId,
      url: videoUrl,
      localPath: expected,
      bytes: stat.size,
      format: "mp4",
    };
  }
  const args = [
    videoUrl,
    "-f", opts.formatSpec ?? DEFAULT_FORMAT,
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "--no-progress",
    "-o", path.join(destDir, "%(id)s.%(ext)s"),
  ];
  if (opts.maxDurationSeconds) {
    args.push("--match-filter", `duration<${opts.maxDurationSeconds}`);
  }
  if (opts.cookiesFile) {
    args.push("--cookies", opts.cookiesFile);
  }
  log.info(`download ${videoUrl}`);
  await execa(config.bins.ytDlp, args, {
    maxBuffer: 1024 * 1024 * 64,
    timeout: 30 * 60 * 1000,
  });
  // yt-dlp may write .mkv/.webm depending on the merge fallback; search for it.
  const items = await fs.readdir(destDir);
  const match = items.find((f) => f.startsWith(`${videoId}.`));
  if (!match) throw new Error(`yt-dlp finished but no output found for ${videoUrl}`);
  const finalPath = path.join(destDir, match);
  const stat = await fs.stat(finalPath);
  return {
    videoId,
    url: videoUrl,
    localPath: finalPath,
    bytes: stat.size,
    format: path.extname(finalPath).slice(1) || "mp4",
  };
}

export function extractVideoId(url: string): string {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (m?.[1]) return m[1];
  // Fall back: treat the URL itself as the id if it already looks like one.
  const direct = url.match(/^[A-Za-z0-9_-]{11}$/);
  if (direct) return url;
  throw new Error(`could not extract YouTube video id from ${url}`);
}

export async function ytDlpAvailable(): Promise<boolean> {
  try {
    await execa(config.bins.ytDlp, ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
