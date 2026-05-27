#!/usr/bin/env tsx
/* CLI: combine all per-video analyses for a channel into style_preset.json.
 *   npm run preset:generate -- --channel spillrumors --name "SpillRumors"
 */
import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { buildStylePreset } from "../packages/analyzer/src/index.js";
import { config } from "../packages/core/src/index.js";
import { fileExists, readJson } from "../packages/utils/src/paths.js";
import { createLogger } from "../packages/utils/src/logger.js";
import type { VideoAnalysis } from "../packages/schemas/src/index.js";

const log = createLogger("cli:preset:generate");

const program = new Command();
program
  .name("preset:generate")
  .description("Combine all video_analysis.json files for a channel into style_preset.json")
  .requiredOption("-c, --channel <slug>", "Channel slug (matches reference-videos/<slug>/)")
  .option("-n, --name <name>", "Channel display name (defaults to slug)")
  .option("--url <url>", "Channel URL to embed")
  .option("--niche <niche>", "Niche label", "celebrity_documentary_youtube")
  .option("--preset-id <id>", "Override preset_id")
  .option("--preset-name <name>", "Override preset_name")
  .action(async (opts: {
    channel: string;
    name?: string;
    url?: string;
    niche?: string;
    presetId?: string;
    presetName?: string;
  }) => {
    const channelDir = path.join(config.dirs.referenceVideos, opts.channel);
    let videoDirs: string[];
    try {
      videoDirs = await fs.readdir(channelDir);
    } catch {
      console.error(`no reference-videos/${opts.channel}/ — run analyze:channel first`);
      process.exit(1);
    }
    const analyses: VideoAnalysis[] = [];
    for (const d of videoDirs) {
      const p = path.join(channelDir, d, "video_analysis.json");
      if (!(await fileExists(p))) continue;
      try {
        analyses.push(await readJson<VideoAnalysis>(p));
      } catch (e) {
        log.warn(`skip ${p}: ${(e as Error).message}`);
      }
    }
    if (analyses.length === 0) {
      console.error(`no video_analysis.json files under ${channelDir}`);
      process.exit(1);
    }
    try {
      const res = await buildStylePreset(analyses, {
        channelName: opts.name ?? opts.channel,
        channelSlug: opts.channel,
        channelUrl: opts.url,
        niche: opts.niche,
        presetIdOverride: opts.presetId,
        presetNameOverride: opts.presetName,
      });
      console.log("");
      console.log("✓ style_preset.json written");
      console.log(`  videos:     ${res.preset.analysis_summary.total_videos}`);
      console.log(`  confidence: ${res.preset.analysis_summary.confidence_score}`);
      console.log(`  path:       ${res.presetPath}`);
    } catch (e) {
      log.error((e as Error).message);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
