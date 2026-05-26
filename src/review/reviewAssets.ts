import fs from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { createLogger } from "../utils/logger.js";
import { config } from "../config.js";
import {
  ensureDir,
  fileExists,
  readJson,
  writeJson,
} from "../utils/paths.js";
import { resolveProjectPaths } from "../planner/projectIO.js";
import type { ScenePlan, ScenePlanBeat } from "../schemas/scenePlan.js";
import type {
  CandidateAsset,
  CandidateManifest,
} from "../schemas/assetCandidates.js";
import type {
  AssetReview,
  AssetReviewEntry,
  SceneReview,
} from "../schemas/assetReview.js";
import { reviewCandidate } from "./visionReviewer.js";
import { OpenRouterClient } from "../openrouter/client.js";

const log = createLogger("review-orch");

export interface ReviewAssetsOptions {
  projectName: string;
  /** When true, regenerate per-candidate even if cached. */
  force?: boolean;
  /** Copy accepted asset files into assets/approved/ (and rejected into assets/rejected/). */
  copyApproved?: boolean;
  /** Only review scenes with these scene_ids (default: all). */
  sceneIds?: string[];
  /** Cap on parallel vision calls. Default: VISION_CONCURRENCY. */
  concurrency?: number;
}

export interface ReviewAssetsResult {
  reviewPath: string;
  review: AssetReview;
}

export async function reviewProjectAssets(
  opts: ReviewAssetsOptions,
): Promise<ReviewAssetsResult> {
  const paths = await resolveProjectPaths(opts.projectName);
  const manifestPath = path.join(paths.assetsDir, "candidates", "manifest.json");
  if (!(await fileExists(manifestPath))) {
    throw new Error(
      `candidates/manifest.json not found at ${manifestPath}. Run \`vibe source\` first.`,
    );
  }
  if (!(await fileExists(paths.scenePlanJson))) {
    throw new Error(
      `scene_plan.json not found at ${paths.scenePlanJson}. Run \`vibe plan\` first.`,
    );
  }
  const manifest = await readJson<CandidateManifest>(manifestPath);
  const plan = await readJson<ScenePlan>(paths.scenePlanJson);
  const beatById = new Map<string, ScenePlanBeat>();
  for (const b of plan.beats) beatById.set(b.scene_id, b);

  const reviewPath = path.join(paths.planDir, "asset_review.json");
  const cacheDir = path.join(paths.cacheDir, "asset_reviews");
  const clipFramesDir = path.join(paths.cacheDir, "clip_frames");
  await Promise.all([ensureDir(cacheDir), ensureDir(clipFramesDir)]);

  if (opts.force) {
    // Wipe per-candidate cache so vision re-runs.
    try {
      await fs.rm(cacheDir, { recursive: true, force: true });
      await ensureDir(cacheDir);
    } catch {
      /* ignore */
    }
  }

  const wanted = opts.sceneIds ? new Set(opts.sceneIds) : null;
  const targetScenes = manifest.scenes.filter(
    (s) => !wanted || wanted.has(s.scene_id),
  );

  const client = new OpenRouterClient();
  const limit = pLimit(opts.concurrency ?? config.tuning.visionConcurrency);

  const sceneReviews: SceneReview[] = [];
  for (const sceneCandidates of targetScenes) {
    const beat = beatById.get(sceneCandidates.scene_id);
    if (!beat) {
      log.warn(`no beat for scene ${sceneCandidates.scene_id}, skipping`);
      continue;
    }
    const notes = [...sceneCandidates.notes];

    const entries = await Promise.all(
      sceneCandidates.candidates.map((c) =>
        limit(() =>
          reviewCandidate(c, beat, {
            cacheDir,
            clipFramesDir,
            client,
          }),
        ),
      ),
    );

    const accepted = entries.filter((e) => e.accept_or_reject === "accept");
    const rejected = entries.filter((e) => e.accept_or_reject === "reject");
    const best = pickBest(entries, sceneCandidates.candidates);

    if (accepted.length === 0 && sceneCandidates.candidates.length > 0) {
      notes.push("all candidates rejected — manual review needed");
    }

    sceneReviews.push({
      scene_id: sceneCandidates.scene_id,
      index: sceneCandidates.index,
      asset_type_needed: (beat.asset_type_needed as SceneReview["asset_type_needed"]),
      accepted_count: accepted.length,
      rejected_count: rejected.length,
      best_asset_id: best?.asset_id ?? null,
      notes,
      entries,
    });

    if (opts.copyApproved) {
      await materializeApprovedRejected(
        accepted,
        rejected,
        sceneCandidates.candidates,
        paths.approvedImagesDir,
        paths.approvedClipsDir,
        paths.rejectedDir,
      );
    }
  }

  const totals = computeTotals(sceneReviews);
  const review: AssetReview = {
    schema_version: "1.0.0",
    project_name: manifest.project_name,
    channel_slug: manifest.channel_slug,
    generated_at: new Date().toISOString(),
    totals,
    scenes: sceneReviews,
  };

  await writeJson(reviewPath, review);
  log.info(
    `review → ${reviewPath} | ${totals.accepted}/${totals.candidates} accepted across ${totals.scenes} scenes (${totals.scenes_without_accepted} have no accepted assets)`,
  );

  return { reviewPath, review };
}

