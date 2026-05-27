/* Analyze one reference video and emit the new video_analysis.json
 * schema (PHASE 3). Wraps existing ffmpeg/scenedetect/audio/transition
 * modules and pairs them with the new beat-vision pass and Whisper transcript.
 *
 * Output directory:
 *   <referenceVideosDir>/<channelSlug>/<videoId>/
 *     source.mp4
 *     audio/audio.wav
 *     frames/<keyframes>.jpg
 *     cache/{scenes,transitions,audio,transcript,beats/*}.json
 *     video_analysis.json
 *     style_summary.md
 */
import path from "node:path";
import { config } from "../../core/src/config.js";
import { createLogger } from "../../utils/src/logger.js";
import {
  ensureDir,
  fileExists,
  fmtTimestamp,
  readJson,
  writeJson,
  writeText,
} from "../../utils/src/paths.js";
import {
  ffprobe,
  extractAudio,
  checkBinaries,
} from "../../integrations/ffmpeg/src/index.js";
import { detectScenes, type RawScene } from "../../integrations/scenedetect/src/index.js";
import {
  analyzeAudio,
  type AudioAnalysisResult,
} from "../../../src/analyzer/audioAnalyzer.js";
import { detectTransitions } from "../../../src/analyzer/transitionDetector.js";
import { transcribeAudio, type TranscriptResult } from "../../integrations/whisper/src/index.js";
import { downloadVideo } from "../../integrations/ytdlp/src/index.js";
import {
  buildKeyframeRequests,
  extractKeyframes,
} from "./keyframes.js";
import {
  analyzeBeatsWithVision,
  type BeatVisionInput,
  type BeatVisionOutput,
} from "./beat-vision.js";
import type {
  VideoAnalysis,
  Beat,
  AssetMix,
  GlobalEditingSummary,
} from "../../schemas/src/video-analysis.js";

const log = createLogger("ref-video");

export interface AnalyzeReferenceVideoOptions {
  /** Channel slug — controls the output dir layout. */
  channelSlug: string;
  /** YouTube URL, or local file path. */
  source: string;
  /** Optional override video id; defaults to extracted YouTube id or hash. */
  videoIdOverride?: string;
  /** Optional title for the output. */
  title?: string;
  /** When true, regenerate even if cached. */
  force?: boolean;
  /** Pass a transcript instead of running whisper (e.g. from Apify). */
  precomputedTranscript?: TranscriptResult;
}

export interface AnalyzeReferenceVideoResult {
  videoAnalysisPath: string;
  styleSummaryPath: string;
  videoDir: string;
  analysis: VideoAnalysis;
}

