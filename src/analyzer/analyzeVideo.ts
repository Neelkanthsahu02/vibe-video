import path from "node:path";
import { createLogger } from "../utils/logger.js";
import {
  videoAnalysisPaths,
  slugify,
  writeJson,
  writeText,
  fileExists,
  ensureDir,
} from "../utils/paths.js";
import {
  ffprobe,
  extractAudio,
  checkBinaries,
} from "../utils/ffmpeg.js";
import { detectScenes } from "./sceneDetector.js";
import { extractBeatFrames } from "./frameExtractor.js";
import { analyzeBeatsWithVision } from "./visionAnalyzer.js";
import { analyzeAudio, matchSfxPack } from "./audioAnalyzer.js";
import { detectTransitions } from "./transitionDetector.js";
import { buildBeats, attachSfxToBeats } from "./beatBuilder.js";
import { generateStyleSummary } from "../style/summaryGenerator.js";
import { extractVisualStyleRules } from "../style/visualStyleRules.js";
import { config } from "../config.js";
import type {
  VideoAnalysis,
  TransitionEvent,
} from "../schemas/videoAnalysis.js";
import type {
  DetectedAssets,
  AssetUsageReport,
} from "../schemas/detectedAssets.js";

const log = createLogger("analyze");

export interface AnalyzeVideoOptions {
  videoPath: string;
  channelName: string;
  channelSlug?: string;
  videoSlug?: string;
  sfxPackDir?: string;
  /** When true, regenerate even if cached outputs exist. */
  force?: boolean;
}

export interface AnalyzeVideoResult {
  videoAnalysisPath: string;
  styleSummaryPath: string;
  detectedAssetsPath: string;
  assetUsageReportPath: string;
  analysis: VideoAnalysis;
}

function percentiles(values: number[], ps: number[]): number[] {
  if (values.length === 0) return ps.map(() => 0);
  const sorted = [...values].sort((a, b) => a - b);
  return ps.map((p) => {
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor(p * sorted.length)),
    );
    return sorted[idx]!;
  });
}

