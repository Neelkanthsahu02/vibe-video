import path from "node:path";
import { createLogger } from "../utils/logger.js";
import { config } from "../config.js";
import {
  fileExists,
  readJson,
  writeJson,
  ensureDir,
} from "../utils/paths.js";
import { resolveProjectPaths, loadStyleProfile } from "../planner/projectIO.js";
import { loadAssetPacks } from "../assets/packLoader.js";
import { pickVisualForBeat } from "./assetPickers.js";
import { resolveTransition } from "./transitionResolver.js";
import { scheduleMusic } from "./musicScheduler.js";
import { scheduleSfx } from "./sfxScheduler.js";
import type {
  Timeline,
  VisualClip,
  OverlaySpec,
} from "../schemas/timeline.js";
import type { ScenePlan, ScenePlanBeat } from "../schemas/scenePlan.js";
import type {
  CandidateManifest,
  CandidateAsset,
} from "../schemas/assetCandidates.js";
import type {
  AssetReview,
  AssetReviewEntry,
} from "../schemas/assetReview.js";
import type {
  CameraMotion,
  AssetType,
} from "../schemas/videoAnalysis.js";
import type { SuggestedVisualLayoutSchema } from "../schemas/scenePlan.js";
import type { z } from "zod";

const log = createLogger("timeline");

export interface BuildTimelineOptions {
  projectName: string;
  /** Override composition resolution (defaults to 1920x1080). */
  width?: number;
  height?: number;
  /** Override frame rate (defaults to 30). */
  fps?: number;
  /** Skip music scheduling. */
  skipMusic?: boolean;
  /** Skip SFX scheduling. */
  skipSfx?: boolean;
  /** Show debug captions on the timeline (narration text overlay). */
  captions?: boolean;
}

export interface BuildTimelineResult {
  timelinePath: string;
  timeline: Timeline;
}

type SuggestedLayout = z.infer<typeof SuggestedVisualLayoutSchema>;

const PORTRAIT_LAYOUT_FOR_TALL: SuggestedLayout = "blurred_fill_portrait";
const STILL_DEFAULT_MOTION: CameraMotion = "slow_zoom_in";