export async function analyzeReferenceVideo(
  opts: AnalyzeReferenceVideoOptions,
): Promise<AnalyzeReferenceVideoResult> {
  const bins = await checkBinaries();
  if (!bins.ffmpeg || !bins.ffprobe) {
    throw new Error(
      "ffmpeg/ffprobe required. Set FFMPEG_PATH / FFPROBE_PATH or install ffmpeg.",
    );
  }
  if (!bins.python) {
    throw new Error("python3 required for scenedetect/audio/whisper.");
  }

  const isUrl = /^https?:\/\//i.test(opts.source);
  const channelDir = path.join(config.dirs.referenceVideos, opts.channelSlug);
  await ensureDir(channelDir);

  // Step 1 — get a local mp4 path
  let localPath: string;
  let videoId: string;
  let sourceUrl: string;
  if (isUrl) {
    log.info(`downloading ${opts.source}`);
    const dl = await downloadVideo(opts.source, channelDir, { force: opts.force });
    localPath = dl.localPath;
    videoId = opts.videoIdOverride ?? dl.videoId;
    sourceUrl = opts.source;
  } else {
    localPath = path.resolve(opts.source);
    videoId =
      opts.videoIdOverride ??
      path.basename(localPath).replace(/\.[^.]+$/, "");
    sourceUrl = `file://${localPath}`;
  }

  const videoDir = path.join(channelDir, videoId);
  const audioDir = path.join(videoDir, "audio");
  const framesDir = path.join(videoDir, "frames");
  const cacheDir = path.join(videoDir, "cache");
  await Promise.all([ensureDir(audioDir), ensureDir(framesDir), ensureDir(cacheDir)]);
  const outVideoAnalysis = path.join(videoDir, "video_analysis.json");
  const outStyleSummary = path.join(videoDir, "style_summary.md");

  if (!opts.force && (await fileExists(outVideoAnalysis))) {
    log.info(`cache hit — ${outVideoAnalysis}`);
    const cached = await readJson<VideoAnalysis>(outVideoAnalysis);
    return {
      videoAnalysisPath: outVideoAnalysis,
      styleSummaryPath: outStyleSummary,
      videoDir,
      analysis: cached,
    };
  }

  // Step 2 — probe + extract audio
  const probe = await ffprobe(localPath);
  const audioPath = await extractAudio(localPath, audioDir, "audio");

  // Step 3 — scenes
  const sceneCache = path.join(cacheDir, "scenes.json");
  const scenes = await detectScenes(localPath, sceneCache);
  log.info(`scenes=${scenes.scenes.length}`);

  // Step 4 — transitions + audio + transcript in parallel
  const transitionCache = path.join(cacheDir, "transitions.json");
  const audioCache = path.join(cacheDir, "audio.json");
  const transcriptCache = path.join(cacheDir, "transcript.json");

  const [transitions, audio, transcript] = await Promise.all([
    detectTransitions(localPath, sceneCache, transitionCache),
    analyzeAudio(audioPath, audioCache),
    opts.precomputedTranscript
      ? Promise.resolve(opts.precomputedTranscript).then(async (t) => {
          await writeJson(transcriptCache, t);
          return t;
        })
      : transcribeAudio(audioPath, transcriptCache, {
          model: config.whisper.model,
          device: config.whisper.device,
          computeType: config.whisper.computeType,
          language: config.whisper.language,
        }),
  ]);

  // Step 5 — keyframes
  const audioSpikes = extractAudioSpikes(audio);
  const keyframeRequests = buildKeyframeRequests(scenes.scenes, {
    framesPerScene: config.tuning.visionFramesPerBeat,
    includeTransitions: false, // pre-cut frames eat budget for marginal gain
    audioSpikes,
  });
  const keyframeResults = await extractKeyframes(
    localPath,
    keyframeRequests,
    framesDir,
    768,
  );

  // Step 6 — assemble vision inputs per scene
  const sceneTranscripts = transcriptPerScene(scenes.scenes, transcript);
  const visionInputs: BeatVisionInput[] = scenes.scenes.map((scene, idx) => {
    const keyframes = keyframeResults
      .filter((k) => k.sceneIndex === scene.index)
      .flatMap((k) =>
        k.framePaths.map((p, i) => ({ path: p, t: k.timestamps[i]! })),
      );
    const prev =
      idx > 0 ? sceneTranscripts.get(scenes.scenes[idx - 1]!.index) ?? null : null;
    const next =
      idx < scenes.scenes.length - 1
        ? sceneTranscripts.get(scenes.scenes[idx + 1]!.index) ?? null
        : null;
    const pos: BeatVisionInput["scenePosition"] =
      idx === 0
        ? "intro"
        : idx === scenes.scenes.length - 1
          ? "ending"
          : "middle";
    return {
      sceneIndex: scene.index,
      framePaths: keyframes.map((k) => k.path),
      timestamps: keyframes.map((k) => k.t),
      transcript: sceneTranscripts.get(scene.index) ?? "",
      prevTranscript: prev,
      nextTranscript: next,
      scenePosition: pos,
    };
  });

  const beatVision = await analyzeBeatsWithVision(
    visionInputs,
    path.join(cacheDir, "beats"),
  );

  // Step 7 — build Beats matching the new schema
  const beats = buildBeats({
    scenes: scenes.scenes,
    vision: beatVision,
    transitions: transitions.transitions,
    audio,
    sceneTranscripts,
  });

  // Step 8 — globals
  const globalSummary = computeGlobalSummary(beats, scenes.scenes, audio);
  const assetMix = computeAssetMix(beats);

  const analysis: VideoAnalysis = {
    video_id: videoId,
    source_url: sourceUrl,
    title: opts.title ?? videoId,
    duration_seconds: probe.duration,
    resolution: `${probe.width}x${probe.height}`,
    fps: probe.fps,
    analyzed_at: new Date().toISOString(),
    global_editing_summary: globalSummary,
    asset_mix: assetMix,
    beats,
    detected_patterns: extractPatterns(beats, transitions.transitions),
  };

  await writeJson(outVideoAnalysis, analysis);
  await writeText(outStyleSummary, renderStyleSummary(analysis));

  return {
    videoAnalysisPath: outVideoAnalysis,
    styleSummaryPath: outStyleSummary,
    videoDir,
    analysis,
  };
}

