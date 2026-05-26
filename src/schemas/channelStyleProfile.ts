import { z } from "zod";

export const ChannelStyleProfileSchema = z.object({
  schema_version: z.literal("1.0.0"),
  channel_name: z.string(),
  channel_slug: z.string(),
  channel_url: z.string().optional(),
  niche: z.string(),
  editing_mood: z.string(),
  generated_at: z.string(),
  source_video_count: z.number().int(),

  average_visual_change_seconds: z.number(),
  average_beat_duration: z.number(),

  asset_ratio_rules: z.object({
    celebrity_photo: z.number(),
    event_photo: z.number(),
    interview_clip: z.number(),
    paparazzi_clip: z.number(),
    news_headline_screenshot: z.number(),
    social_media_screenshot: z.number(),
    animated_background: z.number(),
    title_card: z.number(),
    lower_third: z.number(),
    motion_graphic: z.number(),
    mixed_layout: z.number(),
  }),

  pacing_rules: z.object({
    average_shot_duration_seconds: z.number(),
    shot_duration_p25: z.number(),
    shot_duration_p50: z.number(),
    shot_duration_p75: z.number(),
    fastest_section_avg: z.number(),
    slowest_section_avg: z.number(),
    notes: z.string(),
  }),

  intro_rules: z.object({
    typical_duration_seconds: z.number(),
    hook_style: z.string(),
    common_assets: z.array(z.string()),
    transitions: z.array(z.string()),
    sfx: z.array(z.string()),
    music_mood: z.string(),
    notes: z.string(),
  }),

  ending_rules: z.object({
    typical_duration_seconds: z.number(),
    cta_style: z.string(),
    common_assets: z.array(z.string()),
    music_mood: z.string(),
    notes: z.string(),
  }),

  image_treatment_rules: z.array(z.string()),
  clip_treatment_rules: z.array(z.string()),
  headline_screenshot_rules: z.array(z.string()),
  title_card_rules: z.array(z.string()),
  lower_third_rules: z.array(z.string()),

  transition_rules: z.object({
    distribution: z.record(z.string(), z.number()),
    by_context: z.record(z.string(), z.array(z.string())),
    notes: z.string(),
  }),

  sfx_rules: z.object({
    most_used: z.array(z.string()),
    by_context: z.record(z.string(), z.array(z.string())),
    notes: z.string(),
  }),

  music_rules: z.object({
    mood_distribution: z.record(z.string(), z.number()),
    duck_under_narration: z.boolean(),
    typical_change_points_per_minute: z.number(),
    by_emotional_purpose: z.record(z.string(), z.string()),
    notes: z.string(),
  }),

  motion_graphic_rules: z.object({
    kinds_used: z.record(z.string(), z.number()),
    when_to_use: z.record(z.string(), z.string()),
    notes: z.string(),
  }),

  emotional_editing_rules: z.array(
    z.object({
      moment: z.string(),
      use_assets: z.array(z.string()),
      camera_motion: z.string(),
      pacing: z.string(),
      music: z.string(),
      transition: z.string(),
      sfx: z.string(),
      notes: z.string(),
    }),
  ),

  do_rules: z.array(z.string()),
  avoid_rules: z.array(z.string()),

  examples_from_reference_videos: z.array(
    z.object({
      video_slug: z.string(),
      timestamp: z.number(),
      illustrates: z.string(),
      description: z.string(),
    }),
  ),

  confidence_score: z.number().min(0).max(1),
});

export type ChannelStyleProfile = z.infer<typeof ChannelStyleProfileSchema>;