export async function buildTimelineForProject(
  opts: BuildTimelineOptions,
): Promise<BuildTimelineResult> {
  const paths = await resolveProjectPaths(opts.projectName);
  const manifestPath = path.join(paths.assetsDir, "candidates", "manifest.json");

  if (!(await fileExists(paths.scenePlanJson))) {
    throw new Error(
      `scene_plan.json missing at ${paths.scenePlanJson}. Run \`vibe plan\` first.`,
    );
  }
  if (!(await fileExists(manifestPath))) {
    throw new Error(
      `candidates/manifest.json missing at ${manifestPath}. Run \`vibe source\` first.`,
    );
  }
  const reviewPath = path.join(paths.planDir, "asset_review.json");
  if (!(await fileExists(reviewPath))) {
    throw new Error(
      `asset_review.json missing at ${reviewPath}. Run \`vibe review\` first.`,
    );
  }

  const [plan, manifest, review] = await Promise.all([
    readJson<ScenePlan>(paths.scenePlanJson),
    readJson<CandidateManifest>(manifestPath),
    readJson<AssetReview>(reviewPath),
  ]);

  const { profile, profilePath } = await loadStyleProfile(plan.channel_slug);
  const packs = await loadAssetPacks(config.assetLibraryDir);

  const candidatesByScene = new Map(
    manifest.scenes.map((s) => [s.scene_id, s]),
  );
  const reviewByScene = new Map(review.scenes.map((s) => [s.scene_id, s]));

  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const fps = opts.fps ?? 30;

  const warnings: string[] = [];
  const visuals: VisualClip[] = [];

  for (const beat of plan.beats) {
    const picked = pickVisualForBeat(
      beat,
      candidatesByScene.get(beat.scene_id),
      reviewByScene.get(beat.scene_id),
    );
    const visual = buildVisualClip(
      beat,
      picked.candidate,
      picked.review,
      picked.reason,
      profile.transition_rules,
      packs.transitions,
      profile,
      width,
      height,
      opts.captions ?? false,
    );
    if (visual.warning) {
      warnings.push(`beat ${beat.scene_id}: ${visual.warning}`);
    }
    visuals.push(visual);
  }

  // Resolve transition `out` for each beat as `in` for the next beat where
  // the next beat had it unresolved.
  for (let i = 0; i < visuals.length - 1; i++) {
    const a = visuals[i]!;
    const b = visuals[i + 1]!;
    if (a.transition_out.type === "unknown" && b.transition_in.type !== "unknown") {
      a.transition_out = { ...b.transition_in };
    }
    if (b.transition_in.type === "unknown" && a.transition_out.type !== "unknown") {
      b.transition_in = { ...a.transition_out };
    }
  }

  const musicCues = opts.skipMusic ? [] : scheduleMusic(plan, profile, packs.music);
  const sfxCues = opts.skipSfx ? [] : scheduleSfx(plan, profile, packs.sfx);

  const duckWindows = computeDuckWindows(plan);

  // Fold music_rules.duck_under_narration into per-cue gain envelope hints
  if (!profile.music_rules.duck_under_narration) {
    for (const c of musicCues) c.duck_gain = c.gain;
  }

  const timeline: Timeline = {
    schema_version: "1.0.0",
    project_name: plan.project_name,
    channel_slug: plan.channel_slug,
    generated_at: new Date().toISOString(),
    composition: {
      width,
      height,
      fps,
      duration_seconds: Math.max(
        plan.voiceover_duration,
        visuals.reduce((m, v) => Math.max(m, v.start_seconds + v.duration_seconds), 0),
      ),
      background_color: "#000000",
    },
    audio: {
      voiceover_path: plan.voiceover_path,
      voiceover_gain: 1.0,
      music_cues: musicCues,
      sfx_cues: sfxCues,
      duck_windows: duckWindows,
    },
    visuals,
    warnings,
    source: {
      scene_plan_path: paths.scenePlanJson,
      asset_review_path: reviewPath,
      style_profile_path: profilePath,
      asset_library_dir: config.assetLibraryDir,
    },
  };

  await ensureDir(paths.renderDir);
  const timelinePath = path.join(paths.renderDir, "timeline.json");
  await writeJson(timelinePath, timeline);
  log.info(
    `timeline.json → ${timelinePath} | ${visuals.length} visuals | ${musicCues.length} music cues | ${sfxCues.length} SFX cues | ${warnings.length} warnings`,
  );
  return { timelinePath, timeline };
}