// ───────────────────────────── helpers ─────────────────────────────────

function extractAudioSpikes(
  audio: AudioAnalysisResult,
): Array<{ t: number }> {
  // Treat the top-10% intensity samples as spikes (cheap heuristic).
  const sorted = [...audio.intensity_curve].sort(
    (a, b) => b.intensity - a.intensity,
  );
  const cutoff = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.1)]!.intensity : 1;
  return audio.intensity_curve
    .filter((s) => s.intensity >= cutoff && s.intensity > 0.2)
    .map((s) => ({ t: s.t }));
}

function transcriptPerScene(
  scenes: RawScene[],
  transcript: TranscriptResult,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const scene of scenes) {
    const words = transcript.words.filter(
      (w) => w.start < scene.end && w.end > scene.start,
    );
    out.set(scene.index, words.map((w) => w.text).join(" ").trim());
  }
  return out;
}

interface BuildBeatsArgs {
  scenes: RawScene[];
  vision: BeatVisionOutput[];
  transitions: Array<{
    at: number;
    scene_index: number;
    duration_frames: number;
    type: string;
    confidence: number;
    reason: string;
  }>;
  audio: AudioAnalysisResult;
  sceneTranscripts: Map<number, string>;
}

function buildBeats(args: BuildBeatsArgs): Beat[] {
  const visionByScene = new Map<number, BeatVisionOutput>();
  for (const v of args.vision) visionByScene.set(v.sceneIndex, v);

  const transitionByScene = new Map<
    number,
    BuildBeatsArgs["transitions"][number]
  >();
  for (const t of args.transitions) transitionByScene.set(t.scene_index, t);

  return args.scenes.map((scene, idx) => {
    const v = visionByScene.get(scene.index);
    const transitionIn = transitionByScene.get(scene.index);
    const nextScene = args.scenes[idx + 1];
    const transitionOut = nextScene ? transitionByScene.get(nextScene.index) : null;
    const mid = scene.start + scene.duration / 2;
    const intensity = lookupIntensity(args.audio.intensity_curve, mid);
    const transcript = args.sceneTranscripts.get(scene.index) ?? "";

    const beat: Beat = {
      beat_id: `beat_${scene.index.toString().padStart(5, "0")}`,
      start_time: fmtTimestamp(scene.start),
      end_time: fmtTimestamp(scene.end),
      duration_seconds: scene.duration,
      transcript_text: transcript,
      beat_summary: transcript.slice(0, 140),
      story_function: v?.story_function ?? "unknown",
      emotional_tone: v?.emotional_tone ?? "unknown",
      visual_description: v?.visual_description ?? "",
      asset_type: v?.asset_type ?? "unknown",
      camera_motion: v?.camera_motion ?? "unknown",
      layout_type: v?.layout_type ?? "",
      text_overlay: {
        present: v?.text_overlay.present ?? false,
        text: v?.text_overlay.text ?? "",
        placement: v?.text_overlay.placement ?? "",
        style_notes: v?.text_overlay.style_notes ?? "",
        duration_seconds: v?.text_overlay.present ? scene.duration : 0,
      },
      lower_third: {
        present: v?.lower_third.present ?? false,
        text: v?.lower_third.text ?? "",
        style_notes: v?.lower_third.style_notes ?? "",
        duration_seconds: v?.lower_third.present ? Math.min(4, scene.duration) : 0,
      },
      title_card: {
        present: v?.title_card.present ?? false,
        text: v?.title_card.text ?? "",
        style_notes: v?.title_card.style_notes ?? "",
        duration_seconds: v?.title_card.present ? scene.duration : 0,
      },
      motion_graphic: {
        present: v?.motion_graphic.present ?? false,
        type: v?.motion_graphic.type ?? "",
        purpose: v?.motion_graphic.purpose ?? "",
        style_notes: v?.motion_graphic.style_notes ?? "",
      },
      transition_in: transitionIn
        ? {
            type: transitionIn.type,
            duration_seconds: Math.max(0.01, transitionIn.duration_frames / 30),
            possible_asset_match: "",
            confidence: transitionIn.confidence,
          }
        : {
            type: idx === 0 ? "fade_from_black" : "hard_cut",
            duration_seconds: idx === 0 ? 0.5 : 0,
            possible_asset_match: "",
            confidence: idx === 0 ? 0.6 : 0.95,
          },
      transition_out: transitionOut
        ? {
            type: transitionOut.type,
            duration_seconds: Math.max(
              0.01,
              transitionOut.duration_frames / 30,
            ),
            possible_asset_match: "",
            confidence: transitionOut.confidence,
          }
        : {
            type: idx === args.scenes.length - 1 ? "fade_to_black" : "hard_cut",
            duration_seconds: idx === args.scenes.length - 1 ? 0.5 : 0,
            possible_asset_match: "",
            confidence: 0.7,
          },
      sfx: [],
      music: {
        mood: args.audio.mood_guess,
        intensity:
          intensity > 0.7 ? "high" : intensity > 0.35 ? "medium" : "low",
        volume_under_voice: transcript ? "ducked" : "full",
        notes: `tempo≈${args.audio.tempo_bpm.toFixed(0)} bpm`,
      },
      editing_purpose: v?.editing_purpose ?? "",
      confidence: v?.confidence ?? 0.4,
    };
    return beat;
  });
}

