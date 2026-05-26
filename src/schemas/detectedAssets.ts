import { z } from "zod";

export const DetectedAssetsSchema = z.object({
  schema_version: z.literal("1.0.0"),
  video_slug: z.string(),
  generated_at: z.string(),
  transitions: z.array(
    z.object({
      at: z.number(),
      type: z.string(),
      matched_asset: z.string().nullable(),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
  sfx: z.array(
    z.object({
      timestamp: z.number(),
      sfx_filename: z.string(),
      confidence: z.number(),
      duration: z.number(),
    }),
  ),
  music: z.object({
    mood_guess: z.string(),
    tempo_bpm: z.number(),
    change_points: z.array(z.number()),
  }),
  lower_thirds: z.array(
    z.object({ at: z.number(), text: z.string(), confidence: z.number() }),
  ),
  title_cards: z.array(
    z.object({ at: z.number(), text: z.string(), confidence: z.number() }),
  ),
  motion_graphics: z.array(
    z.object({
      at: z.number(),
      kind: z.string(),
      description: z.string(),
      confidence: z.number(),
    }),
  ),
});
export type DetectedAssets = z.infer<typeof DetectedAssetsSchema>;

export const AssetUsageReportSchema = z.object({
  schema_version: z.literal("1.0.0"),
  video_slug: z.string(),
  generated_at: z.string(),
  transitions_used: z.array(
    z.object({
      asset: z.string().nullable(),
      type: z.string(),
      times_used: z.number(),
      example_timestamps: z.array(z.number()),
      average_confidence: z.number(),
    }),
  ),
  sfx_used: z.array(
    z.object({
      asset: z.string(),
      times_used: z.number(),
      example_timestamps: z.array(z.number()),
      average_confidence: z.number(),
    }),
  ),
  music_used: z.array(
    z.object({
      mood: z.string(),
      total_seconds: z.number(),
      notes: z.string(),
    }),
  ),
  motion_graphics_used: z.array(
    z.object({ kind: z.string(), times_used: z.number() }),
  ),
});
export type AssetUsageReport = z.infer<typeof AssetUsageReportSchema>;
