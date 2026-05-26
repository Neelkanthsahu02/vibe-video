import { z } from "zod";

export const AssetKindSchema = z.enum(["image", "clip"]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetSourceSchema = z.enum([
  "brave_images",
  "brave_videos",
  "yt_dlp_search",
  "manual",
]);
export type AssetSource = z.infer<typeof AssetSourceSchema>;

export const CandidateAssetSchema = z.object({
  asset_id: z.string(),
  kind: AssetKindSchema,
  scene_id: z.string(),
  query: z.string(),
  source: AssetSourceSchema,
  source_url: z.string(),
  page_url: z.string().nullable(),
  title: z.string().nullable(),
  publisher: z.string().nullable(),
  local_path: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  duration_seconds: z.number().nullable(),
  bytes: z.number(),
  format: z.string(),
  /** When the clip was downloaded from YouTube. */
  youtube_id: z.string().nullable().default(null),
  youtube_channel: z.string().nullable().default(null),
  fetched_at: z.string(),
});
export type CandidateAsset = z.infer<typeof CandidateAssetSchema>;

export const SceneCandidatesSchema = z.object({
  scene_id: z.string(),
  index: z.number().int(),
  start_time: z.number(),
  end_time: z.number(),
  asset_type_needed: z.string(),
  image_search_queries: z.array(z.string()),
  youtube_clip_search_queries: z.array(z.string()),
  headline_search_queries: z.array(z.string()),
  candidates: z.array(CandidateAssetSchema),
  notes: z.array(z.string()).default([]),
});
export type SceneCandidates = z.infer<typeof SceneCandidatesSchema>;

export const CandidateManifestSchema = z.object({
  schema_version: z.literal("1.0.0"),
  project_name: z.string(),
  channel_slug: z.string(),
  generated_at: z.string(),
  totals: z.object({
    scenes: z.number().int(),
    images: z.number().int(),
    clips: z.number().int(),
    bytes: z.number().int(),
  }),
  scenes: z.array(SceneCandidatesSchema),
});
export type CandidateManifest = z.infer<typeof CandidateManifestSchema>;
