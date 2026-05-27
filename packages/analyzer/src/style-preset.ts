/* style_preset.json builder.
 * Aggregates statistics across all analyzed reference videos, then asks
 * the reasoning LLM to fill in the qualitative mood / scripting /
 * image-treatment / clip-treatment / transition / sfx / music / motion-
 * graphic rule blocks. Each LLM call is bounded; we fall back to
 * deterministic statistics when the LLM is unavailable. */
import path from "node:path";
import { OpenRouterClient } from "../../integrations/openrouter/src/index.js";
import { config } from "../../core/src/config.js";
import { createLogger } from "../../utils/src/logger.js";
import {
  ensureDir,
  fmtTimestamp,
  slugify,
  writeJson,
} from "../../utils/src/paths.js";
import type {
  StylePreset,
  MoodRule,
} from "../../schemas/src/style-preset.js";
import type { VideoAnalysis, Beat } from "../../schemas/src/video-analysis.js";

const log = createLogger("style-preset");

export interface BuildPresetOptions {
  channelName: string;
  channelSlug?: string;
  channelUrl?: string;
  niche?: string;
  presetIdOverride?: string;
  presetNameOverride?: string;
}

export interface BuildPresetResult {
  presetPath: string;
  preset: StylePreset;
}

export async function buildStylePreset(
  analyses: VideoAnalysis[],
  opts: BuildPresetOptions,
): Promise<BuildPresetResult> {
  if (analyses.length === 0) {
    throw new Error("buildStylePreset called with zero analyses");
  }
  const channelSlug = opts.channelSlug ?? slugify(opts.channelName);
  const presetId = opts.presetIdOverride ?? `preset_${channelSlug}`;
  const presetName = opts.presetNameOverride ?? `${opts.channelName} Style`;
  const presetDir = path.join(config.dirs.stylePresets, channelSlug);
  await ensureDir(presetDir);

  const allBeats: Beat[] = analyses.flatMap((a) => a.beats);
  const totalDurationSeconds = analyses.reduce(
    (s, a) => s + a.duration_seconds,
    0,
  );
  const totalBeats = allBeats.length;

  const shotDurs = allBeats
    .map((b) => b.duration_seconds)
    .sort((a, b) => a - b);
  const avgShot =
    shotDurs.length > 0 ? shotDurs.reduce((a, b) => a + b, 0) / shotDurs.length : 0;
  const fastThreshold = percentile(shotDurs, 0.25);
  const slowThreshold = percentile(shotDurs, 0.75);

  const assetCounts = aggregateAssetMix(analyses);
  const assetRatios = ratiosOf(assetCounts);
  const transitionDist = aggregateTransitions(analyses);
  const sfxByContext = aggregateSfxByContext(allBeats);
  const moodDistribution = aggregateMusicMoods(allBeats);
  const motionGraphicKinds = aggregateMotionGraphicKinds(allBeats);

  const visionAvgConfidence =
    allBeats.length > 0
      ? allBeats.reduce((a, b) => a + b.confidence, 0) / allBeats.length
      : 0;

  let synthesized = fallbackSynthesis();
  try {
    synthesized = await synthesizeWithLLM({
      channelName: opts.channelName,
      niche: opts.niche ?? "celebrity_documentary_youtube",
      analyses,
      transitionDist,
      sfxByContext,
      moodDistribution,
      assetRatios,
      avgShot,
    });
  } catch (e) {
    log.warn(`LLM synthesis failed: ${(e as Error).message} — using fallback`);
  }

  const titleCardFreq = countPresent(allBeats, (b) => b.title_card.present);
  const motionGraphicFreq = countPresent(allBeats, (b) => b.motion_graphic.present);

  const now = new Date().toISOString();
  const preset: StylePreset = {
    preset_id: presetId,
    preset_name: presetName,
    channel_name: opts.channelName,
    channel_url: opts.channelUrl ?? "",
    niche: opts.niche ?? "celebrity_documentary_youtube",
    created_at: now,
    updated_at: now,
    version: 1,
    videos_analyzed: analyses.map((a) => ({
      video_id: a.video_id,
      source_url: a.source_url,
      title: a.title,
      duration_seconds: a.duration_seconds,
    })),
    analysis_summary: {
      total_videos: analyses.length,
      total_duration_analyzed_seconds: totalDurationSeconds,
      confidence_score: computeConfidence({
        videoCount: analyses.length,
        totalBeats,
        avgVisionConfidence: visionAvgConfidence,
      }),
      style_description: synthesized.style_description,
    },
    global_style: synthesized.global_style,
    pacing_rules: {
      average_visual_change_seconds: avgShot,
      average_beat_duration_seconds: avgShot,
      fast_pacing_threshold_seconds: fastThreshold,
      slow_pacing_threshold_seconds: slowThreshold,
      title_card_frequency: frequencyLabel(titleCardFreq, totalBeats),
      motion_graphic_frequency: frequencyLabel(motionGraphicFreq, totalBeats),
      rules: synthesized.pacing_rules,
    },
    asset_mix_rules: assetRatios,
    mood_rules: synthesized.mood_rules,
    scripting_rules: synthesized.scripting_rules,
    image_treatment_rules: synthesized.image_treatment_rules,
    clip_treatment_rules: synthesized.clip_treatment_rules,
    headline_rules: synthesized.headline_rules,
    title_card_rules: synthesized.title_card_rules,
    lower_third_rules: synthesized.lower_third_rules,
    transition_rules: synthesized.transition_rules,
    sfx_rules: synthesized.sfx_rules,
    music_rules: synthesized.music_rules,
    motion_graphic_rules: {
      ...synthesized.motion_graphic_rules,
      use_for: synthesized.motion_graphic_rules.use_for.length > 0
        ? synthesized.motion_graphic_rules.use_for
        : Object.keys(motionGraphicKinds),
    },
    do_rules: synthesized.do_rules,
    avoid_rules: synthesized.avoid_rules,
    examples_from_reference_videos: pickExamples(analyses),
  };

  const presetPath = path.join(presetDir, "style_preset.json");
  await writeJson(presetPath, preset);
  log.info(`preset → ${presetPath}`);
  return { presetPath, preset };
}

