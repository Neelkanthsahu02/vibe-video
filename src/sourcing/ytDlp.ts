import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { ensureDir, fileExists } from "../utils/paths.js";

const log = createLogger("yt-dlp");

export interface YtDlpVideo {
  id: string;
  title: string;
  url: string;
  webpage_url: string;
  duration: number | null;
  uploader: string | null;
  channel: string | null;
  view_count: number | null;
  upload_date: string | null;
  thumbnail: string | null;
}

export interface YtDlpDownloadResult {
  localPath: string;
  bytes: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  format: string;
}

/**
 * Use yt-dlp's search prefix to fetch metadata for the top N videos for a
 * query — no download, --flat-playlist for speed. Returns one entry per
 * candidate.
 */
export async function searchYouTube(
  query: string,
  count = 10,
): Promise<YtDlpVideo[]> {
  const term = `ytsearch${Math.max(1, Math.min(50, count))}:${query}`;
  try {
    const { stdout } = await execa(
      config.bins.ytDlp,
      [
        term,
        "--dump-json",
        "--flat-playlist",
        "--no-warnings",
        "--quiet",
        "--skip-download",
      ],
      { reject: false, maxBuffer: 1024 * 1024 * 16 },
    );
    const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
    const results: YtDlpVideo[] = [];
    for (const line of lines) {
      try {
        const j = JSON.parse(line) as Record<string, unknown>;
        const id = String(j.id ?? "");
        const webpageUrl =
          (j.webpage_url as string | undefined) ??
          (j.url as string | undefined) ??
          (id ? `https://www.youtube.com/watch?v=${id}` : "");
        if (!id || !webpageUrl) continue;
        results.push({
          id,
          title: String(j.title ?? ""),
          url: webpageUrl,
          webpage_url: webpageUrl,
          duration:
            typeof j.duration === "number"
              ? (j.duration as number)
              : null,
          uploader:
            typeof j.uploader === "string" ? (j.uploader as string) : null,
          channel:
            typeof j.channel === "string" ? (j.channel as string) : null,
          view_count:
            typeof j.view_count === "number"
              ? (j.view_count as number)
              : null,
          upload_date:
            typeof j.upload_date === "string"
              ? (j.upload_date as string)
              : null,
          thumbnail:
            typeof j.thumbnail === "string"
              ? (j.thumbnail as string)
              : null,
        });
      } catch {
        /* skip malformed JSON line */
      }
    }
    return results;
  } catch (e) {
    log.warn(`yt-dlp search failed for ${query}: ${(e as Error).message}`);
    return [];
  }
}

export interface DownloadYouTubeOptions {
  /** Skip videos longer than this many seconds. */
  maxDurationSeconds?: number;
  /** yt-dlp -f format spec. Default: capped at 720p mp4. */
  formatSpec?: string;
  /** Download only a section: [start, end] in seconds (yt-dlp --download-sections). */
  section?: { start: number; end: number };
}

export async function downloadYouTube(
  webpageUrl: string,
  destDir: string,
  basename: string,
  options: DownloadYouTubeOptions = {},
): Promise<YtDlpDownloadResult | null> {
  await ensureDir(destDir);
  const maxDur = options.maxDurationSeconds ?? 900;
  const format =
    options.formatSpec ??
    "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720]/best";

  const outTemplate = path.join(destDir, `${basename}.%(ext)s`);
  const candidatePath = path.join(destDir, `${basename}.mp4`);
  if (await fileExists(candidatePath)) {
    const stat = await fs.stat(candidatePath);
    return {
      localPath: candidatePath,
      bytes: stat.size,
      duration: null,
      width: null,
      height: null,
      format: "mp4",
    };
  }

  const args = [
    webpageUrl,
    "-f", format,
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--match-filter", `duration<${maxDur}`,
    "--no-warnings",
    "--quiet",
    "--no-progress",
    "-o", outTemplate,
  ];
  if (options.section) {
    args.push(
      "--download-sections",
      `*${options.section.start}-${options.section.end}`,
      "--force-keyframes-at-cuts",
    );
  }

  try {
    await execa(config.bins.ytDlp, args, {
      maxBuffer: 1024 * 1024 * 32,
      timeout: 5 * 60 * 1000,
    });
  } catch (e) {
    log.warn(
      `yt-dlp download failed ${webpageUrl}: ${(e as Error).message.slice(0, 200)}`,
    );
    return null;
  }

  // yt-dlp picks the final extension; find it.
  const dirEntries = await fs.readdir(destDir);
  const match = dirEntries.find((f) => f.startsWith(`${basename}.`));
  if (!match) return null;
  const finalPath = path.join(destDir, match);
  const stat = await fs.stat(finalPath);
  return {
    localPath: finalPath,
    bytes: stat.size,
    duration: null,
    width: null,
    height: null,
    format: path.extname(finalPath).slice(1) || "mp4",
  };
}

export async function ytDlpAvailable(): Promise<boolean> {
  try {
    await execa(config.bins.ytDlp, ["--version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
