/* Per-sourced asset metadata (PHASE 7). */
import { z } from "zod";

export const ProjectAssetSchema = z.object({
  asset_id: z.string(),
  asset_path: z.string(),
  source_url: z.string(),
  source_title: z.string().default(""),
  source_type: z.enum([
    "brave_image",
    "brave_news",
    "brave_web",
    "brave_video",
    "youtube_clip",
    "apify_metadata",
    "local",
    "manual",
  ]),
  scene_id: z.string(),
  usage_reason: z.string().default(""),
  license_or_rights_notes: z.string().default(""),
  downloaded_at: z.string(),
});
export type ProjectAsset = z.infer<typeof ProjectAssetSchema>;