function pickBest(
  entries: AssetReviewEntry[],
  candidates: CandidateAsset[],
): AssetReviewEntry | null {
  const accepted = entries.filter((e) => e.accept_or_reject === "accept");
  if (accepted.length === 0) return null;
  // Composite: relevance dominates, then quality, then tone match.
  const candidateById = new Map(candidates.map((c) => [c.asset_id, c]));
  return accepted
    .slice()
    .sort((a, b) => {
      const score = (e: AssetReviewEntry): number => {
        const c = candidateById.get(e.asset_id);
        const kindBoost = c?.kind === "clip" ? 0.05 : 0; // mild clip preference
        return (
          e.relevance_score * 0.55 +
          e.quality_score * 0.25 +
          e.emotional_tone_match * 0.15 +
          e.vision_confidence * 0.05 +
          kindBoost
        );
      };
      return score(b) - score(a);
    })[0]!;
}

function computeTotals(scenes: SceneReview[]): AssetReview["totals"] {
  let candidates = 0;
  let accepted = 0;
  let rejected = 0;
  let scenesMissing = 0;
  for (const s of scenes) {
    candidates += s.entries.length;
    accepted += s.accepted_count;
    rejected += s.rejected_count;
    if (s.entries.length > 0 && s.accepted_count === 0) scenesMissing++;
  }
  return {
    scenes: scenes.length,
    candidates,
    accepted,
    rejected,
    scenes_without_accepted: scenesMissing,
  };
}

async function materializeApprovedRejected(
  accepted: AssetReviewEntry[],
  rejected: AssetReviewEntry[],
  candidates: CandidateAsset[],
  approvedImagesDir: string,
  approvedClipsDir: string,
  rejectedDir: string,
): Promise<void> {
  const byId = new Map(candidates.map((c) => [c.asset_id, c]));
  for (const e of accepted) {
    const c = byId.get(e.asset_id);
    if (!c) continue;
    const dest =
      c.kind === "image"
        ? path.join(approvedImagesDir, c.scene_id, path.basename(c.local_path))
        : path.join(approvedClipsDir, c.scene_id, path.basename(c.local_path));
    await ensureDir(path.dirname(dest));
    await safeCopy(c.local_path, dest);
  }
  for (const e of rejected) {
    const c = byId.get(e.asset_id);
    if (!c) continue;
    const dest = path.join(
      rejectedDir,
      c.scene_id,
      path.basename(c.local_path),
    );
    await ensureDir(path.dirname(dest));
    await safeCopy(c.local_path, dest);
  }
}

async function safeCopy(src: string, dest: string): Promise<void> {
  try {
    if (await fileExists(dest)) return;
    await fs.copyFile(src, dest);
  } catch (e) {
    log.warn(`copy failed ${src} → ${dest}: ${(e as Error).message}`);
  }
}
