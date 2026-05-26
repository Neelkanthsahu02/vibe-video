import path from "node:path";
import { OpenRouterClient } from "../openrouter/client.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/paths.js";
import { sampleClipFrames } from "./clipFrames.js";
import type { CandidateAsset } from "../schemas/assetCandidates.js";
import type { ScenePlanBeat } from "../schemas/scenePlan.js";
import type { AssetReviewEntry } from "../schemas/assetReview.js";
import {
  RejectionReasonSchema,
  VerdictSchema,
} from "../schemas/assetReview.js";
import {
  AssetTypeSchema,
  CameraMotionSchema,
} from "../schemas/videoAnalysis.js";
import { SuggestedVisualLayoutSchema } from "../schemas/scenePlan.js";

const log = createLogger("review");

const SYSTEM = `You are the visual editor reviewing one candidate asset
(image or short video clip) for a single beat in a YouTube celebrity-
documentary video. Be strict — wrong/blurry/watermarked/AI-generated
material must be rejected. The downstream editor will only use
"accept"-ed assets.

Return EXACTLY this JSON object:

{
  "accept_or_reject": "accept" | "reject",
  "relevance_score": number 0..1,
  "quality_score": number 0..1,
  "emotional_tone_match": number 0..1,
  "reason": "1-2 sentence justification grounded in what you see",
  "rejection_reasons": [/* zero or more of: "wrong_person","wrong_topic",
    "irrelevant","low_quality","blurry","stretched","watermarked",
    "low_resolution","wrong_emotional_tone","duplicate",
    "unsafe_or_explicit","ai_generated_or_synthetic","broken_or_corrupt",
    "other" */],
  "is_watermarked": boolean,
  "is_blurry": boolean,
  "is_stretched": boolean,
  "appears_ai_generated": boolean,
  "contains_text_overlay": boolean,
  "suggested_crop": {
    "x": 0..1, "y": 0..1, "width": 0..1, "height": 0..1,
    "focus_x": 0..1, "focus_y": 0..1
  } | null,
  "suggested_motion": one of:
    "slow_zoom_in","slow_zoom_out","pan_left","pan_right","push_in",
    "static","blurred_background_fill","split_screen","framed_image",
    "unknown",
  "suggested_layout": one of:
    "fullscreen_image","fullscreen_clip","blurred_fill_portrait",
    "split_screen","framed_inset","headline_card","title_card",
    "lower_third_over_clip","motion_graphic_only","stacked_quote_card",
    "ken_burns_image","unknown",
  "best_use_case": "1 short sentence describing how the editor should use this asset",
  "best_clip_segment": { "start": seconds_within_clip, "end": seconds_within_clip } | null,
  "vision_confidence": number 0..1
}

Rules:
- Coordinates are normalized to the asset (0,0 = top-left, 1,1 = bottom-right).
- "suggested_crop" can be null only if the entire asset already frames well.
- "best_clip_segment" applies only to clips; for images return null.
- Reject anything that is obviously AI-generated or synthetic.
- Reject anything watermarked (Shutterstock, Getty preview, etc.).
- Output ONLY the JSON object. No prose, no markdown fences.`;

function userPromptForImage(beat: ScenePlanBeat, candidate: CandidateAsset, dims: string): string {
  return [
    `Beat scene_id=${beat.scene_id} script_function=${beat.script_function}`,
    `narration: """${beat.narration_text}"""`,
    `visual_goal: ${beat.visual_goal}`,
    `asset_type_needed: ${beat.asset_type_needed}`,
    `emotional_tone: ${beat.emotional_tone}`,
    `suggested_layout (from planner): ${beat.suggested_visual_layout}`,
    `image source query: "${candidate.query}"`,
    `image source: ${candidate.publisher ?? "(unknown)"} via ${candidate.source}`,
    `image dimensions: ${dims}`,
    "",
    "Review the attached image and return the JSON object.",
  ].join("\n");
}

function userPromptForClip(
  beat: ScenePlanBeat,
  candidate: CandidateAsset,
  duration: number,
  timestamps: number[],
): string {
  return [
    `Beat scene_id=${beat.scene_id} script_function=${beat.script_function}`,
    `narration: """${beat.narration_text}"""`,
    `visual_goal: ${beat.visual_goal}`,
    `asset_type_needed: ${beat.asset_type_needed}`,
    `emotional_tone: ${beat.emotional_tone}`,
    `clip duration: ${duration.toFixed(1)}s`,
    `clip source: ${candidate.publisher ?? candidate.youtube_channel ?? "(unknown)"} — ${candidate.title ?? ""}`,
    `clip query: "${candidate.query}"`,
    `attached frames sampled at: ${timestamps.map((t) => `${t.toFixed(1)}s`).join(", ")}`,
    "",
    "Review the clip frames and return the JSON object. best_clip_segment should reference seconds within the source clip.",
  ].join("\n");
}

