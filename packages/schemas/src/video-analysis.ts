/* video_analysis.json — per-video output of the Style Analyzer.
 * Exact schema per the new plan (PHASE 3). */
import { z } from "zod";

export const TextOverlayDescriptorSchema = z.object({
  present: z.boolean(),
  text: z.string().default(""),
  placement: z.string().default(""),
  style_notes: z.string().default(""),
  duration_seconds: z.number().default(0),
});
export type TextOverlayDescriptor = z.infer<typeof TextOverlayDescriptorSchema>;

export const LowerThirdDescriptorSchema = z.object({
  present: z.boolean(),
  text: z.string().default(""),
  style_notes: z.string().default(""),
  duration_seconds: z.number().default(0),
});
export type LowerThirdDescriptor = z.infer<typeof LowerThirdDescriptorSchema>;

export const TitleCardDescriptorSchema = z.object({
  present: z.boolean(),
  text: z.string().default(""),
  style_notes: z.string().default(""),
  duration_seconds: z.number().default(0),
});
export type TitleCardDescriptor = z.infer<typeof TitleCardDescriptorSchema>;

export const MotionGraphicDescriptorSchema = z.object({
  present: z.boolean(),
  type: z.string().default(""),
  purpose: z.string().default(""),
  style_notes: z.string().default(""),
});
export type MotionGraphicDescriptor = z.infer<typeof MotionGraphicDescriptorSchema>;

export const TransitionDescriptorSchema = z.object({
  type: z.string().default(""),
  duration_seconds: z.number().default(0),
  possible_asset_match: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0),
});
export type TransitionDescriptor = z.infer<typeof TransitionDescriptorSchema>;

export const SfxDescriptorSchema = z.object({
  timestamp: z.string().default(""),
  type: z.string().default(""),
  possible_asset_match: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0),
  purpose: z.string().default(""),
});
export type SfxDescriptor = z.infer<typeof SfxDescriptorSchema>;

export const MusicDescriptorSchema = z.object({
  mood: z.string().default(""),
  intensity: z.string().default(""),
  volume_under_voice: z.string().default(""),
  notes: z.string().default(""),
});
export type MusicDescriptor = z.infer<typeof MusicDescriptorSchema>;

export const BeatSchema = z.object({
  beat_id: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  duration_seconds: z.number(),
  transcript_text: z.string().default(""),
  beat_summary: z.string().default(""),
  story_function: z.string().default(""),
  emotional_tone: z.string().default(""),
  visual_description: z.string().default(""),
  asset_type: z.string().default(""),
  camera_motion: z.string().default(""),
  layout_type: z.string().default(""),
  text_overlay: TextOverlayDescriptorSchema,
  lower_third: LowerThirdDescriptorSchema,
  title_card: TitleCardDescriptorSchema,
  motion_graphic: MotionGraphicDescriptorSchema,
  transition_in: TransitionDescriptorSchema,
  transition_out: TransitionDescriptorSchema,
  sfx: z.array(SfxDescriptorSchema).default([]),
  music: MusicDescriptorSchema,
  editing_purpose: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type Beat = z.infer<typeof BeatSchema>;

export const GlobalEditingSummarySchema = z.object({
  editing_mood: z.string().default(""),
  average_visual_change_seconds: z.number().default(0),
  average_scene_duration_seconds: z.number().default(0),
  total_major_cuts: z.number().int().default(0),
  total_minor_visual_changes: z.number().int().default(0),
  intro_pattern: z.string().default(""),
  ending_pattern: z.string().default(""),
  overall_style_notes: z.string().default(""),
});
export type GlobalEditingSummary = z.infer<typeof GlobalEditingSummarySchema>;

export const AssetMixSchema = z.object({
  celebrity_photos: z.number().int().default(0),
  youtube_clips: z.number().int().default(0),
  headline_screenshots: z.number().int().default(0),
  social_screenshots: z.number().int().default(0),
  motion_graphics: z.number().int().default(0),
  title_cards: z.number().int().default(0),
  animated_backgrounds: z.number().int().default(0),
  other: z.number().int().default(0),
});
export type AssetMix = z.infer<typeof AssetMixSchema>;

export const DetectedPatternsSchema = z.object({
  pacing_patterns: z.array(z.string()).default([]),
  visual_patterns: z.array(z.string()).default([]),
  audio_patterns: z.array(z.string()).default([]),
  text_patterns: z.array(z.string()).default([]),
  transition_patterns: z.array(z.string()).default([]),
  scripting_patterns: z.array(z.string()).default([]),
  mood_patterns: z.array(z.string()).default([]),
});
export type DetectedPatterns = z.infer<typeof DetectedPatternsSchema>;

export const VideoAnalysisSchema = z.object({
  video_id: z.string(),
  source_url: z.string(),
  title: z.string().default(""),
  duration_seconds: z.number().default(0),
  resolution: z.string().default(""),
  fps: z.number().default(0),
  analyzed_at: z.string(),
  global_editing_summary: GlobalEditingSummarySchema,
  asset_mix: AssetMixSchema,
  beats: z.array(BeatSchema),
  detected_patterns: DetectedPatternsSchema,
});
export type VideoAnalysis = z.infer<typeof VideoAnalysisSchema>;
