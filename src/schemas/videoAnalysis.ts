import { z } from "zod";

/* Asset type taxonomy used in beats. Keep aligned with prompts. */
export const AssetTypeSchema = z.enum([
  "celebrity_photo",
  "event_photo",
  "interview_clip",
  "paparazzi_clip",
  "news_headline_screenshot",
  "social_media_screenshot",
  "animated_background",
  "title_card",
  "lower_third",
  "motion_graphic",
  "mixed_layout",
  "unknown",
]);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const CameraMotionSchema = z.enum([
  "slow_zoom_in",
  "slow_zoom_out",
  "pan_left",
  "pan_right",
  "push_in",
  "static",
  "blurred_background_fill",
  "split_screen",
  "framed_image",
  "unknown",
]);
export type CameraMotion = z.infer<typeof CameraMotionSchema>;

export const TransitionTypeSchema = z.enum([
  "hard_cut",
  "flash",
  "fade_to_black",
  "fade_from_black",
  "fade_to_white",
  "fade_from_white",
  "zoom_blur",
  "motion_blur",
  "wipe",
  "glitch",
  "light_leak",
  "dissolve",
  "overlay",
  "unknown",
]);
export type TransitionType = z.infer<typeof TransitionTypeSchema>;

export const MusicMoodSchema = z.enum([
  "sad_emotional",
  "tense_documentary",
  "neutral_narrative",
  "energetic_reveal",
  "uplifting",
  "dark_scandal",
  "unknown",
]);

export const EmotionalPurposeSchema = z.enum([
  "hook",
  "context",
  "setup",
  "betrayal",
  "scandal",
  "reveal",
  "emotional_reflection",
  "timeline_explanation",
  "public_reaction",
  "ending",
  "filler",
  "unknown",
]);

export const TransitionEventSchema = z.object({
  at: z.number(),
  type: TransitionTypeSchema,
  duration_frames: z.number().int().nonnegative(),
  confidence: z.number(),
  reason: z.string(),
  matched_asset: z.string().nullable().optional(),
});
export type TransitionEvent = z.infer<typeof TransitionEventSchema>;

export const SfxMatchSchema = z.object({
  sfx_filename: z.string(),
  timestamp: z.number(),
  duration: z.number(),
  confidence: z.number(),
  reason: z.string().optional(),
});
export type SfxMatch = z.infer<typeof SfxMatchSchema>;

export const BeatSchema = z.object({
  index: z.number().int().nonnegative(),
  start_time: z.number(),
  end_time: z.number(),
  duration: z.number(),
  visual_description: z.string(),
  asset_type: AssetTypeSchema,
  camera_motion: CameraMotionSchema,
  text_overlays: z.array(z.string()).default([]),
  title_card_text: z.string().nullable().default(null),
  lower_third_text: z.string().nullable().default(null),
  headline_text: z.string().nullable().default(null),
  transition_in: TransitionTypeSchema.default("unknown"),
  transition_out: TransitionTypeSchema.default("unknown"),
  likely_sfx: z.array(z.string()).default([]),
  music_mood: MusicMoodSchema.default("unknown"),
  music_intensity: z.number().min(0).max(1).default(0),
  emotional_purpose: EmotionalPurposeSchema.default("unknown"),
  vision_confidence: z.number().min(0).max(1).default(0.5),
  notes: z.string().default(""),
});
export type Beat = z.infer<typeof BeatSchema>;

export const VisualStyleRulesSchema = z.object({
  image_crop_style: z.string(),
  zoom_pan_style: z.string(),
  background_blur_usage: z.string(),
  text_placement: z.string(),
  title_card_design: z.string(),
  lower_third_design: z.string(),
  headline_card_design: z.string(),
  motion_graphic_style: z.string(),
  color_tone: z.string(),
  brightness_contrast: z.string(),
  saturation: z.string(),
  pacing_style: z.string(),
});

export const VideoAnalysisSchema = z.object({
  schema_version: z.literal("1.0.0"),
  video_path: z.string(),
  video_slug: z.string(),
  channel_slug: z.string(),
  generated_at: z.string(),
  global: z.object({
    duration: z.number(),
    width: z.number(),
    height: z.number(),
    fps: z.number(),
    video_codec: z.string(),
    audio_codec: z.string().nullable(),
    total_visual_changes: z.number().int(),
    average_shot_duration: z.number(),
    average_visual_change_frequency_hz: z.number(),
    intro_pattern: z.string(),
    ending_pattern: z.string(),
    overall_mood: z.string(),
  }),
  beats: z.array(BeatSchema),
  transitions: z.array(TransitionEventSchema),
  sfx_matches: z.array(SfxMatchSchema),
  music: z.object({
    mood_guess: MusicMoodSchema,
    tempo_bpm: z.number(),
    change_points: z.array(z.number()),
    intensity_curve_sampled: z.array(
      z.object({ t: z.number(), intensity: z.number() }),
    ),
    notes: z.string(),
  }),
  visual_style_rules: VisualStyleRulesSchema,
  detected_motion_graphics: z.array(
    z.object({
      at: z.number(),
      kind: z.enum([
        "timeline",
        "relationship_map",
        "divorce_legal",
        "net_worth_money",
        "quote_card",
        "headline_card",
        "before_after",
        "public_reaction",
        "chart_graph",
        "other",
      ]),
      description: z.string(),
      confidence: z.number(),
    }),
  ),
});

export type VideoAnalysis = z.infer<typeof VideoAnalysisSchema>;
