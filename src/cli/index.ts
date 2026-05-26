#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import fg from "fast-glob";
import { createLogger } from "../utils/logger.js";
import { config } from "../config.js";
import { ensureDir, slugify } from "../utils/paths.js";
import { analyzeVideo } from "../analyzer/analyzeVideo.js";
import { buildChannelStyleProfile } from "../style/styleProfileBuilder.js";
import { planScenes } from "../planner/scenePlanner.js";
import { sourceAssetsForProject } from "../sourcing/sourceAssets.js";
import { reviewProjectAssets } from "../review/reviewAssets.js";
import { ytDlpAvailable } from "../sourcing/ytDlp.js";
import { checkBinaries } from "../utils/ffmpeg.js";

const log = createLogger("cli");

const program = new Command();
program
  .name("vibe")
  .description("Autonomous AI Video Editor — Channel Style Library Builder")
  .version("0.1.0");

program
  .command("doctor")
  .description("Check that required binaries are installed")
  .action(async () => {
    const [bins, ytOk] = await Promise.all([
      checkBinaries(),
      ytDlpAvailable(),
    ]);
    console.log("Binary check:");
    console.log(`  ffmpeg:  ${bins.ffmpeg ? "ok" : "MISSING"}  (${config.bins.ffmpeg})`);
    console.log(`  ffprobe: ${bins.ffprobe ? "ok" : "MISSING"}  (${config.bins.ffprobe})`);
    console.log(`  python:  ${bins.python ? "ok" : "MISSING"}  (${config.bins.python})`);
    console.log(`  yt-dlp:  ${ytOk ? "ok" : "MISSING"}  (${config.bins.ytDlp})`);
    console.log("");
    console.log(`OpenRouter key: ${config.openrouter.apiKey ? "set" : "MISSING"}`);
    console.log(`Brave key:      ${config.brave.apiKey ? "set" : "MISSING"}`);
    console.log(`Vision model:   ${config.openrouter.visionModel}`);
    console.log(`Reasoning model:${config.openrouter.reasoningModel}`);
    console.log(`Style library:  ${config.styleLibraryDir}`);
    console.log(`Asset library:  ${config.assetLibraryDir}`);
    console.log(`Projects dir:   ${config.projectsDir}`);
  });

program
  .command("analyze")
  .description("Analyze one finished video and write its style outputs")
  .requiredOption("-i, --input <path>", "Path to the finished video file")
  .requiredOption("-c, --channel <name>", "Channel name (e.g. SpillRumors)")
  .option("--channel-slug <slug>", "Override channel slug")
  .option("--video-slug <slug>", "Override video slug")
  .option("--sfx-pack <dir>", "Directory of SFX wav/mp3 files for fingerprint matching")
  .option("--force", "Regenerate even if cached outputs exist", false)
  .action(async (opts: {
    input: string;
    channel: string;
    channelSlug?: string;
    videoSlug?: string;
    sfxPack?: string;
    force?: boolean;
  }) => {
    await ensureDir(config.styleLibraryDir);
    const res = await analyzeVideo({
      videoPath: path.resolve(opts.input),
      channelName: opts.channel,
      channelSlug: opts.channelSlug,
      videoSlug: opts.videoSlug,
      sfxPackDir: opts.sfxPack ? path.resolve(opts.sfxPack) : undefined,
      force: opts.force,
    });
    console.log("video_analysis.json   →", res.videoAnalysisPath);
    console.log("style_summary.md      →", res.styleSummaryPath);
    console.log("detected_assets.json  →", res.detectedAssetsPath);
    console.log("asset_usage_report.json →", res.assetUsageReportPath);
  });