function buildVisualClip(
  beat: ScenePlanBeat,
  candidate: CandidateAsset | null,
  review: AssetReviewEntry | null,
  pickReason: string,
  transitionRules: Awaited<ReturnType<typeof loadStyleProfile>>["profile"]["transition_rules"],
  transitionPack: Awaited<ReturnType<typeof loadAssetPacks>>["transitions"],
  profile: Awaited<ReturnType<typeof loadStyleProfile>>["profile"],
  width: number,
  height: number,
  captions: boolean,
): VisualClip {
  const layout: SuggestedLayout =
    review?.suggested_layout ?? (beat.suggested_visual_layout as SuggestedLayout);
  const motion: CameraMotion =
    review?.suggested_motion ?? (beat.camera_motion as CameraMotion);
  const crop = review?.suggested_crop ?? null;

  let kind: VisualClip["kind"] = "color_fill";
  let assetPath: string | null = null;
  let warning: string | null = null;

  if (candidate && (!review || review.accept_or_reject === "accept")) {
    if (candidate.kind === "image") {
      kind = "image";
    } else if (candidate.kind === "clip") {
      kind = "clip";
    }
    assetPath = candidate.local_path;
  } else if (candidate && review && review.accept_or_reject === "reject") {
    kind = candidate.kind === "clip" ? "clip" : "image";
    assetPath = candidate.local_path;
    warning = `using rejected candidate as fallback (${review.reason.slice(0, 100)})`;
  } else {
    warning = `no visual asset available: ${pickReason}`;
  }

  // Auto blurred-fill for portrait/tall images shown fullscreen
  let resolvedLayout = layout;
  if (
    kind === "image" &&
    candidate?.width &&
    candidate?.height &&
    candidate.height > candidate.width &&
    (layout === "fullscreen_image" || layout === "ken_burns_image")
  ) {
    resolvedLayout = PORTRAIT_LAYOUT_FOR_TALL;
  }
  // Special asset types
  const assetType: AssetType = (beat.asset_type_needed as AssetType) ?? "unknown";
  if (assetType === "title_card") kind = "title_card";
  if (assetType === "lower_third" && !assetPath) kind = "lower_third_card";
  if (assetType === "motion_graphic" && !assetPath) kind = "motion_graphic";
  if (assetType === "animated_background" && !assetPath) kind = "animated_background";

  // Motion default for stills
  const finalMotion: CameraMotion =
    kind === "image" && (motion === "unknown" || motion === "static")
      ? STILL_DEFAULT_MOTION
      : motion;

  // Clip subsegment from review
  const clipSegment =
    kind === "clip" && review?.best_clip_segment
      ? review.best_clip_segment
      : null;

  const overlays = buildOverlays(beat, captions);

  const transitionIn = resolveTransition(
    beat.transition_in,
    beat.script_function,
    profile,
    transitionPack,
  );
  const transitionOut = resolveTransition(
    beat.transition_out,
    beat.script_function,
    profile,
    transitionPack,
  );

  return {
    scene_id: beat.scene_id,
    index: beat.index,
    start_seconds: beat.start_time,
    duration_seconds: beat.duration,
    kind,
    asset_path: assetPath,
    source_asset_id: candidate?.asset_id ?? null,
    layout: resolvedLayout,
    motion: finalMotion,
    crop,
    clip_segment: clipSegment,
    clip_audio_gain: 0,
    overlays,
    transition_in: transitionIn,
    transition_out: transitionOut,
    style_rule: beat.style_library_rule_used,
    narration_text: beat.narration_text,
    warning,
  };
  void transitionRules;
  void width;
  void height;
}

function buildOverlays(beat: ScenePlanBeat, captions: boolean): OverlaySpec[] {
  const out: OverlaySpec[] = [];
  if (beat.title_card_text) {
    out.push({
      kind: "title_card_text",
      text: beat.title_card_text,
      in_seconds: 0,
      duration_seconds: null,
      template_path: null,
      position: "center",
    });
  }
  if (beat.lower_third_text) {
    out.push({
      kind: "lower_third",
      text: beat.lower_third_text,
      in_seconds: 0.2,
      duration_seconds: Math.min(beat.duration - 0.4, 4.0),
      template_path: null,
      position: "lower_third",
    });
  }
  if (beat.overlay_text) {
    out.push({
      kind: "text_overlay",
      text: beat.overlay_text,
      in_seconds: 0,
      duration_seconds: null,
      template_path: null,
      position: "top_center",
    });
  }
  if (captions && beat.narration_text) {
    out.push({
      kind: "captions",
      text: beat.narration_text,
      in_seconds: 0,
      duration_seconds: null,
      template_path: null,
      position: "bottom_center",
    });
  }
  return out;
}

/**
 * Duck music whenever a beat has narration. We treat every beat as
 * narration-active and merge contiguous windows for compactness.
 */
function computeDuckWindows(
  plan: ScenePlan,
): Array<{ start_seconds: number; end_seconds: number }> {
  const out: Array<{ start_seconds: number; end_seconds: number }> = [];
  for (const b of plan.beats) {
    const last = out[out.length - 1];
    if (last && b.start_time - last.end_seconds < 0.4) {
      last.end_seconds = b.end_time;
    } else {
      out.push({ start_seconds: b.start_time, end_seconds: b.end_time });
    }
  }
  return out;
}
