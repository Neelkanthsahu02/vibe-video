/* style_preset.json — reusable editing brain. Exact spec per PHASE 4. */
import { z } from "zod";

const MoodRuleSchema = z.object({
  visuals: z.string().default(""),
  camera_motion: z.string().default(""),
  music: z.string().default(""),
  transitions: z.string().default(""),
  sfx: z.string().default(""),
  text: z.string().default(""),
  editing_notes: z.string().default(""),
});
export type MoodRule = z.infer<typeof MoodRuleSchema>;

export const StylePresetSchema = z.object({
  preset_id: z.string(),
  preset_name: z.string(),
  channel_name: z.string().default(""),
  channel_url: z.string().default(""),
  niche: z.string().default(""),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().default(1),
  videos_analyzed: z
    .array(
      z.object({
        video_id: z.string(),
        source_url: z.string(),
        title: z.string().default(""),
        duration_seconds: z.number().default(0),
      }),
    )
    .default([]),

  analysis_summary: z.object({
    total_videos: z.number().int().default(0),
    total_duration_analyzed_seconds: z.number().default(0),
    confidence_score: z.number().min(0).max(1).default(0),
    style_description: z.string().default(""),
  }),

  global_style: z.object({
    editing_mood: z.string().default(""),
    visual_style: z.string().default(""),
    pacing_style: z.string().default(""),
    audio_style: z.string().default(""),
    storytelling_style: z.string().default(""),
  }),

  pacing_rules: z.object({
    average_visual_change_seconds: z.number().default(0),
    average_beat_duration_seconds: z.number().default(0),
    fast_pacing_threshold_seconds: z.number().default(0),
    slow_pacing_threshold_seconds: z.number().default(0),
    title_card_frequency: z.string().default(""),
    motion_graphic_frequency: z.string().default(""),
    rules: z.array(z.string()).default([]),
  }),

  asset_mix_rules: z.object({
    celebrity_photos: z.number().default(0),
    clips: z.number().default(0),
    headline_screenshots: z.number().default(0),
    social_screenshots: z.number().default(0),
    motion_graphics: z.number().default(0),
    title_cards: z.number().default(0),
    animated_backgrounds: z.number().default(0),
  }),

  mood_rules: z.object({
    emotional: MoodRuleSchema,
    scandal: MoodRuleSchema,
    reveal: MoodRuleSchema,
    timeline: MoodRuleSchema,
    public_reaction: MoodRuleSchema,
    ending_reflection: MoodRuleSchema,
  }),

  scripting_rules: z.object({
    intro_hook: z.string().default(""),
    setup: z.string().default(""),
    conflict_build: z.string().default(""),
    reveal_structure: z.string().default(""),
    timeline_explanation: z.string().default(""),
    public_reaction: z.string().default(""),
    ending: z.string().default(""),
    common_story_functions: z.array(z.string()).default([]),
  }),

  image_treatment_rules: z.object({
    portrait_images: z.string().default(""),
    low_quality_images: z.string().default(""),
    emotional_closeups: z.string().default(""),
    event_photos: z.string().default(""),
    old_photos: z.string().default(""),
    background_blur_rules: z.string().default(""),
    zoom_pan_rules: z.array(z.string()).default([]),
  }),

  clip_treatment_rules: z.object({
    interview_clips: z.string().default(""),
    event_clips: z.string().default(""),
    paparazzi_clips: z.string().default(""),
    news_clips: z.string().default(""),
    clip_duration_rules: z.string().default(""),
    crop_rules: z.string().default(""),
  }),

  headline_rules: z.object({
    when_to_use: z.string().default(""),
    style: z.string().default(""),
    duration: z.string().default(""),
    animation: z.string().default(""),
    sfx: z.string().default(""),
  }),

  title_card_rules: z.object({
    when_to_use: z.string().default(""),
    duration_seconds: z.string().default(""),
    text_style: z.string().default(""),
    animation_style: z.string().default(""),
    transition_style: z.string().default(""),
    sfx_style: z.string().default(""),
  }),

  lower_third_rules: z.object({
    when_to_use: z.string().default(""),
    duration_seconds: z.string().default(""),
    placement: z.string().default(""),
    style: z.string().default(""),
    animation: z.string().default(""),
  }),

  transition_rules: z.object({
    normal_scene_change: z.string().default(""),
    emotional_shift: z.string().default(""),
    dramatic_reveal: z.string().default(""),
    chapter_change: z.string().default(""),
    fast_section: z.string().default(""),
    avoid: z.array(z.string()).default([]),
  }),

  sfx_rules: z.object({
    title_card: z.string().default(""),
    reveal: z.string().default(""),
    headline: z.string().default(""),
    normal_transition: z.string().default(""),
    emotional_moment: z.string().default(""),
    avoid: z.array(z.string()).default([]),
  }),

  music_rules: z.object({
    default_bed: z.string().default(""),
    emotional: z.string().default(""),
    scandal: z.string().default(""),
    timeline: z.string().default(""),
    reveal: z.string().default(""),
    ending: z.string().default(""),
    ducking_rules: z.string().default(""),
  }),

  motion_graphic_rules: z.object({
    use_for: z.array(z.string()).default([]),
    timeline_graphics: z.string().default(""),
    relationship_maps: z.string().default(""),
    money_graphics: z.string().default(""),
    public_reaction_graphics: z.string().default(""),
    before_after: z.string().default(""),
    animation_style: z.string().default(""),
  }),

  do_rules: z.array(z.string()).default([]),
  avoid_rules: z.array(z.string()).default([]),
  examples_from_reference_videos: z
    .array(
      z.object({
        video_id: z.string(),
        timestamp: z.string(),
        illustrates: z.string(),
        description: z.string(),
      }),
    )
    .default([]),
});
export type StylePreset = z.infer<typeof StylePresetSchema>;