program
  .command("analyze-dir")
  .description("Analyze every video in a directory (non-recursive by default)")
  .requiredOption("-i, --input <dir>", "Directory of finished video files")
  .requiredOption("-c, --channel <name>", "Channel name")
  .option("--channel-slug <slug>", "Override channel slug")
  .option("--sfx-pack <dir>", "SFX pack directory")
  .option("--recursive", "Recurse into subdirectories", false)
  .option("--force", "Regenerate even if cached outputs exist", false)
  .option(
    "--ext <list>",
    "Comma-separated extensions",
    "mp4,mov,mkv,webm",
  )
  .action(async (opts: {
    input: string;
    channel: string;
    channelSlug?: string;
    sfxPack?: string;
    recursive?: boolean;
    force?: boolean;
    ext: string;
  }) => {
    const exts = opts.ext.split(",").map((e) => e.trim().replace(/^\./, ""));
    const patterns = exts.map(
      (e) => `${opts.recursive ? "**/*" : "*"}.${e}`,
    );
    const files = await fg(patterns, {
      cwd: path.resolve(opts.input),
      absolute: true,
      onlyFiles: true,
    });
    if (files.length === 0) {
      console.error(`No videos found in ${opts.input}`);
      process.exit(1);
    }
    log.info(`found ${files.length} videos`);
    for (const f of files) {
      try {
        log.info(`-- ${f}`);
        await analyzeVideo({
          videoPath: f,
          channelName: opts.channel,
          channelSlug: opts.channelSlug,
          sfxPackDir: opts.sfxPack ? path.resolve(opts.sfxPack) : undefined,
          force: opts.force,
        });
      } catch (e) {
        log.error(`failed: ${f}: ${(e as Error).message}`);
      }
    }
  });

program
  .command("build-profile")
  .description("Synthesize channel_style_profile.json from all analyzed videos")
  .requiredOption("-c, --channel <name>", "Channel name")
  .option("--channel-slug <slug>", "Override channel slug")
  .option("--channel-url <url>", "Channel URL to embed")
  .option(
    "--videos <list>",
    "Comma-separated list of video slugs to include (default: all)",
  )
  .action(async (opts: {
    channel: string;
    channelSlug?: string;
    channelUrl?: string;
    videos?: string;
  }) => {
    const slugs = opts.videos
      ? opts.videos.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const res = await buildChannelStyleProfile({
      channelName: opts.channel,
      channelSlug: opts.channelSlug ?? slugify(opts.channel),
      channelUrl: opts.channelUrl,
      videoSlugs: slugs,
    });
    console.log("channel_style_profile.json →", res.profilePath);
    console.log(
      `confidence_score: ${res.profile.confidence_score} (videos=${res.profile.source_video_count})`,
    );
  });

program
  .command("plan")
  .description(
    "Phase 2 — generate scene_plan.json from script + voiceover using the channel Style Library",
  )
  .requiredOption("-p, --project <name>", "Project name (workspace under projects/)")
  .requiredOption("-c, --channel <name>", "Channel name whose Style Library to use")
  .option("--channel-slug <slug>", "Override channel slug")
  .option("--script <path>", "Path to script.txt (default: projects/<slug>/input/script.txt)")
  .option(
    "--voiceover <path>",
    "Path to voiceover audio (default: projects/<slug>/input/voiceover.wav|mp3|m4a)",
  )
  .option("--whisper-model <name>", "faster-whisper model: tiny|base|small|medium|large-v3")
  .option("--whisper-device <name>", "cpu|cuda")
  .option("--whisper-compute <name>", "int8|int8_float16|float16|float32")
  .option("--language <code>", "Force language code (e.g. en)")
  .option("--pacing <seconds>", "Override pacing target seconds per beat", parseFloat)
  .option("--force", "Regenerate even if cached outputs exist", false)
  .action(async (opts: {
    project: string;
    channel: string;
    channelSlug?: string;
    script?: string;
    voiceover?: string;
    whisperModel?: string;
    whisperDevice?: string;
    whisperCompute?: string;
    language?: string;
    pacing?: number;
    force?: boolean;
  }) => {
    const res = await planScenes({
      projectName: opts.project,
      channelName: opts.channel,
      channelSlug: opts.channelSlug,
      scriptPath: opts.script,
      voiceoverPath: opts.voiceover,
      whisperModel: opts.whisperModel,
      whisperDevice: opts.whisperDevice,
      whisperCompute: opts.whisperCompute,
      language: opts.language,
      pacingTargetSeconds: opts.pacing,
      force: opts.force,
    });
    console.log("scene_plan.json        →", res.scenePlanPath);
    console.log("transcript.json        →", res.transcriptPath);
    console.log("script_alignment.json  →", res.alignmentPath);
    console.log(
      `${res.plan.totals.beats} beats | avg ${res.plan.totals.average_beat_duration.toFixed(2)}s | coverage ${res.plan.totals.coverage_seconds.toFixed(1)}s / ${res.plan.voiceover_duration.toFixed(1)}s`,
    );
  });

