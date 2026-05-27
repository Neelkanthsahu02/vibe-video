import { z } from "zod";
import {
  CameraMotionSchema,
  TransitionTypeSchema,
} from "./videoAnalysis.js";
import { SuggestedVisualLayoutSchema } from "./scenePlan.js";
import { NormalizedCropSchema } from "./assetReview.js";

export const VisualClipKindSchema = z.enum([
  "image",
  "clip",
  "title_card",
  "lower_third_card",
  "motion_graphic",
  "animated_background",
  "color_fill",
]);
export type VisualClipKind = z.infer<typeof VisualClipKindSchema>;

export const TransitionSpecSchema = z.object({
  type: TransitionTypeSchema,
  duration_seconds: z.number().nonnegative().default(0.4),
  /** Optional path to a transition video/PNG-sequence asset from the pack. */
  asset_path: z.string().nullable().default(null),
  /** Source rule (e.g. "transition_rules.by_context.scandal[0]"). */
  source_rule: z.string().nullable().default(null),
});
export type TransitionSpec = z.infer<typeof TransitionSpecSchema>;

export const OverlaySpecSchema = z.object({
  kind: z.enum([
    "text_overlay",
    "lower_third",
    "title_card_text",
    "headline_card_text",
    "captions",
  ]),
  text: z.string(),
  /** Begin time relative to the visual clip's start. */
  in_seconds: z.number().default(0),
  /** Hold duration. If null, hold until end of clip. */
  duration_seconds: z.number().nullable().default(null),
  /** Optional background template path from asset-library/. */
  template_path: z.string().nullable().default(null),
  position: z
    .enum(["bottom_left", "bottom_center", "lower_third", "center", "top_center"])
    .default("lower_third"),
});
export type OverlaySpec = z.infer<typeof OverlaySpecSchema>;

export const VisualClipSchema = z.object({
  scene_id: z.string(),
  index: z.number().int().nonnegative(),
  start_seconds: z.number().nonnegative(),
  duration_seconds: z.number().nonnegative(),
  kind: VisualClipKindSchema,
  asset_path: z.string().nullable(),
  /** Source of the picked asset_id (from asset_review.json) for traceability. */
  source_asset_id: z.string().nullable().default(null),
  layout: SuggestedVisualLayoutSchema,
  motion: CameraMotionSchema,
  crop: NormalizedCropSchema.nullable().default(null),
  /** For clips: subsection in seconds within the source clip. */
  clip_segment: z
    .object({ start: z.number(), end: z.number() })
    .nullable()
    .default(null),
  /** Volume of any baked-in clip audio (we usually mute and rely on voiceover). */
  clip_audio_gain: z.number().min(0).max(1).default(0),
  overlays: z.array(OverlaySpecSchema).default([]),
  transition_in: TransitionSpecSchema,
  transition_out: TransitionSpecSchema,
  /** Style-library citation that drove this beat. */
  style_rule: z.string().default(""),
  /** Narration text for captions/debug. */
  narration_text: z.string().default(""),
  /** Reason this beat could not find an accepted asset, if any. */
  warning: z.string().nullable().default(null),
});
export type VisualClip = z.infer<typeof VisualClipSchema>;

export const MusicCueSchema = z.object({
  path: z.string(),
  start_seconds: z.number().nonnegative(),
  duration_seconds: z.number().nonnegative(),
  mood: z.string(),
  gain: z.number().min(0).max(1).default(0.6),
  duck_gain: z.number().min(0).max(1).default(0.15),
  fade_in_seconds: z.number().min(0).default(1.0),
  fade_out_seconds: z.number().min(0).default(1.5),
});
export type MusicCue = z.infer<typeof MusicCueSchema>;

export const SfxCueSchema = z.object({
  path: z.string(),
  at_seconds: z.number().nonnegative(),
  gain: z.number().min(0).max(1).default(0.8),
  source_rule: z.string().nullable().default(null),
  scene_id: z.string().nullable().default(null),
});
export type SfxCue = z.infer<typeof SfxCueSchema>;

export const TimelineSchema = z.object({
  schema_version: z.literal("1.0.0"),
  project_name: z.string(),
  channel_slug: z.string(),
  generated_at: z.string(),
  composition: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    duration_seconds: z.number().nonnegative(),
    background_color: z.string().default("#000000"),
  }),
  audio: z.object({
    voiceover_path: z.string(),
    voiceover_gain: z.number().min(0).max(1).default(1.0),
    music_cues: z.array(MusicCueSchema),
    sfx_cues: z.array(SfxCueSchema),
    /** Time windows where music ducks under narration. */
    duck_windows: z.array(
      z.object({
        start_seconds: z.number(),
        end_seconds: z.number(),
      }),
    ),
  }),
  visuals: z.array(VisualClipSchema),
  warnings: z.array(z.string()).default([]),
  source: z.object({
    scene_plan_path: z.string(),
    asset_review_path: z.string(),
    style_profile_path: z.string(),
    asset_library_dir: z.string(),
  }),
});
export type Timeline = z.infer<typeof TimelineSchema>;
