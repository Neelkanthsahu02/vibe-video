import path from "node:path";
import crypto from "node:crypto";
import pLimit from "p-limit";
import { createLogger } from "../utils/logger.js";
import {
  ensureDir,
  readJson,
  writeJson,
  fileExists,
} from "../utils/paths.js";
import { resolveProjectPaths } from "../planner/projectIO.js";
import type { ScenePlan, ScenePlanBeat } from "../schemas/scenePlan.js";
import type {
  CandidateAsset,
  CandidateManifest,
  SceneCandidates,
} from "../schemas/assetCandidates.js";
import { BraveClient } from "./braveClient.js";
import { downloadImage } from "./imageDownloader.js";
import { searchYouTube, downloadYouTube, ytDlpAvailable } from "./ytDlp.js";

const log = createLogger("source");

export interface SourceAssetsOptions {
  projectName: string;
  /** How many image candidates to keep per scene (across all queries combined). */
  imagesPerScene?: number;
  /** How many YouTube clips to actually download per scene. */
  clipsPerScene?: number;
  /** Per-query Brave fetch size. */
  bravePerQuery?: number;
  /** Per-query YouTube fetch size. */
  ytdlpPerQuery?: number;
  /** Max video duration in seconds for clip candidates. */
  maxClipDuration?: number;
  /** When true, regenerate even if cached. */
  force?: boolean;
  /** Skip image candidates entirely. */
  skipImages?: boolean;
  /** Skip clip candidates entirely. */
  skipClips?: boolean;
}

export interface SourceAssetsResult {
  manifestPath: string;
  manifest: CandidateManifest;
}

const DEFAULTS = {
  imagesPerScene: 6,
  clipsPerScene: 2,
  bravePerQuery: 6,
  ytdlpPerQuery: 6,
  maxClipDuration: 900,
};

