/* asset_review.json — PHASE 8. */
import { z } from "zod";

export const AssetReviewEntrySchema = z.object({
  asset_id: z.string(),
  asset_path: z.string(),
  accept: z.boolean(),
  relevance_score: z.number().min(0).max(1).default(0),
  quality_score: z.number().min(0).max(1).default(0),
  style_match_score: z.number().min(0).max(1).default(0),
  reason: z.string().default(""),
  suggested_crop: z.string().default(""),
  suggested_motion: z.string().default(""),
  best_use_case: z.string().default(""),
});
export type AssetReviewEntry = z.infer<typeof AssetReviewEntrySchema>;

export const AssetReviewSchema = z.object({
  scene_id: z.string(),
  asset_reviews: z.array(AssetReviewEntrySchema).default([]),
});
export type AssetReview = z.infer<typeof AssetReviewSchema>;
