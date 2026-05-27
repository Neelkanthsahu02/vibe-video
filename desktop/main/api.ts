import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { config } from "../../src/config.js";
import {
  ensureDir,
  fileExists,
  readJson,
  slugify,
  writeJson,
} from "../../src/utils/paths.js";
import { resolveProjectPaths } from "../../src/planner/projectIO.js";
import { planScenes } from "../../src/planner/scenePlanner.js";
import { sourceAssetsForProject } from "../../src/sourcing/sourceAssets.js";
import { reviewProjectAssets } from "../../src/review/reviewAssets.js";
import { buildTimelineForProject } from "../../src/timeline/buildTimeline.js";
import { renderProjectTimeline } from "../../src/render/renderTimeline.js";
import type {
  ChannelInfo,
  CreateProjectArgs,
  ManualReplaceArgs,
  ManualReplaceResult,
  Phase,
  PhaseRunOptions,
  PhaseRunResult,
  ProjectInfo,
  ProjectSnapshot,
} from "../../src/desktop/api-types.js";
import type { ChannelStyleProfile } from "../../src/schemas/channelStyleProfile.js";
import type { ScenePlan } from "../../src/schemas/scenePlan.js";
import type {
  CandidateAsset,
  CandidateManifest,
  SceneCandidates,
} from "../../src/schemas/assetCandidates.js";
import type {
  AssetReview,
  AssetReviewEntry,
  SceneReview,
} from "../../src/schemas/assetReview.js";
import type { Timeline } from "../../src/schemas/timeline.js";