program
  .command("source")
  .description(
    "Phase 3 — source real images (Brave) and YouTube clips (yt-dlp) for every beat in scene_plan.json",
  )
  .requiredOption("-p, --project <name>", "Project name")
  .option("--images-per-scene <n>", "Image candidates per scene", (v) => parseInt(v, 10), 6)
  .option("--clips-per-scene <n>", "Clip candidates per scene to download", (v) => parseInt(v, 10), 2)
  .option("--brave-per-query <n>", "Brave image results per query", (v) => parseInt(v, 10), 6)
  .option("--ytdlp-per-query <n>", "YouTube candidates per query", (v) => parseInt(v, 10), 6)
  .option("--max-clip-duration <seconds>", "Skip clips longer than this", (v) => parseInt(v, 10), 900)
  .option("--skip-images", "Skip image sourcing entirely", false)
  .option("--skip-clips", "Skip clip sourcing entirely", false)
  .option("--force", "Regenerate even if cached", false)
  .action(async (opts: {
    project: string;
    imagesPerScene: number;
    clipsPerScene: number;
    bravePerQuery: number;
    ytdlpPerQuery: number;
    maxClipDuration: number;
    skipImages?: boolean;
    skipClips?: boolean;
    force?: boolean;
  }) => {
    const res = await sourceAssetsForProject({
      projectName: opts.project,
      imagesPerScene: opts.imagesPerScene,
      clipsPerScene: opts.clipsPerScene,
      bravePerQuery: opts.bravePerQuery,
      ytdlpPerQuery: opts.ytdlpPerQuery,
      maxClipDuration: opts.maxClipDuration,
      skipImages: opts.skipImages,
      skipClips: opts.skipClips,
      force: opts.force,
    });
    console.log("manifest.json →", res.manifestPath);
    console.log(
      `${res.manifest.totals.scenes} scenes | ${res.manifest.totals.images} images | ${res.manifest.totals.clips} clips | ${(res.manifest.totals.bytes / 1024 / 1024).toFixed(1)} MB`,
    );
  });

program
  .command("review")
  .description(
    "Phase 4 — vision-review every candidate asset, mark accept/reject, suggest crop/motion/layout",
  )
  .requiredOption("-p, --project <name>", "Project name")
  .option("--scenes <list>", "Comma-separated scene_ids to limit review to")
  .option("--concurrency <n>", "Parallel vision calls", (v) => parseInt(v, 10))
  .option(
    "--copy-approved",
    "Also copy accepted assets into assets/approved/ and rejected into assets/rejected/",
    false,
  )
  .option("--force", "Regenerate per-candidate vision verdicts", false)
  .action(async (opts: {
    project: string;
    scenes?: string;
    concurrency?: number;
    copyApproved?: boolean;
    force?: boolean;
  }) => {
    const res = await reviewProjectAssets({
      projectName: opts.project,
      sceneIds: opts.scenes ? opts.scenes.split(",").map((s) => s.trim()) : undefined,
      concurrency: opts.concurrency,
      copyApproved: opts.copyApproved,
      force: opts.force,
    });
    console.log("asset_review.json →", res.reviewPath);
    const t = res.review.totals;
    console.log(
      `${t.accepted}/${t.candidates} accepted across ${t.scenes} scenes | ${t.scenes_without_accepted} scenes have no accepted assets`,
    );
  });

program
  .command("list")
  .description("List analyzed videos for a channel")
  .requiredOption("-c, --channel <name>", "Channel name")
  .option("--channel-slug <slug>", "Override channel slug")
  .action(async (opts: { channel: string; channelSlug?: string }) => {
    const slug = opts.channelSlug ?? slugify(opts.channel);
    const dir = path.join(config.styleLibraryDir, slug, "video_analyses");
    const files = await fg("*/video_analysis.json", { cwd: dir, absolute: true });
    if (files.length === 0) {
      console.log(`(none — run \`vibe analyze\` first)`);
      return;
    }
    for (const f of files) console.log(f);
  });

program.parseAsync(process.argv).catch((e) => {
  log.error((e as Error).message);
  process.exit(1);
});
