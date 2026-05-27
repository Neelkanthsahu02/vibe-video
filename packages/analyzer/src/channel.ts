/* Channel-level Style Analyzer pipeline. The PHASE 16 milestone.
 *
 *   channel URL
 *   ↓
 *   ApifyClient.listChannelVideos
 *   ↓
 *   selectVideos(mode, count, manualUrls)
 *   ↓
 *   for each picked video:
 *     analyzeReferenceVideo  (yt-dlp → ffmpeg → scenedetect → whisper → vision)
 *   ↓
 *   buildStylePreset → style_preset.json
 */
import path from "node:path";
import { createLogger } from "../../utils/src/logger.js";
import { slugify, writeJson } from "../../utils/src/paths.js";
import { db } from "../../storage/src/index.js";
import {
  ApifyClient,
  type ApifyVideoItem,
} from "../../integrations/apify/src/index.js";
import {
  selectVideos,
  type SelectionMode,
  type SelectionResult,
} from "./video-selector.js";
import { analyzeReferenceVideo } from "./reference-video.js";
import { buildStylePreset } from "./style-preset.js";
import type { VideoAnalysis } from "../../schemas/src/video-analysis.js";
import type { StylePreset } from "../../schemas/src/style-preset.js";

const log = createLogger("channel-analyzer");

export interface AnalyzeChannelOptions {
  channelUrl: string;
  /** Channel display name. Default: derived from URL. */
  channelName?: string;
  /** Channel slug for storage. Default: derived from channelName/URL. */
  channelSlug?: string;
  /** Niche label embedded in the preset. */
  niche?: string;
  /** Selection mode. */
  mode: SelectionMode;
  /** How many videos to analyze. */
  count: number;
  /** Manual video URLs to include (used by mode="manual" and "mixed"). */
  manualUrls?: string[];
  /** Max video duration to consider eligible. */
  maxDurationSeconds?: number;
  /** Min video duration to consider eligible. */
  minDurationSeconds?: number;
  /** Pre-supplied video list (e.g. when Apify isn't available). */
  videoList?: ApifyVideoItem[];
  /** When true, regenerate per-video analyses even if cached. */
  force?: boolean;
}

export interface AnalyzeChannelResult {
  channelName: string;
  channelSlug: string;
  selection: SelectionResult;
  analyses: VideoAnalysis[];
  preset: StylePreset;
  presetPath: string;
}