export async function sourceAssetsForProject(
  opts: SourceAssetsOptions,
): Promise<SourceAssetsResult> {
  const cfg = { ...DEFAULTS, ...opts };
  const paths = await resolveProjectPaths(opts.projectName);
  if (!(await fileExists(paths.scenePlanJson))) {
    throw new Error(
      `scene_plan.json not found at ${paths.scenePlanJson}. Run \`vibe plan\` first.`,
    );
  }
  const plan = await readJson<ScenePlan>(paths.scenePlanJson);
  const manifestPath = path.join(paths.assetsDir, "candidates", "manifest.json");

  const existing: CandidateManifest | null = !opts.force && (await fileExists(manifestPath))
    ? await readJson<CandidateManifest>(manifestPath)
    : null;

  const brave = new BraveClient();
  if (!cfg.skipImages && !brave.hasKey()) {
    log.warn(
      "BRAVE_SEARCH_API_KEY is not set — image sourcing will be skipped.",
    );
    cfg.skipImages = true;
  }
  const ytOk = await ytDlpAvailable();
  if (!cfg.skipClips && !ytOk) {
    log.warn("yt-dlp not on PATH — clip sourcing will be skipped.");
    cfg.skipClips = true;
  }

  const sceneLimit = pLimit(2); // be polite to Brave + bandwidth

  const sceneResults = await Promise.all(
    plan.beats.map((beat) =>
      sceneLimit(() =>
        sourceForBeat(beat, plan, paths, brave, cfg, existing),
      ),
    ),
  );

  const images = sceneResults.reduce(
    (s, c) => s + c.candidates.filter((a) => a.kind === "image").length,
    0,
  );
  const clips = sceneResults.reduce(
    (s, c) => s + c.candidates.filter((a) => a.kind === "clip").length,
    0,
  );
  const bytes = sceneResults.reduce(
    (s, c) => s + c.candidates.reduce((bs, a) => bs + a.bytes, 0),
    0,
  );

  const manifest: CandidateManifest = {
    schema_version: "1.0.0",
    project_name: plan.project_name,
    channel_slug: plan.channel_slug,
    generated_at: new Date().toISOString(),
    totals: { scenes: sceneResults.length, images, clips, bytes },
    scenes: sceneResults,
  };
  await writeJson(manifestPath, manifest);
  log.info(
    `manifest → ${manifestPath} (${images} images, ${clips} clips, ${(bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  return { manifestPath, manifest };
}

interface PathsForScene {
  imagesDir: string;
  clipsDir: string;
}

function sceneDirs(
  paths: Awaited<ReturnType<typeof resolveProjectPaths>>,
  sceneId: string,
): PathsForScene {
  return {
    imagesDir: path.join(paths.candidatesImagesDir, sceneId),
    clipsDir: path.join(paths.candidatesClipsDir, sceneId),
  };
}

async function sourceForBeat(
  beat: ScenePlanBeat,
  plan: ScenePlan,
  paths: Awaited<ReturnType<typeof resolveProjectPaths>>,
  brave: BraveClient,
  cfg: typeof DEFAULTS & SourceAssetsOptions,
  existing: CandidateManifest | null,
): Promise<SceneCandidates> {
  const sceneId = beat.scene_id;
  const dirs = sceneDirs(paths, sceneId);
  await Promise.all([ensureDir(dirs.imagesDir), ensureDir(dirs.clipsDir)]);

  const prevForScene =
    existing?.scenes.find((s) => s.scene_id === sceneId) ?? null;
  // If we already have enough candidates and not forcing, reuse.
  if (
    prevForScene &&
    !cfg.force &&
    prevForScene.candidates.filter((c) => c.kind === "image").length >=
      cfg.imagesPerScene &&
    prevForScene.candidates.filter((c) => c.kind === "clip").length >=
      cfg.clipsPerScene
  ) {
    log.debug(`scene ${sceneId} already populated — skip`);
    return prevForScene;
  }

  const candidates: CandidateAsset[] = prevForScene?.candidates.slice() ?? [];
  const seenUrls = new Set(candidates.map((c) => c.source_url));
  const notes: string[] = prevForScene?.notes.slice() ?? [];

  // --- IMAGES ---
  if (!cfg.skipImages && brave.hasKey()) {
    const imageBudget = Math.max(
      0,
      cfg.imagesPerScene -
        candidates.filter((c) => c.kind === "image").length,
    );
    if (imageBudget > 0) {
      const queries = [
        ...beat.image_search_queries,
        ...beat.headline_search_queries.map((q) => `${q} headline screenshot`),
      ];
      let remaining = imageBudget;
      for (const q of queries) {
        if (remaining <= 0) break;
        try {
          const results = await brave.searchImages(q, cfg.bravePerQuery);
          for (const r of results) {
            if (remaining <= 0) break;
            if (!r.imageUrl || seenUrls.has(r.imageUrl)) continue;
            seenUrls.add(r.imageUrl);
            const basename = `${shortHash(r.imageUrl)}`;
            const dl = await downloadImage(
              r.imageUrl,
              dirs.imagesDir,
              basename,
            );
            if (!dl) continue;
            candidates.push({
              asset_id: `img_${basename}`,
              kind: "image",
              scene_id: sceneId,
              query: q,
              source: "brave_images",
              source_url: r.imageUrl,
              page_url: r.url || null,
              title: r.title || null,
              publisher: r.source || null,
              local_path: dl.localPath,
              width: dl.width,
              height: dl.height,
              duration_seconds: null,
              bytes: dl.bytes,
              format: dl.format,
              youtube_id: null,
              youtube_channel: null,
              fetched_at: new Date().toISOString(),
            });
            remaining--;
          }
        } catch (e) {
          notes.push(`brave image error "${q}": ${(e as Error).message}`);
          log.warn(`brave image error ${q}: ${(e as Error).message}`);
        }
      }
    }
  }

  // --- CLIPS ---
  if (!cfg.skipClips) {
    const clipBudget = Math.max(
      0,
      cfg.clipsPerScene -
        candidates.filter((c) => c.kind === "clip").length,
    );
    if (clipBudget > 0 && beat.youtube_clip_search_queries.length > 0) {
      // Gather metadata across queries, dedup by video id, rank by view_count
      const found = new Map<string, Awaited<ReturnType<typeof searchYouTube>>[number] & { query: string }>();
      for (const q of beat.youtube_clip_search_queries) {
        try {
          const meta = await searchYouTube(q, cfg.ytdlpPerQuery);
          for (const m of meta) {
            if (m.duration && m.duration > cfg.maxClipDuration) continue;
            if (!found.has(m.id)) found.set(m.id, { ...m, query: q });
          }
        } catch (e) {
          notes.push(`yt search error "${q}": ${(e as Error).message}`);
          log.warn(`yt search error ${q}: ${(e as Error).message}`);
        }
      }
      const ranked = [...found.values()].sort(
        (a, b) => (b.view_count ?? 0) - (a.view_count ?? 0),
      );
      let downloaded = 0;
      for (const vid of ranked) {
        if (downloaded >= clipBudget) break;
        if (seenUrls.has(vid.webpage_url)) continue;
        seenUrls.add(vid.webpage_url);
        const basename = `yt_${vid.id}`;
        const dl = await downloadYouTube(
          vid.webpage_url,
          dirs.clipsDir,
          basename,
          { maxDurationSeconds: cfg.maxClipDuration },
        );
        if (!dl) continue;
        candidates.push({
          asset_id: `clip_${vid.id}`,
          kind: "clip",
          scene_id: sceneId,
          query: vid.query,
          source: "yt_dlp_search",
          source_url: vid.webpage_url,
          page_url: vid.webpage_url,
          title: vid.title,
          publisher: vid.uploader ?? vid.channel ?? null,
          local_path: dl.localPath,
          width: dl.width,
          height: dl.height,
          duration_seconds: vid.duration,
          bytes: dl.bytes,
          format: dl.format,
          youtube_id: vid.id,
          youtube_channel: vid.channel ?? null,
          fetched_at: new Date().toISOString(),
        });
        downloaded++;
      }
    }
  }

  if (candidates.length === 0) {
    notes.push("no candidates downloaded for this scene");
  }

  return {
    scene_id: sceneId,
    index: beat.index,
    start_time: beat.start_time,
    end_time: beat.end_time,
    asset_type_needed: beat.asset_type_needed,
    image_search_queries: beat.image_search_queries,
    youtube_clip_search_queries: beat.youtube_clip_search_queries,
    headline_search_queries: beat.headline_search_queries,
    candidates,
    notes,
  };
}

function shortHash(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
}

// Re-export to silence unused warning if a caller imports plan type
export type { ScenePlan, ScenePlanBeat };