// ───────────────────────── aggregation ──────────────────────────────

function aggregateAssetMix(
  analyses: VideoAnalysis[],
): StylePreset["asset_mix_rules"] & { total: number } {
  const m = {
    celebrity_photos: 0,
    clips: 0,
    headline_screenshots: 0,
    social_screenshots: 0,
    motion_graphics: 0,
    title_cards: 0,
    animated_backgrounds: 0,
    total: 0,
  };
  for (const a of analyses) {
    m.celebrity_photos += a.asset_mix.celebrity_photos;
    m.clips += a.asset_mix.youtube_clips;
    m.headline_screenshots += a.asset_mix.headline_screenshots;
    m.social_screenshots += a.asset_mix.social_screenshots;
    m.motion_graphics += a.asset_mix.motion_graphics;
    m.title_cards += a.asset_mix.title_cards;
    m.animated_backgrounds += a.asset_mix.animated_backgrounds;
    m.total +=
      a.asset_mix.celebrity_photos +
      a.asset_mix.youtube_clips +
      a.asset_mix.headline_screenshots +
      a.asset_mix.social_screenshots +
      a.asset_mix.motion_graphics +
      a.asset_mix.title_cards +
      a.asset_mix.animated_backgrounds +
      a.asset_mix.other;
  }
  return m;
}

function ratiosOf(
  counts: ReturnType<typeof aggregateAssetMix>,
): StylePreset["asset_mix_rules"] {
  const t = counts.total || 1;
  return {
    celebrity_photos: +(counts.celebrity_photos / t).toFixed(4),
    clips: +(counts.clips / t).toFixed(4),
    headline_screenshots: +(counts.headline_screenshots / t).toFixed(4),
    social_screenshots: +(counts.social_screenshots / t).toFixed(4),
    motion_graphics: +(counts.motion_graphics / t).toFixed(4),
    title_cards: +(counts.title_cards / t).toFixed(4),
    animated_backgrounds: +(counts.animated_backgrounds / t).toFixed(4),
  };
}