export async function analyzeChannel(
  opts: AnalyzeChannelOptions,
): Promise<AnalyzeChannelResult> {
  const channelName = opts.channelName ?? deriveChannelName(opts.channelUrl);
  const channelSlug = opts.channelSlug ?? slugify(channelName);
  log.info(`channel=${channelName} slug=${channelSlug} mode=${opts.mode} n=${opts.count}`);

  // Step 1 — Apify
  let allVideos: ApifyVideoItem[] = opts.videoList ?? [];
  let manualMeta: ApifyVideoItem[] = [];
  const apify = new ApifyClient();
  if (allVideos.length === 0) {
    if (!apify.hasKey()) {
      throw new Error(
        "APIFY_API_KEY is not set — set it or pass --video-list with explicit URLs.",
      );
    }
    log.info("Apify: listing channel videos");
    allVideos = await apify.listChannelVideos(opts.channelUrl, {
      maxItems: Math.max(50, opts.count * 6),
      sortBy: opts.mode === "top" ? "popular" : "newest",
    });
    log.info(`Apify returned ${allVideos.length} videos`);
  }
  // Optionally pull metadata for manual URLs so they participate in selection.
  if (opts.manualUrls && opts.manualUrls.length > 0) {
    if (apify.hasKey()) {
      try {
        manualMeta = await apify.fetchVideoMetadata(opts.manualUrls);
      } catch (e) {
        log.warn(
          `Apify failed to fetch manual URL metadata: ${(e as Error).message} — using stubs`,
        );
        manualMeta = opts.manualUrls.map(makeStubItem);
      }
    } else {
      manualMeta = opts.manualUrls.map(makeStubItem);
    }
  }

  // Step 2 — selection
  const selection = selectVideos(allVideos, manualMeta, {
    mode: opts.mode,
    count: opts.count,
    manualUrls: opts.manualUrls,
    maxDurationSeconds: opts.maxDurationSeconds,
    minDurationSeconds: opts.minDurationSeconds,
  });
  log.info(
    `selected ${selection.picked.length} videos: ${selection.picked.map((v) => v.id).join(", ")}`,
  );
  if (selection.picked.length === 0) {
    throw new Error(
      `No videos eligible for analysis after filtering. ` +
        `(channel returned ${allVideos.length}; tooLong=${selection.skippedTooLong.length}, tooShort=${selection.skippedTooShort.length})`,
    );
  }

  // Step 3 — per-video pipeline
  const analyses: VideoAnalysis[] = [];
  for (const video of selection.picked) {
    log.info(`-- ${video.id} ${video.title}`);
    try {
      const res = await analyzeReferenceVideo({
        channelSlug,
        source: video.url,
        title: video.title,
        videoIdOverride: video.id,
        force: opts.force,
      });
      analyses.push(res.analysis);
      await db
        .upsertAnalysis({
          video_id: res.analysis.video_id,
          preset_id: `preset_${channelSlug}`,
          source_url: res.analysis.source_url,
          title: res.analysis.title,
          duration_seconds: res.analysis.duration_seconds,
          analyzed_at: res.analysis.analyzed_at,
          file_path: res.videoAnalysisPath,
        })
        .catch((e) => log.warn(`db upsert failed: ${(e as Error).message}`));
    } catch (e) {
      log.error(`video failed (${video.id}): ${(e as Error).message}`);
    }
  }
  if (analyses.length === 0) {
    throw new Error("All per-video analyses failed — see logs above.");
  }

  // Step 4 — combine into style_preset.json
  const presetResult = await buildStylePreset(analyses, {
    channelName,
    channelSlug,
    channelUrl: opts.channelUrl,
    niche: opts.niche,
  });

  // Step 5 — record manifest summarising this run
  const manifestPath = path.join(
    presetResult.presetPath,
    "..",
    "analysis_manifest.json",
  );
  await writeJson(manifestPath, {
    channel_url: opts.channelUrl,
    channel_slug: channelSlug,
    mode: opts.mode,
    requested_count: opts.count,
    selected_count: selection.picked.length,
    notes: selection.notes,
    videos: selection.picked.map((v) => ({
      id: v.id,
      url: v.url,
      title: v.title,
      view_count: v.viewCount,
      duration_seconds: v.durationSeconds,
      published_at: v.publishedAt,
    })),
    generated_at: new Date().toISOString(),
  });
  await db
    .upsertPreset({
      preset_id: presetResult.preset.preset_id,
      preset_name: presetResult.preset.preset_name,
      channel_name: presetResult.preset.channel_name,
      channel_url: presetResult.preset.channel_url,
      niche: presetResult.preset.niche,
      version: presetResult.preset.version,
      total_videos: presetResult.preset.analysis_summary.total_videos,
      created_at: presetResult.preset.created_at,
      updated_at: presetResult.preset.updated_at,
      file_path: presetResult.presetPath,
    })
    .catch((e) => log.warn(`db upsert preset failed: ${(e as Error).message}`));

  return {
    channelName,
    channelSlug,
    selection,
    analyses,
    preset: presetResult.preset,
    presetPath: presetResult.presetPath,
  };
}

function deriveChannelName(url: string): string {
  const handle = url.match(/@([^/?#]+)/)?.[1];
  if (handle) return handle;
  const ch = url.match(/\/channel\/([^/?#]+)/)?.[1];
  if (ch) return ch;
  return slugify(url);
}

function makeStubItem(url: string): ApifyVideoItem {
  const id =
    url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/)?.[1] ??
    slugify(url);
  return {
    id,
    url,
    title: id,
    viewCount: null,
    durationSeconds: null,
    publishedAt: null,
    thumbnail: null,
    channelName: null,
    channelUrl: null,
  };
}