export async function listChannels(): Promise<ChannelInfo[]> {
  await ensureDir(config.styleLibraryDir);
  const entries = await safeReaddir(config.styleLibraryDir);
  const result: ChannelInfo[] = [];
  for (const slug of entries) {
    const dir = path.join(config.styleLibraryDir, slug);
    const stat = await safeStat(dir);
    if (!stat?.isDirectory()) continue;
    const profilePath = path.join(dir, "channel_style_profile.json");
    const videoAnalysesDir = path.join(dir, "video_analyses");
    const hasProfile = await fileExists(profilePath);
    let videoCount = 0;
    if (await fileExists(videoAnalysesDir)) {
      videoCount = (await safeReaddir(videoAnalysesDir)).length;
    }
    let name = slug;
    if (hasProfile) {
      try {
        const p = await readJson<ChannelStyleProfile>(profilePath);
        name = p.channel_name;
      } catch {
        /* keep slug */
      }
    }
    result.push({
      slug,
      name,
      hasProfile,
      videoCount,
      profilePath: hasProfile ? profilePath : null,
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listProjects(): Promise<ProjectInfo[]> {
  await ensureDir(config.projectsDir);
  const slugs = await safeReaddir(config.projectsDir);
  const out: ProjectInfo[] = [];
  for (const slug of slugs) {
    const info = await readProjectInfo(slug);
    if (info) out.push(info);
  }
  return out.sort((a, b) => {
    const at = a.createdAtIso ?? "";
    const bt = b.createdAtIso ?? "";
    return bt.localeCompare(at);
  });
}

export async function loadProject(slug: string): Promise<ProjectSnapshot> {
  const info = await readProjectInfo(slug);
  if (!info) throw new Error(`project not found: ${slug}`);
  const paths = await resolveProjectPaths(info.name);
  const candidatesPath = path.join(
    paths.assetsDir,
    "candidates",
    "manifest.json",
  );
  const timelinePath = path.join(paths.renderDir, "timeline.json");
  const reviewPath = path.join(paths.planDir, "asset_review.json");
  const [scenePlan, candidates, review, timeline, channelProfile] = await Promise.all([
    safeReadJson<ScenePlan>(paths.scenePlanJson),
    safeReadJson<CandidateManifest>(candidatesPath),
    safeReadJson<AssetReview>(reviewPath),
    safeReadJson<Timeline>(timelinePath),
    info.channelSlug
      ? safeReadJson<ChannelStyleProfile>(
          path.join(
            config.styleLibraryDir,
            info.channelSlug,
            "channel_style_profile.json",
          ),
        )
      : Promise.resolve(null),
  ]);
  return { info, scenePlan, candidates, review, timeline, channelProfile };
}

export async function createProject(
  args: CreateProjectArgs,
): Promise<ProjectInfo> {
  const trimmed = args.name.trim();
  if (!trimmed) throw new Error("project name is required");
  const slug = slugify(trimmed);
  if (!slug) throw new Error("project name yields an empty slug");

  const paths = await resolveProjectPaths(trimmed);
  // Write a project.json with createdAt + channel binding
  const projectMeta = {
    name: trimmed,
    slug,
    channel_slug: args.channelSlug,
    created_at: new Date().toISOString(),
  };
  await writeJson(path.join(paths.projectDir, "project.json"), projectMeta);

  // Script: from text or copied from path
  const scriptDest = path.join(paths.inputDir, "script.txt");
  if (args.scriptSource.kind === "text") {
    await fs.writeFile(scriptDest, args.scriptSource.text, "utf-8");
  } else {
    await fs.copyFile(args.scriptSource.path, scriptDest);
  }
  // Voiceover: copy with original extension preserved
  const ext = path.extname(args.voiceoverSource.path).toLowerCase() || ".wav";
  const allowed = [".wav", ".mp3", ".m4a", ".flac"];
  const useExt = allowed.includes(ext) ? ext : ".wav";
  const voiceoverDest = path.join(paths.inputDir, `voiceover${useExt}`);
  await fs.copyFile(args.voiceoverSource.path, voiceoverDest);

  const info = await readProjectInfo(slug);
  if (!info) throw new Error("failed to read newly-created project");
  return info;
}

export type ProgressEmit = (
  level: "info" | "warn" | "error",
  text: string,
) => void;

export async function runPhase(
  projectSlug: string,
  phase: Phase,
  options: PhaseRunOptions | undefined,
  emit: ProgressEmit,
): Promise<PhaseRunResult> {
  const start = Date.now();
  const info = await readProjectInfo(projectSlug);
  if (!info) throw new Error(`project not found: ${projectSlug}`);
  if (!info.channelSlug) {
    throw new Error("project has no bound channel — create with --channel");
  }
  emit("info", `starting ${phase} on ${projectSlug}`);
  try {
    let outputPath: string | undefined;
    const warnings: string[] = [];
    switch (phase) {
      case "plan": {
        const res = await planScenes({
          projectName: info.name,
          channelName: info.channelSlug,
          channelSlug: info.channelSlug,
          force: options?.force,
        });
        outputPath = res.scenePlanPath;
        emit(
          "info",
          `plan: ${res.plan.totals.beats} beats, ${res.plan.totals.average_beat_duration.toFixed(2)}s avg`,
        );
        break;
      }
      case "source": {
        const res = await sourceAssetsForProject({
          projectName: info.name,
          force: options?.force,
        });
        outputPath = res.manifestPath;
        emit(
          "info",
          `source: ${res.manifest.totals.images} images, ${res.manifest.totals.clips} clips`,
        );
        break;
      }
      case "review": {
        const res = await reviewProjectAssets({
          projectName: info.name,
          sceneIds: options?.sceneIds,
          force: options?.force,
          copyApproved: false,
        });
        outputPath = res.reviewPath;
        emit(
          "info",
          `review: ${res.review.totals.accepted}/${res.review.totals.candidates} accepted`,
        );
        break;
      }
      case "build-timeline": {
        const res = await buildTimelineForProject({
          projectName: info.name,
        });
        outputPath = res.timelinePath;
        warnings.push(...res.timeline.warnings);
        emit(
          "info",
          `timeline: ${res.timeline.visuals.length} visuals, ${res.timeline.warnings.length} warnings`,
        );
        break;
      }
      case "render": {
        const res = await renderProjectTimeline({
          projectName: info.name,
          rangeSeconds: options?.rangeSeconds,
          overwrite: options?.overwrite ?? true,
        });
        outputPath = res.outputPath;
        emit(
          "info",
          `render: ${res.frames} frames | ${(res.bytes / 1024 / 1024).toFixed(1)} MB`,
        );
        break;
      }
    }
    return {
      ok: true,
      phase,
      message: `${phase} complete`,
      outputPath,
      warnings,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const msg = (e as Error).message;
    emit("error", msg);
    return {
      ok: false,
      phase,
      message: msg,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Manual asset replacement: copy the user's file into
 * candidates/images|clips/<scene_id>/, append a CandidateAsset to the
 * manifest, and optionally insert an accepted AssetReviewEntry that beats
 * the scene's existing best_asset_id.
 */
export async function replaceAsset(
  args: ManualReplaceArgs,
): Promise<ManualReplaceResult> {
  const info = await readProjectInfo(args.projectSlug);
  if (!info) throw new Error(`project not found: ${args.projectSlug}`);
  const paths = await resolveProjectPaths(info.name);
  const manifestPath = path.join(
    paths.assetsDir,
    "candidates",
    "manifest.json",
  );
  const reviewPath = path.join(paths.planDir, "asset_review.json");

  const ext = path.extname(args.sourcePath).toLowerCase();
  const isClip = [".mp4", ".mov", ".webm", ".mkv", ".m4v"].includes(ext);
  const kind: CandidateAsset["kind"] = isClip ? "clip" : "image";
  const destDir =
    kind === "image"
      ? path.join(paths.candidatesImagesDir, args.sceneId)
      : path.join(paths.candidatesClipsDir, args.sceneId);
  await ensureDir(destDir);
  const hash = crypto
    .createHash("sha1")
    .update(args.sourcePath + Date.now())
    .digest("hex")
    .slice(0, 12);
  const filename = `manual_${hash}${ext || (isClip ? ".mp4" : ".jpg")}`;
  const destPath = path.join(destDir, filename);
  await fs.copyFile(args.sourcePath, destPath);
  const stat = await fs.stat(destPath);

  const assetId = `${kind === "image" ? "img" : "clip"}_manual_${hash}`;
  const newCandidate: CandidateAsset = {
    asset_id: assetId,
    kind,
    scene_id: args.sceneId,
    query: "manual replacement",
    source: "manual",
    source_url: pathToFileURL(args.sourcePath).toString(),
    page_url: null,
    title: path.basename(args.sourcePath),
    publisher: "user",
    local_path: destPath,
    width: null,
    height: null,
    duration_seconds: null,
    bytes: stat.size,
    format: ext.replace(/^\./, "") || (isClip ? "mp4" : "jpg"),
    youtube_id: null,
    youtube_channel: null,
    fetched_at: new Date().toISOString(),
  };

  // Update manifest
  let manifest: CandidateManifest | null = await safeReadJson<CandidateManifest>(
    manifestPath,
  );
  let candidatesUpdated = false;
  if (manifest) {
    const sceneEntry = manifest.scenes.find(
      (s) => s.scene_id === args.sceneId,
    );
    if (sceneEntry) {
      sceneEntry.candidates.push(newCandidate);
      sceneEntry.notes.push(`manual replacement at ${newCandidate.fetched_at}`);
    } else {
      manifest.scenes.push(makeSyntheticSceneCandidates(args.sceneId, [newCandidate]));
    }
    manifest.totals.images += kind === "image" ? 1 : 0;
    manifest.totals.clips += kind === "clip" ? 1 : 0;
    manifest.totals.bytes += stat.size;
    await writeJson(manifestPath, manifest);
    candidatesUpdated = true;
  }

  // Update review
  let reviewUpdated = false;
  if (args.markAccepted) {
    const review = await safeReadJson<AssetReview>(reviewPath);
    if (review) {
      const sceneReview = review.scenes.find(
        (s) => s.scene_id === args.sceneId,
      );
      const newEntry: AssetReviewEntry = {
        asset_id: assetId,
        asset_path: destPath,
        scene_id: args.sceneId,
        kind,
        asset_type_needed: sceneReview?.asset_type_needed ?? "unknown",
        accept_or_reject: "accept",
        relevance_score: 1.0,
        quality_score: 0.9,
        emotional_tone_match: 0.9,
        reason: "manual override by user",
        rejection_reasons: [],
        is_watermarked: false,
        is_blurry: false,
        is_stretched: false,
        appears_ai_generated: false,
        contains_text_overlay: false,
        suggested_crop: null,
        suggested_motion: "slow_zoom_in",
        suggested_layout: kind === "clip" ? "fullscreen_clip" : "fullscreen_image",
        best_use_case: "manual replacement",
        best_clip_segment: null,
        vision_confidence: 1.0,
        reviewed_at: new Date().toISOString(),
      };
      if (sceneReview) {
        sceneReview.entries.push(newEntry);
        sceneReview.accepted_count++;
        sceneReview.best_asset_id = assetId;
        sceneReview.notes.push(`manual replacement at ${newEntry.reviewed_at}`);
      } else {
        review.scenes.push(makeSyntheticSceneReview(args.sceneId, newEntry));
      }
      review.totals.candidates++;
      review.totals.accepted++;
      await writeJson(reviewPath, review);
      reviewUpdated = true;
    }
  }

  return {
    newAssetId: assetId,
    newLocalPath: destPath,
    scenePlanUpdated: false,
    reviewUpdated,
    candidatesUpdated,
  };
}

export async function setAssetVerdict(
  projectSlug: string,
  sceneId: string,
  assetId: string,
  accept: boolean,
): Promise<void> {
  const info = await readProjectInfo(projectSlug);
  if (!info) throw new Error(`project not found: ${projectSlug}`);
  const paths = await resolveProjectPaths(info.name);
  const reviewPath = path.join(paths.planDir, "asset_review.json");
  const review = await safeReadJson<AssetReview>(reviewPath);
  if (!review) throw new Error(`no asset_review.json yet for ${projectSlug}`);
  const scene = review.scenes.find((s) => s.scene_id === sceneId);
  if (!scene) throw new Error(`scene ${sceneId} missing in review`);
  const entry = scene.entries.find((e) => e.asset_id === assetId);
  if (!entry) throw new Error(`asset ${assetId} missing in scene ${sceneId}`);

  const prev = entry.accept_or_reject;
  entry.accept_or_reject = accept ? "accept" : "reject";
  entry.reason = `manual ${accept ? "accept" : "reject"} by user`;
  if (prev !== entry.accept_or_reject) {
    if (accept) {
      scene.accepted_count++;
      scene.rejected_count = Math.max(0, scene.rejected_count - 1);
      scene.best_asset_id = assetId;
      review.totals.accepted++;
      review.totals.rejected = Math.max(0, review.totals.rejected - 1);
    } else {
      scene.accepted_count = Math.max(0, scene.accepted_count - 1);
      scene.rejected_count++;
      review.totals.accepted = Math.max(0, review.totals.accepted - 1);
      review.totals.rejected++;
      if (scene.best_asset_id === assetId) {
        const next = scene.entries.find(
          (e) => e.asset_id !== assetId && e.accept_or_reject === "accept",
        );
        scene.best_asset_id = next?.asset_id ?? null;
      }
    }
  }
  await writeJson(reviewPath, review);
}

export function toFileUrl(absolutePath: string): string {
  return pathToFileURL(absolutePath).toString();
}

// ── helpers ───────────────────────────────────────────────────────────

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    const items = await fs.readdir(dir, { withFileTypes: true });
    return items
      .filter((d) => !d.name.startsWith(".") && d.name !== "node_modules")
      .map((d) => d.name);
  } catch {
    return [];
  }
}

async function safeStat(p: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function safeReadJson<T>(p: string): Promise<T | null> {
  if (!(await fileExists(p))) return null;
  try {
    return await readJson<T>(p);
  } catch {
    return null;
  }
}

async function readProjectInfo(slug: string): Promise<ProjectInfo | null> {
  const projectDir = path.join(config.projectsDir, slug);
  const stat = await safeStat(projectDir);
  if (!stat?.isDirectory()) return null;
  const metaPath = path.join(projectDir, "project.json");
  const meta = await safeReadJson<{
    name?: string;
    slug?: string;
    channel_slug?: string;
    created_at?: string;
  }>(metaPath);
  const name = meta?.name ?? slug;
  const channelSlug = meta?.channel_slug ?? null;
  const createdAtIso = meta?.created_at ?? null;

  const inputDir = path.join(projectDir, "input");
  const scriptPath = path.join(inputDir, "script.txt");
  let voiceoverPath: string | null = null;
  for (const f of await safeReaddir(inputDir)) {
    if (f.toLowerCase().startsWith("voiceover.")) {
      voiceoverPath = path.join(inputDir, f);
      break;
    }
  }
  const scenePlanJson = path.join(projectDir, "plan", "scene_plan.json");
  const candidatesPath = path.join(
    projectDir,
    "assets",
    "candidates",
    "manifest.json",
  );
  const reviewPath = path.join(projectDir, "plan", "asset_review.json");
  const timelinePath = path.join(projectDir, "render", "timeline.json");
  const exportsDir = path.join(projectDir, "exports");
  const exportFiles = (await safeReaddir(exportsDir))
    .filter((f) => /\.(mp4|mov|webm)$/i.test(f))
    .map((f) => path.join(exportsDir, f));

  return {
    slug,
    name,
    channelSlug,
    hasScript: await fileExists(scriptPath),
    hasVoiceover: !!voiceoverPath,
    scriptPath: (await fileExists(scriptPath)) ? scriptPath : null,
    voiceoverPath,
    hasScenePlan: await fileExists(scenePlanJson),
    hasCandidates: await fileExists(candidatesPath),
    hasReview: await fileExists(reviewPath),
    hasTimeline: await fileExists(timelinePath),
    exportsDir,
    exports: exportFiles,
    createdAtIso,
  };
}

function makeSyntheticSceneCandidates(
  sceneId: string,
  candidates: CandidateAsset[],
): SceneCandidates {
  return {
    scene_id: sceneId,
    index: 0,
    start_time: 0,
    end_time: 0,
    asset_type_needed: "unknown",
    image_search_queries: [],
    youtube_clip_search_queries: [],
    headline_search_queries: [],
    candidates,
    notes: ["synthesized for manual replacement"],
  };
}

function makeSyntheticSceneReview(
  sceneId: string,
  entry: AssetReviewEntry,
): SceneReview {
  return {
    scene_id: sceneId,
    index: 0,
    asset_type_needed: entry.asset_type_needed,
    accepted_count: 1,
    rejected_count: 0,
    best_asset_id: entry.asset_id,
    notes: ["synthesized for manual replacement"],
    entries: [entry],
  };
}