export async function analyzeVideo(
  opts: AnalyzeVideoOptions,
): Promise<AnalyzeVideoResult> {
  const channelSlug = opts.channelSlug ?? slugify(opts.channelName);
  const videoSlug =
    opts.videoSlug ?? slugify(path.basename(opts.videoPath).replace(/\.[^.]+$/, ""));

  const bins = await checkBinaries();
  if (!bins.ffmpeg || !bins.ffprobe) {
    throw new Error(
      "ffmpeg/ffprobe not found. Set FFMPEG_BIN / FFPROBE_BIN or install ffmpeg.",
    );
  }
  if (!bins.python) {
    throw new Error(
      "python3 not found. Install Python 3.10+ and `pip install -r python/requirements.txt`.",
    );
  }

  const paths = await videoAnalysisPaths(channelSlug, videoSlug);
  log.info(`analyzing ${opts.videoPath}`, { channelSlug, videoSlug });

  if (!opts.force && (await fileExists(paths.videoAnalysisJson))) {
    log.info("cached video_analysis.json exists — use --force to regenerate");
  }

  // 1. Probe + extract audio
  const probe = await ffprobe(opts.videoPath);
  const audioPath = await extractAudio(opts.videoPath, paths.audioDir, "audio");

  // 2. Scene detection
  const sceneCacheFile = path.join(paths.cacheDir, "scenes.json");
  const sceneResult = await detectScenes(opts.videoPath, sceneCacheFile);
  log.info(`detected ${sceneResult.scenes.length} scenes`);

  // 3. Frame extraction
  const beatFrames = await extractBeatFrames(
    opts.videoPath,
    sceneResult.scenes,
    paths.framesDir,
    config.tuning.visionFramesPerBeat,
  );

  // 4. Run vision, audio, transitions, optional SFX in parallel
  const transitionCacheFile = path.join(paths.cacheDir, "transitions.json");
  const audioCacheFile = path.join(paths.cacheDir, "audio.json");
  const sfxCacheFile = path.join(paths.cacheDir, "sfx_matches.json");

  const visionPromise = analyzeBeatsWithVision(
    beatFrames,
    path.join(paths.cacheDir, "beats"),
  );
  const transitionsPromise = detectTransitions(
    opts.videoPath,
    sceneCacheFile,
    transitionCacheFile,
  );
  const audioPromise = analyzeAudio(audioPath, audioCacheFile);
  const sfxPromise = opts.sfxPackDir
    ? matchSfxPack(audioPath, opts.sfxPackDir, sfxCacheFile)
    : Promise.resolve({
        target: audioPath,
        pack_dir: opts.sfxPackDir ?? "",
        threshold: 0,
        results: [] as Array<{
          sfx: string;
          sfx_filename: string;
          matches: Array<{
            timestamp: number;
            duration: number;
            confidence: number;
          }>;
        }>,
        note: "no SFX pack supplied",
      });

  const [visions, transitions, audio, sfxResult] = await Promise.all([
    visionPromise,
    transitionsPromise,
    audioPromise,
    sfxPromise,
  ]);

  // 5. Build beats and merge SFX
  const { beats, transitionEvents } = buildBeats(
    sceneResult.scenes,
    visions,
    transitions,
    audio,
  );

  const flatSfxMatches: Array<{
    sfx_filename: string;
    timestamp: number;
    duration: number;
    confidence: number;
    reason?: string;
  }> = [];
  for (const r of sfxResult.results) {
    for (const m of r.matches) {
      flatSfxMatches.push({
        sfx_filename: r.sfx_filename,
        timestamp: m.timestamp,
        duration: m.duration,
        confidence: m.confidence,
        reason: "mfcc fingerprint match",
      });
    }
  }
  attachSfxToBeats(beats, flatSfxMatches);

  // 6. Derived globals
  const durations = beats.map((b) => b.duration);
  const avgShot =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
  const visualChangeFreqHz =
    probe.duration > 0 ? sceneResult.scenes.length / probe.duration : 0;

  const introBeats = beats.filter((b) => b.end_time <= Math.min(20, probe.duration * 0.1));
  const endingBeats = beats.filter(
    (b) => b.start_time >= probe.duration - Math.min(20, probe.duration * 0.1),
  );

  const introPattern = describePattern(introBeats);
  const endingPattern = describePattern(endingBeats);
  const overallMood = audio.mood_guess;

  // 7. Visual style rules — distilled by LLM from the beats summary
  const visualStyleRules = await extractVisualStyleRules(beats, {
    width: probe.width,
    height: probe.height,
    overallMood,
  });

  // 8. Motion graphics list from vision
  const detectedMotionGraphics = visions
    .filter((v) => v.has_motion_graphic)
    .map((v) => {
      const beat = beats.find((b) => b.index === v.sceneIndex);
      return {
        at: beat?.start_time ?? 0,
        kind:
          (v.motion_graphic_kind as
            | "timeline"
            | "relationship_map"
            | "divorce_legal"
            | "net_worth_money"
            | "quote_card"
            | "headline_card"
            | "before_after"
            | "public_reaction"
            | "chart_graph"
            | "other"
            | null) ?? "other",
        description: v.visual_description,
        confidence: v.vision_confidence,
      };
    });

  const analysis: VideoAnalysis = {
    schema_version: "1.0.0",
    video_path: opts.videoPath,
    video_slug: videoSlug,
    channel_slug: channelSlug,
    generated_at: new Date().toISOString(),
    global: {
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      video_codec: probe.videoCodec,
      audio_codec: probe.audioCodec,
      total_visual_changes: sceneResult.scenes.length,
      average_shot_duration: avgShot,
      average_visual_change_frequency_hz: visualChangeFreqHz,
      intro_pattern: introPattern,
      ending_pattern: endingPattern,
      overall_mood: overallMood,
    },
    beats,
    transitions: transitionEvents,
    sfx_matches: flatSfxMatches,
    music: {
      mood_guess: asMusicMoodSafe(audio.mood_guess),
      tempo_bpm: audio.tempo_bpm,
      change_points: audio.music_change_points,
      intensity_curve_sampled: audio.intensity_curve,
      notes: `low/high energy ratio ${audio.low_high_energy_ratio.toFixed(2)}`,
    },
    visual_style_rules: visualStyleRules,
    detected_motion_graphics: detectedMotionGraphics,
  };

  await writeJson(paths.videoAnalysisJson, analysis);

  // 9. Style summary (markdown)
  const summaryMd = await generateStyleSummary(analysis);
  await writeText(paths.styleSummaryMd, summaryMd);

  // 10. detected_assets.json + asset_usage_report.json
  const detectedAssets: DetectedAssets = {
    schema_version: "1.0.0",
    video_slug: videoSlug,
    generated_at: analysis.generated_at,
    transitions: transitionEvents.map((t) => ({
      at: t.at,
      type: t.type,
      matched_asset: t.matched_asset ?? null,
      confidence: t.confidence,
      reason: t.reason,
    })),
    sfx: flatSfxMatches.map((s) => ({
      timestamp: s.timestamp,
      sfx_filename: s.sfx_filename,
      confidence: s.confidence,
      duration: s.duration,
    })),
    music: {
      mood_guess: audio.mood_guess,
      tempo_bpm: audio.tempo_bpm,
      change_points: audio.music_change_points,
    },
    lower_thirds: beats
      .filter((b) => b.lower_third_text)
      .map((b) => ({
        at: b.start_time,
        text: b.lower_third_text!,
        confidence: b.vision_confidence,
      })),
    title_cards: beats
      .filter((b) => b.title_card_text)
      .map((b) => ({
        at: b.start_time,
        text: b.title_card_text!,
        confidence: b.vision_confidence,
      })),
    motion_graphics: detectedMotionGraphics,
  };
  await writeJson(paths.detectedAssetsJson, detectedAssets);

  const assetUsageReport: AssetUsageReport = {
    schema_version: "1.0.0",
    video_slug: videoSlug,
    generated_at: analysis.generated_at,
    transitions_used: summarizeTransitions(transitionEvents),
    sfx_used: summarizeSfx(flatSfxMatches),
    music_used: [
      {
        mood: audio.mood_guess,
        total_seconds: probe.duration,
        notes: `${audio.music_change_points.length} mood change points`,
      },
    ],
    motion_graphics_used: summarizeMotionGraphics(detectedMotionGraphics),
  };
  await writeJson(paths.assetUsageReportJson, assetUsageReport);

  await ensureDir(paths.channelDir);
  void percentiles;

  log.info("video analysis complete", {
    videoAnalysisJson: paths.videoAnalysisJson,
    styleSummaryMd: paths.styleSummaryMd,
  });

  return {
    videoAnalysisPath: paths.videoAnalysisJson,
    styleSummaryPath: paths.styleSummaryMd,
    detectedAssetsPath: paths.detectedAssetsJson,
    assetUsageReportPath: paths.assetUsageReportJson,
    analysis,
  };
}

