import { z } from "zod";
import {
  AssetTypeSchema,
  CameraMotionSchema,
} from "./videoAnalysis.js";
import { SuggestedVisualLayoutSchema } from "./scenePlan.js";

export const VerdictSchema = z.enum(["accept", "reject"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const RejectionReasonSchema = z.enum([
  "wrong_person",
  "wrong_topic",
  "irrelevant",
  "low_quality",
  "blurry",
  "stretched",
  "watermarked",
  "low_resolution",
  "wrong_emotional_tone",
  "duplicate",
  "unsafe_or_explicit",
  "ai_generated_or_synthetic",
  "broken_or_corrupt",
  "other",
]);
export type RejectionReason = z.infer<typeof RejectionReasonSchema>;

/**
 * Normalized crop rectangle. All four values in [0, 1] relative to the
 * source asset; (0,0) is top-left. width and height are extents, not the
 * opposite corner.
 */
export const NormalizedCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  /** Subject focal point inside the crop, normalized to the crop rect. */
  focus_x: z.number().min(0).max(1).default(0.5),
  focus_y: z.number().min(0).max(1).default(0.5),
});
export type NormalizedCrop = z.infer<typeof NormalizedCropSchema>;

export const AssetReviewEntrySchema = z.object({
  asset_id: z.string(),
  asset_path: z.string(),
  scene_id: z.string(),
  kind: z.enum(["image", "clip"]),
  asset_type_needed: AssetTypeSchema,
  accept_or_reject: VerdictSchema,
  relevance_score: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  emotional_tone_match: z.number().min(0).max(1),
  reason: z.string(),
  rejection_reasons: z.array(RejectionReasonSchema).default([]),
  is_watermarked: z.boolean().default(false),
  is_blurry: z.boolean().default(false),
  is_stretched: z.boolean().default(false),
  appears_ai_generated: z.boolean().default(false),
  contains_text_overlay: z.boolean().default(false),
  suggested_crop: NormalizedCropSchema.nullable().default(null),
  suggested_motion: CameraMotionSchema,
  suggested_layout: SuggestedVisualLayoutSchema,
  best_use_case: z.string(),
  /** For clips: best sub-segment to use, in seconds within the clip. */
  best_clip_segment: z
    .object({ start: z.number(), end: z.number() })
    .nullable()
    .default(null),
  vision_confidence: z.number().min(0).max(1).default(0.5),
  reviewed_at: z.string(),
});
export type AssetReviewEntry = z.infer<typeof AssetReviewEntrySchema>;

export const SceneReviewSchema = z.object({
  scene_id: z.string(),
  index: z.number().int(),
  asset_type_needed: AssetTypeSchema,
  accepted_count: z.number().int(),
  rejected_count: z.number().int(),
  best_asset_id: z.string().nullable(),
  notes: z.array(z.string()).default([]),
  entries: z.array(AssetReviewEntrySchema),
});
export type SceneReview = z.infer<typeof SceneReviewSchema>;

export const AssetReviewSchema = z.object({
  schema_version: z.literal("1.0.0"),
  project_name: z.string(),
  channel_slug: z.string(),
  generated_at: z.string(),
  totals: z.object({
    scenes: z.number().int(),
    candidates: z.number().int(),
    accepted: z.number().int(),
    rejected: z.number().int(),
    scenes_without_accepted: z.number().int(),
  }),
  scenes: z.array(SceneReviewSchema),
});
export type AssetReview = z.infer<typeof AssetReviewSchema>;
