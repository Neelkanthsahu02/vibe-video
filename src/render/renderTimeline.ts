import path from "node:path";
import fs from "node:fs/promises";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createLogger } from "../utils/logger.js";
import { config } from "../config.js";
import {
  ensureDir,
  fileExists,
  readJson,
} from "../utils/paths.js";
import { resolveProjectPaths } from "../planner/projectIO.js";
import type { Timeline } from "../schemas/timeline.js";

const log = createLogger("render");

export interface RenderOptions {
  projectName: string;
  /** Output container/codec. Defaults to h264 mp4. */
  codec?: "h264" | "h265" | "vp8" | "vp9" | "prores";
  /** Path to override the default output (defaults to projects/<slug>/exports/<slug>-<timestamp>.mp4). */
  outputPath?: string;
  /** Parallel browser tabs Remotion uses. Defaults to half the CPU count. */
  concurrency?: number;
  /** Image format for frame extraction (jpeg is faster, png is lossless). */
  imageFormat?: "jpeg" | "png";
  /** JPEG quality 1..100 — only for jpeg. */
  jpegQuality?: number;
  /** Overwrite an existing output without prompting. */
  overwrite?: boolean;
  /** Tail end of the render only (helpful for previews). */
  rangeSeconds?: { start: number; end: number };
}

export interface RenderResult {
  outputPath: string;
  durationSeconds: number;
  frames: number;
  bytes: number;
  startedAt: string;
  finishedAt: string;
}

const REMOTION_ENTRY = "remotion/index.ts";
const COMPOSITION_ID = "VibeVideo";

export async function renderProjectTimeline(
  opts: RenderOptions,
): Promise<RenderResult> {
  const paths = await resolveProjectPaths(opts.projectName);
  const timelinePath = path.join(paths.renderDir, "timeline.json");
  if (!(await fileExists(timelinePath))) {
    throw new Error(
      `timeline.json missing at ${timelinePath}. Run \`vibe build-timeline\` first.`,
    );
  }
  const timeline = await readJson<Timeline>(timelinePath);

  await ensureDir(paths.exportsDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath =
    opts.outputPath ??
    path.join(paths.exportsDir, `${paths.projectSlug}-${stamp}.mp4`);
  if (!opts.overwrite && (await fileExists(outputPath))) {
    throw new Error(
      `output already exists at ${outputPath}; pass --overwrite or a different --output.`,
    );
  }

  const entry = path.resolve(config.root, REMOTION_ENTRY);
  if (!(await fileExists(entry))) {
    throw new Error(`remotion entry missing at ${entry}`);
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // 1. Bundle the Remotion project once.
  log.info("bundling remotion entry");
  const bundleProgressLog = throttledProgressLogger("bundle");
  const serveUrl = await bundle({
    entryPoint: entry,
    onProgress: (progress: number) => bundleProgressLog(progress / 100),
    webpackOverride: (cfg) => cfg,
  });
  log.info(`bundle ready (${serveUrl})`);

  // 2. Select the composition, override dimensions/duration from the timeline.
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps: { timeline },
  });
  const fps = timeline.composition.fps;
  const overrideDuration = Math.max(
    composition.durationInFrames,
    Math.ceil(timeline.composition.duration_seconds * fps),
  );

  const frameRange = opts.rangeSeconds
    ? ([
        Math.max(0, Math.floor(opts.rangeSeconds.start * fps)),
        Math.min(
          overrideDuration - 1,
          Math.floor(opts.rangeSeconds.end * fps),
        ),
      ] as [number, number])
    : undefined;

  // 3. Render.
  log.info(
    `rendering ${composition.width}x${composition.height}@${fps}fps → ${outputPath}`,
  );
  const renderProgressLog = throttledProgressLogger("render");
  await renderMedia({
    composition: {
      ...composition,
      durationInFrames: overrideDuration,
      width: timeline.composition.width,
      height: timeline.composition.height,
      fps,
    },
    serveUrl,
    codec: opts.codec ?? "h264",
    outputLocation: outputPath,
    inputProps: { timeline },
    overwrite: opts.overwrite ?? false,
    concurrency: opts.concurrency,
    imageFormat: opts.imageFormat ?? "jpeg",
    jpegQuality: opts.jpegQuality ?? 85,
    chromiumOptions: {
      // Required for headless chrome to load file:// URLs that reference
      // local images / clips / audio outside the bundle.
      disableWebSecurity: true,
      ignoreCertificateErrors: true,
    },
    frameRange,
    onProgress: ({ progress }: { progress: number }) =>
      renderProgressLog(progress),
  });

  const finishedAt = new Date().toISOString();
  const stat = await fs.stat(outputPath);
  const elapsedSeconds = (Date.now() - startMs) / 1000;
  log.info(
    `render complete in ${elapsedSeconds.toFixed(1)}s | ${(stat.size / 1024 / 1024).toFixed(1)} MB → ${outputPath}`,
  );

  return {
    outputPath,
    durationSeconds: timeline.composition.duration_seconds,
    frames: overrideDuration,
    bytes: stat.size,
    startedAt,
    finishedAt,
  };
}

/**
 * Print a single-line progress update at most every 1.5 seconds (or when
 * it crosses 100%). Keeps the log readable when stderr isn't a TTY.
 */
function throttledProgressLogger(scope: string): (p: number) => void {
  let lastAt = 0;
  let lastPct = -1;
  return (p: number) => {
    const now = Date.now();
    const pct = Math.max(0, Math.min(100, Math.floor(p * 100)));
    if (pct === lastPct) return;
    if (pct >= 100 || now - lastAt > 1500) {
      // eslint-disable-next-line no-console
      console.error(`[${scope}] ${pct}%`);
      lastAt = now;
      lastPct = pct;
    }
  };
}