function asMusicMoodSafe(v: string): VideoAnalysis["music"]["mood_guess"] {
  const allowed = [
    "sad_emotional",
    "tense_documentary",
    "neutral_narrative",
    "energetic_reveal",
    "uplifting",
    "dark_scandal",
    "unknown",
  ] as const;
  return (allowed as readonly string[]).includes(v)
    ? (v as VideoAnalysis["music"]["mood_guess"])
    : "unknown";
}

function describePattern(beats: VideoAnalysis["beats"]): string {
  if (beats.length === 0) return "no beats detected";
  const assetCounts = new Map<string, number>();
  for (const b of beats) {
    assetCounts.set(b.asset_type, (assetCounts.get(b.asset_type) ?? 0) + 1);
  }
  const dominant = [...assetCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const avg = beats.reduce((a, b) => a + b.duration, 0) / beats.length;
  return `${beats.length} beats, avg ${avg.toFixed(2)}s, dominant asset=${
    dominant?.[0] ?? "unknown"
  }`;
}

function summarizeTransitions(
  events: TransitionEvent[],
): AssetUsageReport["transitions_used"] {
  const grouped = new Map<string, TransitionEvent[]>();
  for (const e of events) {
    const k = `${e.matched_asset ?? "_"}:${e.type}`;
    const arr = grouped.get(k);
    if (arr) arr.push(e);
    else grouped.set(k, [e]);
  }
  return [...grouped.entries()].map(([, arr]) => ({
    asset: arr[0]!.matched_asset ?? null,
    type: arr[0]!.type,
    times_used: arr.length,
    example_timestamps: arr.slice(0, 5).map((e) => e.at),
    average_confidence:
      arr.reduce((a, b) => a + b.confidence, 0) / arr.length,
  }));
}

function summarizeSfx(
  matches: Array<{ sfx_filename: string; timestamp: number; confidence: number }>,
): AssetUsageReport["sfx_used"] {
  const byName = new Map<string, typeof matches>();
  for (const m of matches) {
    const arr = byName.get(m.sfx_filename);
    if (arr) arr.push(m);
    else byName.set(m.sfx_filename, [m]);
  }
  return [...byName.entries()].map(([name, arr]) => ({
    asset: name,
    times_used: arr.length,
    example_timestamps: arr.slice(0, 5).map((m) => m.timestamp),
    average_confidence:
      arr.reduce((a, b) => a + b.confidence, 0) / arr.length,
  }));
}

function summarizeMotionGraphics(
  list: Array<{ kind: string }>,
): AssetUsageReport["motion_graphics_used"] {
  const counts = new Map<string, number>();
  for (const m of list) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
  return [...counts.entries()].map(([kind, times_used]) => ({
    kind,
    times_used,
  }));
}