function lookupIntensity(
  curve: AudioAnalysisResult["intensity_curve"],
  t: number,
): number {
  if (curve.length === 0) return 0;
  let last = curve[0]!.intensity;
  for (const s of curve) {
    if (s.t > t) break;
    last = s.intensity;
  }
  return last;
}

function computeGlobalSummary(
  beats: Beat[],
  scenes: RawScene[],
  audio: AudioAnalysisResult,
): GlobalEditingSummary {
  const durations = beats.map((b) => b.duration_seconds);
  const avgShot =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
  const total = scenes.reduce((m, s) => Math.max(m, s.end), 0);
  const visualChangeFreq = total > 0 ? scenes.length / total : 0;
  const intro = beats.slice(0, Math.min(4, beats.length));
  const ending = beats.slice(Math.max(0, beats.length - 4));
  const introPattern = describeStretch(intro);
  const endingPattern = describeStretch(ending);
  return {
    editing_mood: audio.mood_guess,
    average_visual_change_seconds: 1 / Math.max(0.0001, visualChangeFreq),
    average_scene_duration_seconds: avgShot,
    total_major_cuts: scenes.length,
    total_minor_visual_changes: beats.filter((b) =>
      ["slow_zoom_in", "slow_zoom_out", "pan_left", "pan_right", "push_in"].includes(
        b.camera_motion,
      ),
    ).length,
    intro_pattern: introPattern,
    ending_pattern: endingPattern,
    overall_style_notes: `avg shot ${avgShot.toFixed(2)}s | ${scenes.length} cuts | ${audio.mood_guess}`,
  };
}