function safeEnum<T extends string>(
  v: unknown,
  values: ReadonlyArray<T>,
  fallback: T,
): T {
  return typeof v === "string" && (values as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

function safeNumber01(v: unknown, fallback = 0.5): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function normalize(
  raw: unknown,
  candidate: CandidateAsset,
  beat: ScenePlanBeat,
): AssetReviewEntry {
  const o = (raw ?? {}) as Record<string, unknown>;
  const reasons = Array.isArray(o.rejection_reasons)
    ? (o.rejection_reasons as unknown[])
        .map((x) =>
          safeEnum(x, RejectionReasonSchema.options, "other"),
        )
        .filter((v, i, arr) => arr.indexOf(v) === i)
    : [];

  const cropRaw = o.suggested_crop as Record<string, unknown> | null | undefined;
  const suggested_crop =
    cropRaw && typeof cropRaw === "object"
      ? {
          x: safeNumber01(cropRaw.x, 0),
          y: safeNumber01(cropRaw.y, 0),
          width: safeNumber01(cropRaw.width, 1),
          height: safeNumber01(cropRaw.height, 1),
          focus_x: safeNumber01(cropRaw.focus_x, 0.5),
          focus_y: safeNumber01(cropRaw.focus_y, 0.5),
        }
      : null;

  const seg = o.best_clip_segment as { start?: unknown; end?: unknown } | null | undefined;
  const best_clip_segment =
    seg && typeof seg === "object" && typeof seg.start === "number" && typeof seg.end === "number"
      ? { start: seg.start as number, end: seg.end as number }
      : null;

  return {
    asset_id: candidate.asset_id,
    asset_path: candidate.local_path,
    scene_id: candidate.scene_id,
    kind: candidate.kind,
    asset_type_needed: safeEnum(
      beat.asset_type_needed,
      AssetTypeSchema.options,
      "unknown",
    ),
    accept_or_reject: safeEnum(
      o.accept_or_reject,
      VerdictSchema.options,
      "reject",
    ),
    relevance_score: safeNumber01(o.relevance_score, 0),
    quality_score: safeNumber01(o.quality_score, 0),
    emotional_tone_match: safeNumber01(o.emotional_tone_match, 0),
    reason: String(o.reason ?? ""),
    rejection_reasons: reasons,
    is_watermarked: Boolean(o.is_watermarked),
    is_blurry: Boolean(o.is_blurry),
    is_stretched: Boolean(o.is_stretched),
    appears_ai_generated: Boolean(o.appears_ai_generated),
    contains_text_overlay: Boolean(o.contains_text_overlay),
    suggested_crop,
    suggested_motion: safeEnum(
      o.suggested_motion,
      CameraMotionSchema.options,
      "static",
    ),
    suggested_layout: safeEnum(
      o.suggested_layout,
      SuggestedVisualLayoutSchema.options,
      "fullscreen_image",
    ),
    best_use_case: String(o.best_use_case ?? ""),
    best_clip_segment,
    vision_confidence: safeNumber01(o.vision_confidence, 0.5),
    reviewed_at: new Date().toISOString(),
  };
}

export interface ReviewCandidateOptions {
  /** Directory to extract clip frames into (per-project cache). */
  clipFramesDir: string;
  /** Per-candidate review cache directory. */
  cacheDir: string;
  client?: OpenRouterClient;
}

export async function reviewCandidate(
  candidate: CandidateAsset,
  beat: ScenePlanBeat,
  opts: ReviewCandidateOptions,
): Promise<AssetReviewEntry> {
  const client = opts.client ?? new OpenRouterClient();
  await ensureDir(opts.cacheDir);
  const cache = path.join(opts.cacheDir, `${candidate.asset_id}.json`);
  if (await fileExists(cache)) {
    try {
      return await readJson<AssetReviewEntry>(cache);
    } catch {
      // fall through and re-review
    }
  }

  let framePaths: string[];
  let userPrompt: string;
  if (candidate.kind === "image") {
    framePaths = [candidate.local_path];
    const dims =
      candidate.width && candidate.height
        ? `${candidate.width}x${candidate.height}`
        : "unknown";
    userPrompt = userPromptForImage(beat, candidate, dims);
  } else {
    const samples = await sampleClipFrames(
      candidate.local_path,
      path.join(opts.clipFramesDir, candidate.scene_id),
      candidate.asset_id,
    );
    framePaths = samples.framePaths;
    userPrompt = userPromptForClip(
      beat,
      candidate,
      samples.duration,
      samples.timestamps,
    );
  }

  try {
    const raw = await client.visionJson<unknown>(
      SYSTEM,
      userPrompt,
      framePaths,
      { temperature: 0.1, maxTokens: 900 },
    );
    const entry = normalize(raw, candidate, beat);
    await writeJson(cache, entry);
    return entry;
  } catch (e) {
    log.warn(
      `review failed for ${candidate.asset_id}: ${(e as Error).message}`,
    );
    const fallback: AssetReviewEntry = normalize({}, candidate, beat);
    fallback.reason = `vision_error: ${(e as Error).message.slice(0, 200)}`;
    fallback.vision_confidence = 0;
    return fallback;
  }
}

// Pull in OpenRouter dependency at module load for config validation surface.
export { OpenRouterClient } from "../openrouter/client.js";
void config;
