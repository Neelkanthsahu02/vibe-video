/* asset_usage_report.json — PHASE 5. */
import { z } from "zod";

export const AssetMatchSchema = z.object({
  timestamp: z.string(),
  asset_type: z.enum([
    "transition",
    "sfx",
    "music",
    "lower_third",
    "title_card",
    "background",
    "motion_graphic",
  ]),
  detected_type: z.string().default(""),
  matched_asset_filename: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0),
  reason: z.string().default(""),
  evidence: z.string().default(""),
});
export type AssetMatch = z.infer<typeof AssetMatchSchema>;

export const AssetUsageReportSchema = z.object({
  video_id: z.string(),
  source_url: z.string().default(""),
  matches: z.array(AssetMatchSchema).default([]),
});
export type AssetUsageReport = z.infer<typeof AssetUsageReportSchema>;
