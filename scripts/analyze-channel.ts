#!/usr/bin/env tsx
/* CLI: analyze a YouTube channel and generate a style_preset.json
 *
 *   npm run analyze:channel -- --url <channelUrl> [--mode top|recent|manual|mixed]
 *                              [--videos 5] [--channel <name>] [--niche <niche>]
 *                              [--manual <url1,url2,...>] [--force]
 */
import { Command } from "commander";
import path from "node:path";
import { analyzeChannel } from "../packages/analyzer/src/index.js";
import { createLogger } from "../packages/utils/src/logger.js";

const log = createLogger("cli:analyze:channel");

const program = new Command();
program
  .name("analyze:channel")
  .description("Analyze a YouTube channel and emit a style_preset.json")
  .requiredOption("-u, --url <url>", "YouTube channel URL (@handle or /channel/UC...)")
  .option("-c, --channel <name>", "Channel display name (defaults to handle)")
  .option("-s, --slug <slug>", "Channel slug (override)")
  .option("-n, --niche <niche>", "Niche label", "celebrity_documentary_youtube")
  .option(
    "-m, --mode <mode>",
    "Selection mode: top | recent | manual | mixed",
    "mixed",
  )
  .option(
    "-v, --videos <count>",
    "Number of videos to analyze (3 | 5 | 10 or any int)",
    (v) => parseInt(v, 10),
    5,
  )
  .option(
    "--manual <urls>",
    "Comma-separated YouTube URLs to always include",
  )
  .option("--max-duration <seconds>", "Skip videos longer than this", (v) => parseInt(v, 10))
  .option("--min-duration <seconds>", "Skip videos shorter than this", (v) => parseInt(v, 10))
  .option("--force", "Regenerate per-video analyses even if cached", false)
  .action(async (opts: {
    url: string;
    channel?: string;
    slug?: string;
    niche?: string;
    mode: "top" | "recent" | "manual" | "mixed";
    videos: number;
    manual?: string;
    maxDuration?: number;
    minDuration?: number;
    force?: boolean;
  }) => {
    const manualUrls = opts.manual
      ? opts.manual.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    if (!["top", "recent", "manual", "mixed"].includes(opts.mode)) {
      throw new Error(`unknown --mode ${opts.mode}`);
    }

    try {
      const res = await analyzeChannel({
        channelUrl: opts.url,
        channelName: opts.channel,
        channelSlug: opts.slug,
        niche: opts.niche,
        mode: opts.mode,
        count: opts.videos,
        manualUrls,
        maxDurationSeconds: opts.maxDuration,
        minDurationSeconds: opts.minDuration,
        force: opts.force,
      });
      const presetDir = path.dirname(res.presetPath);
      console.log("");
      console.log("✓ analysis complete");
      console.log(`  channel:           ${res.channelName} (${res.channelSlug})`);
      console.log(`  videos analyzed:   ${res.analyses.length}`);
      console.log(`  confidence:        ${res.preset.analysis_summary.confidence_score}`);
      console.log(`  preset:            ${res.presetPath}`);
      console.log(`  artifacts dir:     ${presetDir}`);
      if (res.selection.notes.length > 0) {
        console.log("  notes:");
        for (const n of res.selection.notes) console.log(`    - ${n}`);
      }
    } catch (e) {
      log.error((e as Error).message);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