function aggregateTransitions(
  analyses: VideoAnalysis[],
): Record<string, number> {
  const dist: Record<string, number> = {};
  const allBeats = analyses.flatMap((a) => a.beats);
  for (const b of allBeats) {
    const t = b.transition_in?.type || "unknown";
    dist[t] = (dist[t] ?? 0) + 1;
  }
  return dist;
}

function aggregateSfxByContext(beats: Beat[]): Record<string, string[]> {
  const map: Record<string, Set<string>> = {};
  for (const b of beats) {
    for (const s of b.sfx ?? []) {
      const ctx = b.story_function || "unknown";
      if (!map[ctx]) map[ctx] = new Set();
      if (s.possible_asset_match) map[ctx]!.add(s.possible_asset_match);
    }
  }
  return Object.fromEntries(
    Object.entries(map).map(([k, set]) => [k, [...set].slice(0, 6)]),
  );
}

function aggregateMusicMoods(beats: Beat[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const b of beats) {
    const m = b.music.mood || "unknown";
    c[m] = (c[m] ?? 0) + 1;
  }
  const total = beats.length || 1;
  for (const k of Object.keys(c)) c[k] = +(c[k]! / total).toFixed(4);
  return c;
}

function aggregateMotionGraphicKinds(beats: Beat[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const b of beats) {
    if (!b.motion_graphic.present) continue;
    const k = b.motion_graphic.type || "other";
    c[k] = (c[k] ?? 0) + 1;
  }
  return c;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

function countPresent(beats: Beat[], pred: (b: Beat) => boolean): number {
  return beats.reduce((n, b) => n + (pred(b) ? 1 : 0), 0);
}

function frequencyLabel(count: number, total: number): string {
  if (total === 0) return "none";
  const r = count / total;
  if (r < 0.02) return "rare";
  if (r < 0.06) return "occasional";
  if (r < 0.15) return "frequent";
  return "very_frequent";
}

function computeConfidence(args: {
  videoCount: number;
  totalBeats: number;
  avgVisionConfidence: number;
}): number {
  const v = Math.min(1, args.videoCount / 8);
  const b = Math.min(1, args.totalBeats / 600);
  const vis = Math.max(0, Math.min(1, args.avgVisionConfidence));
  return +(0.35 * v + 0.3 * b + 0.35 * vis).toFixed(3);
}

function pickExamples(
  analyses: VideoAnalysis[],
): StylePreset["examples_from_reference_videos"] {
  const wanted = new Set([
    "intro",
    "scandal",
    "reveal",
    "emotional_reflection",
    "timeline_explanation",
    "public_reaction",
    "ending",
  ]);
  const seen = new Set<string>();
  const out: StylePreset["examples_from_reference_videos"] = [];
  for (const a of analyses) {
    for (const b of a.beats) {
      if (!wanted.has(b.story_function)) continue;
      if (seen.has(b.story_function)) continue;
      seen.add(b.story_function);
      out.push({
        video_id: a.video_id,
        timestamp: b.start_time,
        illustrates: b.story_function,
        description:
          `${b.asset_type} / ${b.camera_motion} — ${b.visual_description.slice(0, 160)}`,
      });
      if (out.length >= 12) return out;
    }
  }
  return out;
}

void fmtTimestamp; // reserved for future timestamp emits

// ───────────────────────── LLM synthesis ────────────────────────────

interface SynthesisInput {
  channelName: string;
  niche: string;
  analyses: VideoAnalysis[];
  transitionDist: Record<string, number>;
  sfxByContext: Record<string, string[]>;
  moodDistribution: Record<string, number>;
  assetRatios: StylePreset["asset_mix_rules"];
  avgShot: number;
}

interface SynthesisOutput {
  style_description: string;
  global_style: StylePreset["global_style"];
  pacing_rules: string[];
  mood_rules: StylePreset["mood_rules"];
  scripting_rules: StylePreset["scripting_rules"];
  image_treatment_rules: StylePreset["image_treatment_rules"];
  clip_treatment_rules: StylePreset["clip_treatment_rules"];
  headline_rules: StylePreset["headline_rules"];
  title_card_rules: StylePreset["title_card_rules"];
  lower_third_rules: StylePreset["lower_third_rules"];
  transition_rules: StylePreset["transition_rules"];
  sfx_rules: StylePreset["sfx_rules"];
  music_rules: StylePreset["music_rules"];
  motion_graphic_rules: StylePreset["motion_graphic_rules"];
  do_rules: string[];
  avoid_rules: string[];
}

const SYS = `You are the editing director for a YouTube celebrity / gossip /
documentary channel. You receive distilled statistics and per-video editing
summaries from several finished videos.

Synthesize a reusable "Style Preset" that teaches a future autonomous
editor how to edit new videos in the channel's voice. Return EXACTLY this
JSON shape — no prose outside the JSON:

{
  "style_description": "...",
  "global_style": {
    "editing_mood": "...",
    "visual_style": "...",
    "pacing_style": "...",
    "audio_style": "...",
    "storytelling_style": "..."
  },
  "pacing_rules": ["..."],
  "mood_rules": {
    "emotional": MoodRule, "scandal": MoodRule, "reveal": MoodRule,
    "timeline": MoodRule, "public_reaction": MoodRule,
    "ending_reflection": MoodRule
  },
  "scripting_rules": {
    "intro_hook": "...","setup": "...","conflict_build": "...",
    "reveal_structure": "...","timeline_explanation": "...",
    "public_reaction": "...","ending": "...",
    "common_story_functions": ["..."]
  },
  "image_treatment_rules": {
    "portrait_images": "...","low_quality_images": "...",
    "emotional_closeups": "...","event_photos": "...","old_photos": "...",
    "background_blur_rules": "...","zoom_pan_rules": ["..."]
  },
  "clip_treatment_rules": {
    "interview_clips": "...","event_clips": "...","paparazzi_clips": "...",
    "news_clips": "...","clip_duration_rules": "...","crop_rules": "..."
  },
  "headline_rules": {
    "when_to_use": "...","style": "...","duration": "...","animation": "...","sfx": "..."
  },
  "title_card_rules": {
    "when_to_use": "...","duration_seconds": "...","text_style": "...",
    "animation_style": "...","transition_style": "...","sfx_style": "..."
  },
  "lower_third_rules": {
    "when_to_use": "...","duration_seconds": "...","placement": "...",
    "style": "...","animation": "..."
  },
  "transition_rules": {
    "normal_scene_change": "...","emotional_shift": "...","dramatic_reveal": "...",
    "chapter_change": "...","fast_section": "...","avoid": ["..."]
  },
  "sfx_rules": {
    "title_card": "...","reveal": "...","headline": "...",
    "normal_transition": "...","emotional_moment": "...","avoid": ["..."]
  },
  "music_rules": {
    "default_bed": "...","emotional": "...","scandal": "...","timeline": "...",
    "reveal": "...","ending": "...","ducking_rules": "..."
  },
  "motion_graphic_rules": {
    "use_for": ["..."],"timeline_graphics": "...","relationship_maps": "...",
    "money_graphics": "...","public_reaction_graphics": "...",
    "before_after": "...","animation_style": "..."
  },
  "do_rules": ["..."],
  "avoid_rules": ["..."]
}

A MoodRule has: { visuals, camera_motion, music, transitions, sfx, text, editing_notes }.

Rules:
- Base EVERY statement on the supplied evidence. Do not invent.
- If something is unknown, say "unknown — insufficient signal".
- Keep arrays concise (3-8 items each).
- Output ONLY the JSON object.`;

async function synthesizeWithLLM(input: SynthesisInput): Promise<SynthesisOutput> {
  const client = new OpenRouterClient();
  const beatSample = input.analyses.flatMap((a) => a.beats).slice(0, 200).map((b) => ({
    asset: b.asset_type,
    cam: b.camera_motion,
    fn: b.story_function,
    tone: b.emotional_tone,
    lt: b.lower_third.present ? b.lower_third.text.slice(0, 60) : "",
    tc: b.title_card.present ? b.title_card.text.slice(0, 60) : "",
    to: b.text_overlay.present ? b.text_overlay.text.slice(0, 60) : "",
    music: b.music.mood,
  }));
  const user = [
    `Channel: ${input.channelName} (${input.analyses.length} videos, niche=${input.niche})`,
    `Average shot: ${input.avgShot.toFixed(2)}s`,
    `Asset ratios: ${JSON.stringify(input.assetRatios)}`,
    `Transition distribution: ${JSON.stringify(input.transitionDist)}`,
    `Music mood distribution: ${JSON.stringify(input.moodDistribution)}`,
    `SFX by context: ${JSON.stringify(input.sfxByContext)}`,
    `Beat sample (up to 200): ${JSON.stringify(beatSample)}`,
  ].join("\n");
  return client.chatJson<SynthesisOutput>(
    [
      { role: "system", content: SYS },
      { role: "user", content: user },
    ],
    {
      model: config.openrouter.reasoningModel,
      temperature: 0.25,
      maxTokens: 3500,
    },
  );
}

function fallbackSynthesis(): SynthesisOutput {
  const blank: MoodRule = {
    visuals: "",
    camera_motion: "",
    music: "",
    transitions: "",
    sfx: "",
    text: "",
    editing_notes: "fallback — LLM synthesis unavailable",
  };
  return {
    style_description: "fallback — LLM synthesis unavailable",
    global_style: {
      editing_mood: "",
      visual_style: "",
      pacing_style: "",
      audio_style: "",
      storytelling_style: "",
    },
    pacing_rules: [],
    mood_rules: {
      emotional: blank,
      scandal: blank,
      reveal: blank,
      timeline: blank,
      public_reaction: blank,
      ending_reflection: blank,
    },
    scripting_rules: {
      intro_hook: "",
      setup: "",
      conflict_build: "",
      reveal_structure: "",
      timeline_explanation: "",
      public_reaction: "",
      ending: "",
      common_story_functions: [],
    },
    image_treatment_rules: {
      portrait_images: "",
      low_quality_images: "",
      emotional_closeups: "",
      event_photos: "",
      old_photos: "",
      background_blur_rules: "",
      zoom_pan_rules: [],
    },
    clip_treatment_rules: {
      interview_clips: "",
      event_clips: "",
      paparazzi_clips: "",
      news_clips: "",
      clip_duration_rules: "",
      crop_rules: "",
    },
    headline_rules: { when_to_use: "", style: "", duration: "", animation: "", sfx: "" },
    title_card_rules: {
      when_to_use: "",
      duration_seconds: "",
      text_style: "",
      animation_style: "",
      transition_style: "",
      sfx_style: "",
    },
    lower_third_rules: {
      when_to_use: "",
      duration_seconds: "",
      placement: "",
      style: "",
      animation: "",
    },
    transition_rules: {
      normal_scene_change: "",
      emotional_shift: "",
      dramatic_reveal: "",
      chapter_change: "",
      fast_section: "",
      avoid: [],
    },
    sfx_rules: {
      title_card: "",
      reveal: "",
      headline: "",
      normal_transition: "",
      emotional_moment: "",
      avoid: [],
    },
    music_rules: {
      default_bed: "",
      emotional: "",
      scandal: "",
      timeline: "",
      reveal: "",
      ending: "",
      ducking_rules: "",
    },
    motion_graphic_rules: {
      use_for: [],
      timeline_graphics: "",
      relationship_maps: "",
      money_graphics: "",
      public_reaction_graphics: "",
      before_after: "",
      animation_style: "",
    },
    do_rules: [],
    avoid_rules: [],
  };
}
