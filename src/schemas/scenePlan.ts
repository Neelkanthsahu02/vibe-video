import { z } from "zod";
import {
  AssetTypeSchema,
  CameraMotionSchema,
  TransitionTypeSchema,
  MusicMoodSchema,
} from "./videoAnalysis.js";

export const ScriptFunctionSchema = z.enum([
  "intro",
  "context",
  "setup",
  "betrayal",
  "scandal",
  "reveal",
  "emotional_reflection",
  "timeline_explanation",
  "public_reaction",
  "ending",
]);
export type ScriptFunction = z.infer<typeof ScriptFunctionSchema>;

export const EmotionalToneSchema = z.enum([
  "neutral",
  "curious",
  "tense",
  "sad",
  "angry",
  "shocked",
  "hopeful",
  "ominous",
  "uplifting",
  "reflective",
  "unknown",
]);
export type EmotionalTone = z.infer<typeof EmotionalToneSchema>;

export const SuggestedVisualLayoutSchema = z.enum([
  "fullscreen_image",
  "fullscreen_clip",
  "blurred_fill_portrait",
  "split_screen",
  "framed_inset",
  "headline_card",
  "title_card",
  "lower_third_over_clip",
  "motion_graphic_only",
  "stacked_quote_card",
  "ken_burns_image",
  "unknown",
]);

export const ScenePlanBeatSchema = z.object({
  scene_id: z.string(),
  index: z.number().int().nonnegative(),
  start_time: z.number(),
  end_time: z.number(),
  duration: z.number(),
  narration_text: z.string(),
  beat_summary: z.string(),
  emotional_tone: EmotionalToneSchema,
  script_function: ScriptFunctionSchema,
  visual_goal: z.string(),
  asset_type_needed: AssetTypeSchema,
  image_search_queries: z.array(z.string()).default([]),
  youtube_clip_search_queries: z.array(z.string()).default([]),
  headline_search_queries: z.array(z.string()).default([]),
  suggested_visual_layout: SuggestedVisualLayoutSchema,
  camera_motion: CameraMotionSchema,
  overlay_text: z.string().nullable().default(null),
  lower_third_text: z.string().nullable().default(null),
  title_card_text: z.string().nullable().default(null),
  motion_graphic_instruction: z.string().nullable().default(null),
  transition_in: TransitionTypeSchema,
  transition_out: TransitionTypeSchema,
  sfx_suggestion: z.string().nullable().default(null),
  music_mood: MusicMoodSchema,
  editing_notes: z.string().default(""),
  style_library_rule_used: z.string(),
  alignment_confidence: z.number().min(0).max(1).default(0.5),
});
export type ScenePlanBeat = z.infer<typeof ScenePlanBeatSchema>;

export const ScenePlanSchema = z.object({
  schema_version: z.literal("1.0.0"),
  project_name: z.string(),
  channel_slug: z.string(),
  generated_at: z.string(),
  voiceover_path: z.string(),
  script_path: z.string(),
  voiceover_duration: z.number(),
  source_style_profile: z.string(),
  pacing_target_seconds: z.number(),
  language: z.string(),
  totals: z.object({
    beats: z.number().int(),
    average_beat_duration: z.number(),
    coverage_seconds: z.number(),
  }),
  global: z.object({
    intro_strategy: z.string(),
    ending_strategy: z.string(),
    overall_emotional_arc: z.string(),
    music_arc: z.string(),
    notes: z.string(),
  }),
  beats: z.array(ScenePlanBeatSchema),
});
export type ScenePlan = z.infer<typeof ScenePlanSchema>;