function describeStretch(beats: Beat[]): string {
  if (beats.length === 0) return "no beats";
  const counts = new Map<string, number>();
  for (const b of beats) counts.set(b.asset_type, (counts.get(b.asset_type) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const avg = beats.reduce((a, b) => a + b.duration_seconds, 0) / beats.length;
  return `${beats.length} beats, avg ${avg.toFixed(2)}s, dominant=${dominant?.[0] ?? "unknown"}`;
}

function computeAssetMix(beats: Beat[]): AssetMix {
  const m: AssetMix = {
    celebrity_photos: 0,
    youtube_clips: 0,
    headline_screenshots: 0,
    social_screenshots: 0,
    motion_graphics: 0,
    title_cards: 0,
    animated_backgrounds: 0,
    other: 0,
  };
  for (const b of beats) {
    switch (b.asset_type) {
      case "celebrity_photo":
      case "event_photo":
      case "paparazzi_clip":
        m.celebrity_photos++;
        break;
      case "interview_clip":
        m.youtube_clips++;
        break;
      case "news_headline_screenshot":
        m.headline_screenshots++;
        break;
      case "social_media_screenshot":
        m.social_screenshots++;
        break;
      case "motion_graphic":
        m.motion_graphics++;
        break;
      case "title_card":
        m.title_cards++;
        break;
      case "animated_background":
        m.animated_backgrounds++;
        break;
      default:
        m.other++;
    }
  }
  return m;
}

function extractPatterns(
  beats: Beat[],
  transitions: BuildBeatsArgs["transitions"],
): VideoAnalysis["detected_patterns"] {
  const out: VideoAnalysis["detected_patterns"] = {
    pacing_patterns: [],
    visual_patterns: [],
    audio_patterns: [],
    text_patterns: [],
    transition_patterns: [],
    scripting_patterns: [],
    mood_patterns: [],
  };
  const avgShot =
    beats.reduce((a, b) => a + b.duration_seconds, 0) / Math.max(1, beats.length);
  out.pacing_patterns.push(`average beat ${avgShot.toFixed(2)}s`);
  const transDist = new Map<string, number>();
  for (const t of transitions) transDist.set(t.type, (transDist.get(t.type) ?? 0) + 1);
  for (const [k, n] of [...transDist.entries()].sort((a, b) => b[1] - a[1])) {
    out.transition_patterns.push(`${k}: ${n}`);
  }
  const overlayCount = beats.filter((b) => b.text_overlay.present).length;
  if (overlayCount > 0)
    out.text_patterns.push(`${overlayCount} beats use text overlays`);
  const lowerThirdCount = beats.filter((b) => b.lower_third.present).length;
  if (lowerThirdCount > 0)
    out.text_patterns.push(`${lowerThirdCount} beats use lower thirds`);
  const tones = new Map<string, number>();
  for (const b of beats) tones.set(b.emotional_tone, (tones.get(b.emotional_tone) ?? 0) + 1);
  for (const [k, n] of [...tones.entries()].sort((a, b) => b[1] - a[1])) {
    out.mood_patterns.push(`${k}: ${n}`);
  }
  return out;
}

function renderStyleSummary(a: VideoAnalysis): string {
  const lines: string[] = [];
  lines.push(`# Style summary — ${a.video_id}`);
  lines.push("");
  lines.push(`- Source: ${a.source_url}`);
  lines.push(`- Duration: ${a.duration_seconds.toFixed(1)}s | ${a.resolution} | ${a.fps.toFixed(2)} fps`);
  lines.push(`- Analyzed: ${a.analyzed_at}`);
  lines.push("");
  lines.push("## Global");
  for (const [k, v] of Object.entries(a.global_editing_summary)) {
    lines.push(`- **${k}**: ${typeof v === "number" ? (v as number).toFixed(2) : v}`);
  }
  lines.push("");
  lines.push("## Asset mix");
  for (const [k, n] of Object.entries(a.asset_mix)) {
    lines.push(`- ${k}: ${n}`);
  }
  lines.push("");
  lines.push("## Detected patterns");
  for (const [k, list] of Object.entries(a.detected_patterns)) {
    if ((list as string[]).length === 0) continue;
    lines.push(`### ${k}`);
    for (const item of list as string[]) lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push(`## Beats (${a.beats.length})`);
  for (const b of a.beats.slice(0, 40)) {
    lines.push(
      `- ${b.beat_id} ${b.start_time}–${b.end_time} (${b.duration_seconds.toFixed(2)}s) — ${b.asset_type} / ${b.camera_motion} / ${b.story_function} — ${b.visual_description.slice(0, 120)}`,
    );
  }
  if (a.beats.length > 40) lines.push(`- … ${a.beats.length - 40} more`);
  return lines.join("\n");
}
