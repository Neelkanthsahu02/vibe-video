#!/usr/bin/env tsx
/* CLI: analyze a single video (URL or local file) and emit video_analysis.json
 *
 *   npm run analyze:video -- --file ./reference-videos/v1.mp4 --preset spillrumors
 *   npm run analyze:video -- --url https://www.youtube.com/watch?v=... --preset spillrumors
 */
import { Command } from "commander";
import { analyzeReferenceVideo } from "../packages/analyzer/src/index.js";
import { createLogger } from "../packages/utils/src/logger.js";

const log = createLogger("cli:analyze:video");

const program = new Command();
program
  .name("analyze:video")
  .description("Analyze a single video (URL or local file)")
  .option("-f, --file <path>", "Local video file")
  .option("-u, --url <url>", "YouTube URL")
  .requiredOption("-p, --preset <slug>", "Channel/preset slug (controls output dir)")
  .option("--title <title>", "Override title")
  .option("--video-id <id>", "Override video id")
  .option("--force", "Regenerate even if cached", false)
  .action(async (opts: {
    file?: string;
    url?: string;
    preset: string;
    title?: string;
    videoId?: string;
    force?: boolean;
  }) => {
    const source = opts.file ?? opts.url;
    if (!source) {
      console.error("--file or --url is required");
      process.exit(2);
    }
    try {
      const res = await analyzeReferenceVideo({
        channelSlug: opts.preset,
        source,
        title: opts.title,
        videoIdOverride: opts.videoId,
        force: opts.force,
      });
      console.log("");
      console.log("✓ analysis complete");
      console.log(`  video_id:            ${res.analysis.video_id}`);
      console.log(`  beats:               ${res.analysis.beats.length}`);
      console.log(`  duration:            ${res.analysis.duration_seconds.toFixed(1)}s`);
      console.log(`  video_analysis.json: ${res.videoAnalysisPath}`);
      console.log(`  style_summary.md:    ${res.styleSummaryPath}`);
    } catch (e) {
      log.error((e as Error).message);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
