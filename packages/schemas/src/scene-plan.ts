/* scene_plan.json — PHASE 6. */
import { z } from "zod";

export const ScenePlanSceneSchema = z.object({
  scene_id: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  duration_seconds: z.number().default(0),
  narration_text: z.string().default(""),
  beat_summary: z.string().default(""),
  story_function: z.string().default(""),
  emotional_tone: z.string().default(""),
  visual_goal: z.string().default(""),
  asset_type_needed: z.string().default(""),
  image_search_queries: z.array(z.string()).default([]),
  youtube_clip_search_queries: z.array(z.string()).default([]),
  web_headline_search_queries: z.array(z.string()).default([]),
  suggested_visual_layout: z.string().default(""),
  camera_motion: z.string().default(""),
  overlay_text: z.string().default(""),
  lower_third_text: z.string().default(""),
  title_card_text: z.string().default(""),
  motion_graphic_instruction: z.string().default(""),
  transition_in: z.string().default(""),
  transition_out: z.string().default(""),
  sfx_suggestion: z.string().default(""),
  music_mood: z.string().default(""),
  style_library_rule_used: z.string().default(""),
  editing_notes: z.string().default(""),
});
export type ScenePlanScene = z.infer<typeof ScenePlanSceneSchema>;

export const ScenePlanSchema = z.object({
  project_id: z.string(),
  title: z.string().default(""),
  selected_style_preset: z.string(),
  duration_seconds: z.number().default(0),
  scenes: z.array(ScenePlanSceneSchema).default([]),
});
export type ScenePlan = z.infer<typeof ScenePlanSchema>;
