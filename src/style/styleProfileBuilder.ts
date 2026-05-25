import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import {
  readJson,
  writeJson,
  ensureDir,
  slugify,
  fileExists,
} from "../utils/paths.js";
import { OpenRouterClient } from "../openrouter/client.js";
import type {
  VideoAnalysis,
  Beat,
  TransitionEvent,
} from "../schemas/videoAnalysis.js";
import type { ChannelStyleProfile } from "../schemas/channelStyleProfile.js";

const log = createLogger("style-profile");

const ASSET_TYPES = [
  "celebrity_photo",
  "event_photo",
  "interview_clip",
  "paparazzi_clip",
  "news_headline_screenshot",
  "social_media_screenshot",
  "animated_background",
  "title_card",
  "lower_third",
  "motion_graphic",
  "mixed_layout",
] as const;

function emptyAssetRatios(): ChannelStyleProfile["asset_ratio_rules"] {
  return Object.fromEntries(ASSET_TYPES.map((k) => [k, 0])) as ChannelStyleProfile["asset_ratio_rules"];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * sorted.length)),
  );
  return sorted[idx]!;
}

function chunkAvg(values: number[], chunkCount = 6): number[] {
  if (values.length === 0) return [];
  const size = Math.max(1, Math.floor(values.length / chunkCount));
  const out: number[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const slice = values.slice(i * size, (i + 1) * size);
    if (slice.length > 0) {
      out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    }
  }
  return out;
}

function distribution<T extends string>(items: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const it of items) counts[it] = (counts[it] ?? 0) + 1;
  const total = items.length || 1;
  return Object.fromEntries(
    Object.entries(counts).map(([k, v]) => [k, +(v / total).toFixed(4)]),
  );
}

function byContext(beats: Beat[], pick: (b: Beat) => string | null): Record<string, string[]> {
  const map: Record<string, Set<string>> = {};
  for (const b of beats) {
    const v = pick(b);
    if (!v) continue;
    const ctx = b.emotional_purpose;
    if (!map[ctx]) map[ctx] = new Set();
    map[ctx]!.add(v);
  }
  return Object.fromEntries(
    Object.entries(map).map(([k, set]) => [k, [...set].slice(0, 6)]),
  );
}

interface ProfileSynthesisInput {
  channelName: string;
  channelSlug: string;
  videoCount: number;
  durations: number[];
  beats: Beat[];
  transitions: TransitionEvent[];
  styleSummaries: string[];
  audioMoods: string[];
}

const SYNTHESIS_SYSTEM = `You are the editing director for a YouTube celebrity
documentary channel. Several finished videos have been analyzed; you receive
distilled statistics and per-video editing summaries.

Synthesize a reusable "Style Library" that teaches a future autonomous editor
how to edit new videos in the channel's voice. Return EXACTLY this JSON object:

{
  "niche": "...",
  "editing_mood": "...",
  "intro_rules": {
    "typical_duration_seconds": number,
    "hook_style": "...",
    "common_assets": ["..."],
    "transitions": ["..."],
    "sfx": ["..."],
    "music_mood": "...",
    "notes": "..."
  },
  "ending_rules": {
    "typical_duration_seconds": number,
    "cta_style": "...",
    "common_assets": ["..."],
    "music_mood": "...",
    "notes": "..."
  },
  "image_treatment_rules": ["...", "..."],
  "clip_treatment_rules": ["...", "..."],
  "headline_screenshot_rules": ["..."],
  "title_card_rules": ["..."],
  "lower_third_rules": ["..."],
  "transition_rules_notes": "...",
  "sfx_rules_notes": "...",
  "sfx_by_context": { "<emotional_purpose>": ["sfx_name", "..."] },
  "music_rules_notes": "...",
  "music_by_emotional_purpose": { "<emotional_purpose>": "music mood/description" },
  "motion_graphic_rules_notes": "...",
  "motion_graphic_when_to_use": { "<kind>": "<rule>" },
  "emotional_editing_rules": [
    {
      "moment": "scandal",
      "use_assets": ["..."],
      "camera_motion": "...",
      "pacing": "...",
      "music": "...",
      "transition": "...",
      "sfx": "...",
      "notes": "..."
    }
  ],
  "do_rules": ["..."],
  "avoid_rules": ["..."]
}

Rules:
- Base EVERY statement on the supplied evidence. Do not invent.
- If something is unknown, say so explicitly in that field.
- Keep arrays concise (3–8 items each).
- Output ONLY the JSON object.`;

async function synthesize(
  input: ProfileSynthesisInput,
  client: OpenRouterClient,
): Promise<{
  niche: string;
  editing_mood: string;
  intro_rules: ChannelStyleProfile["intro_rules"];
  ending_rules: ChannelStyleProfile["ending_rules"];
  image_treatment_rules: string[];
  clip_treatment_rules: string[];
  headline_screenshot_rules: string[];
  title_card_rules: string[];
  lower_third_rules: string[];
  transition_rules_notes: string;
  sfx_rules_notes: string;
  sfx_by_context: Record<string, string[]>;
  music_rules_notes: string;
  music_by_emotional_purpose: Record<string, string>;
  motion_graphic_rules_notes: string;
  motion_graphic_when_to_use: Record<string, string>;
  emotional_editing_rules: ChannelStyleProfile["emotional_editing_rules"];
  do_rules: string[];
  avoid_rules: string[];
}> {
  const beats = input.beats;
  const compact = beats.slice(0, 200).map((b) => ({
    asset: b.asset_type,
    cam: b.camera_motion,
    emo: b.emotional_purpose,
    lt: b.lower_third_text ?? "",
    tc: b.title_card_text ?? "",
    hl: b.headline_text ?? "",
    mood: b.music_mood,
  }));

  const transitionDist = distribution(input.transitions.map((t) => t.type));
  const assetDist = distribution(beats.map((b) => b.asset_type));
  const emoDist = distribution(beats.map((b) => b.emotional_purpose));

  const userPrompt = [
    `Channel: ${input.channelName} (${input.videoCount} videos)`,
    `Avg duration: ${(input.durations.reduce((a, b) => a + b, 0) / Math.max(1, input.durations.length)).toFixed(0)}s`,
    `Audio moods observed: ${[...new Set(input.audioMoods)].join(", ")}`,
    `Asset distribution: ${JSON.stringify(assetDist)}`,
    `Transition distribution: ${JSON.stringify(transitionDist)}`,
    `Emotional purpose distribution: ${JSON.stringify(emoDist)}`,
    `Beat sample (up to 200): ${JSON.stringify(compact)}`,
    "",
    `Per-video style summaries (truncated):`,
    input.styleSummaries
      .map((s, i) => `--- Video ${i + 1} ---\n${s.slice(0, 2500)}`)
      .join("\n\n"),
  ].join("\n");

  return client.chatJson(
    [
      { role: "system", content: SYNTHESIS_SYSTEM },
      { role: "user", content: userPrompt },
    ],
    {
      model: config.openrouter.reasoningModel,
      temperature: 0.25,
      maxTokens: 3000,
    },
  );
}

export interface BuildProfileOptions {
  channelName: string;
  channelSlug?: string;
  channelUrl?: string;
  /** Use only these video slugs (default: all under the channel dir). */
  videoSlugs?: string[];
  force?: boolean;
}

export async function buildChannelStyleProfile(
  opts: BuildProfileOptions,
): Promise<{ profilePath: string; profile: ChannelStyleProfile }> {
  const channelSlug = opts.channelSlug ?? slugify(opts.channelName);
  const channelDir = path.join(config.styleLibraryDir, channelSlug);
  const videoAnalysesDir = path.join(channelDir, "video_analyses");
  await ensureDir(channelDir);

  let videoDirs: string[];
  try {
    videoDirs = (await fs.readdir(videoAnalysesDir)).map((d) =>
      path.join(videoAnalysesDir, d),
    );
  } catch {
    throw new Error(
      `No video_analyses found at ${videoAnalysesDir}. Run \`vibe analyze\` on one or more videos first.`,
    );
  }
  if (opts.videoSlugs && opts.videoSlugs.length > 0) {
    const wanted = new Set(opts.videoSlugs);
    videoDirs = videoDirs.filter((d) => wanted.has(path.basename(d)));
  }

  const analyses: VideoAnalysis[] = [];
  const summaries: string[] = [];
  for (const dir of videoDirs) {
    const aPath = path.join(dir, "video_analysis.json");
    const sPath = path.join(dir, "style_summary.md");
    if (!(await fileExists(aPath))) continue;
    try {
      const a = await readJson<VideoAnalysis>(aPath);
      analyses.push(a);
      if (await fileExists(sPath)) {
        summaries.push(await fs.readFile(sPath, "utf-8"));
      }
    } catch (e) {
      log.warn(`skip ${dir}: ${(e as Error).message}`);
    }
  }

  if (analyses.length === 0) {
    throw new Error(`No valid video_analysis.json found in ${videoAnalysesDir}`);
  }

  const allBeats: Beat[] = [];
  const allTransitions: TransitionEvent[] = [];
  const durations: number[] = [];
  const audioMoods: string[] = [];
  for (const a of analyses) {
    allBeats.push(...a.beats);
    allTransitions.push(...a.transitions);
    durations.push(a.global.duration);
    audioMoods.push(a.music.mood_guess);
  }

  const allShotDurations = allBeats.map((b) => b.duration).sort((a, b) => a - b);
  const avgShot =
    allShotDurations.length > 0
      ? allShotDurations.reduce((a, b) => a + b, 0) / allShotDurations.length
      : 0;

  const assetCounts = emptyAssetRatios() as Record<string, number>;
  for (const b of allBeats) {
    if (b.asset_type in assetCounts) {
      assetCounts[b.asset_type] = (assetCounts[b.asset_type] ?? 0) + 1;
    }
  }
  const totalBeats = allBeats.length || 1;
  const assetRatios = Object.fromEntries(
    Object.entries(assetCounts).map(([k, v]) => [k, +(v / totalBeats).toFixed(4)]),
  ) as ChannelStyleProfile["asset_ratio_rules"];

  const chunkAvgs = chunkAvg(
    allBeats.map((b) => b.duration),
    8,
  );
  const fastest = chunkAvgs.length > 0 ? Math.min(...chunkAvgs) : avgShot;
  const slowest = chunkAvgs.length > 0 ? Math.max(...chunkAvgs) : avgShot;

  const transitionDist = distribution(allTransitions.map((t) => t.type));
  const transitionByContext = byContextTransitions(analyses);

  const sfxCounts = new Map<string, number>();
  for (const a of analyses) {
    for (const m of a.sfx_matches) {
      sfxCounts.set(m.sfx_filename, (sfxCounts.get(m.sfx_filename) ?? 0) + 1);
    }
  }
  const mostUsedSfx = [...sfxCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k]) => k);
  const sfxByContext = byContextSfx(analyses);

  const moodDistribution = distribution(audioMoods);
  const totalChangePoints = analyses.reduce(
    (sum, a) => sum + a.music.change_points.length,
    0,
  );
  const totalDurationMin =
    durations.reduce((a, b) => a + b, 0) / 60 || 1;

  const motionGraphicKindCounts: Record<string, number> = {};
  for (const a of analyses) {
    for (const mg of a.detected_motion_graphics) {
      motionGraphicKindCounts[mg.kind] =
        (motionGraphicKindCounts[mg.kind] ?? 0) + 1;
    }
  }

  // Examples picked across videos by emotional purpose.
  const examples = pickExamples(analyses);

  let synthesized;
  try {
    synthesized = await synthesize(
      {
        channelName: opts.channelName,
        channelSlug,
        videoCount: analyses.length,
        durations,
        beats: allBeats,
        transitions: allTransitions,
        styleSummaries: summaries,
        audioMoods,
      },
      new OpenRouterClient(),
    );
  } catch (e) {
    log.warn(`LLM synthesis failed: ${(e as Error).message}`);
    synthesized = fallbackSynthesis(allBeats, audioMoods);
  }

  const confidence = computeConfidence({
    videoCount: analyses.length,
    totalBeats,
    avgVisionConfidence:
      allBeats.length > 0
        ? allBeats.reduce((a, b) => a + b.vision_confidence, 0) / allBeats.length
        : 0,
  });

  const profile: ChannelStyleProfile = {
    schema_version: "1.0.0",
    channel_name: opts.channelName,
    channel_slug: channelSlug,
    channel_url: opts.channelUrl,
    niche: synthesized.niche,
    editing_mood: synthesized.editing_mood,
    generated_at: new Date().toISOString(),
    source_video_count: analyses.length,

    average_visual_change_seconds: avgShot,
    average_beat_duration: avgShot,

    asset_ratio_rules: assetRatios,

    pacing_rules: {
      average_shot_duration_seconds: avgShot,
      shot_duration_p25: percentile(allShotDurations, 0.25),
      shot_duration_p50: percentile(allShotDurations, 0.5),
      shot_duration_p75: percentile(allShotDurations, 0.75),
      fastest_section_avg: fastest,
      slowest_section_avg: slowest,
      notes:
        "Pacing varies across sections. Faster cuts cluster in reveal/scandal moments; slower beats are emotional reflection.",
    },

    intro_rules: synthesized.intro_rules,
    ending_rules: synthesized.ending_rules,

    image_treatment_rules: synthesized.image_treatment_rules,
    clip_treatment_rules: synthesized.clip_treatment_rules,
    headline_screenshot_rules: synthesized.headline_screenshot_rules,
    title_card_rules: synthesized.title_card_rules,
    lower_third_rules: synthesized.lower_third_rules,

    transition_rules: {
      distribution: transitionDist,
      by_context: transitionByContext,
      notes: synthesized.transition_rules_notes,
    },

    sfx_rules: {
      most_used: mostUsedSfx,
      by_context:
        Object.keys(synthesized.sfx_by_context ?? {}).length > 0
          ? synthesized.sfx_by_context
          : sfxByContext,
      notes: synthesized.sfx_rules_notes,
    },

    music_rules: {
      mood_distribution: moodDistribution,
      duck_under_narration: true,
      typical_change_points_per_minute: totalChangePoints / totalDurationMin,
      by_emotional_purpose: synthesized.music_by_emotional_purpose,
      notes: synthesized.music_rules_notes,
    },

    motion_graphic_rules: {
      kinds_used: motionGraphicKindCounts,
      when_to_use: synthesized.motion_graphic_when_to_use,
      notes: synthesized.motion_graphic_rules_notes,
    },

    emotional_editing_rules: synthesized.emotional_editing_rules,

    do_rules: synthesized.do_rules,
    avoid_rules: synthesized.avoid_rules,

    examples_from_reference_videos: examples,
    confidence_score: confidence,
  };

  const outPath = path.join(channelDir, "channel_style_profile.json");
  await writeJson(outPath, profile);
  log.info(`channel style profile written: ${outPath}`);

  return { profilePath: outPath, profile };
}

function byContextTransitions(
  analyses: VideoAnalysis[],
): Record<string, string[]> {
  // Map: emotional_purpose of beat starting at transition -> set of transition types
  const map: Record<string, Set<string>> = {};
  for (const a of analyses) {
    const beatByStart = new Map<number, Beat>();
    for (const b of a.beats) beatByStart.set(b.index, b);
    for (const t of a.transitions) {
      // Find the beat that starts near `t.at`
      const beat = a.beats.find(
        (b) => Math.abs(b.start_time - t.at) < 0.4,
      );
      const ctx = beat?.emotional_purpose ?? "unknown";
      if (!map[ctx]) map[ctx] = new Set();
      map[ctx]!.add(t.type);
    }
  }
  return Object.fromEntries(
    Object.entries(map).map(([k, set]) => [k, [...set].slice(0, 6)]),
  );
}

function byContextSfx(analyses: VideoAnalysis[]): Record<string, string[]> {
  const map: Record<string, Set<string>> = {};
  for (const a of analyses) {
    for (const s of a.sfx_matches) {
      const beat = a.beats.find(
        (b) => s.timestamp >= b.start_time && s.timestamp < b.end_time,
      );
      const ctx = beat?.emotional_purpose ?? "unknown";
      if (!map[ctx]) map[ctx] = new Set();
      map[ctx]!.add(s.sfx_filename);
    }
  }
  return Object.fromEntries(
    Object.entries(map).map(([k, set]) => [k, [...set].slice(0, 6)]),
  );
}

function pickExamples(
  analyses: VideoAnalysis[],
): ChannelStyleProfile["examples_from_reference_videos"] {
  const out: ChannelStyleProfile["examples_from_reference_videos"] = [];
  const wantedPurposes = new Set([
    "hook",
    "scandal",
    "reveal",
    "emotional_reflection",
    "timeline_explanation",
    "public_reaction",
    "ending",
  ]);
  const seen = new Set<string>();
  for (const a of analyses) {
    for (const b of a.beats) {
      if (!wantedPurposes.has(b.emotional_purpose)) continue;
      if (seen.has(b.emotional_purpose)) continue;
      seen.add(b.emotional_purpose);
      out.push({
        video_slug: a.video_slug,
        timestamp: b.start_time,
        illustrates: b.emotional_purpose,
        description: `${b.asset_type} / ${b.camera_motion} — ${b.visual_description.slice(0, 160)}`,
      });
      if (out.length >= 12) return out;
    }
  }
  return out;
}

function computeConfidence(args: {
  videoCount: number;
  totalBeats: number;
  avgVisionConfidence: number;
}): number {
  const v = Math.min(1, args.videoCount / 8); // 8+ videos → max video signal
  const b = Math.min(1, args.totalBeats / 600); // 600+ beats → max sample size
  const vis = Math.max(0, Math.min(1, args.avgVisionConfidence));
  // weighted geometric-ish blend
  return +(0.35 * v + 0.3 * b + 0.35 * vis).toFixed(3);
}

function fallbackSynthesis(beats: Beat[], audioMoods: string[]) {
  const dominantMood =
    [...new Set(audioMoods)].sort(
      (a, b) =>
        audioMoods.filter((m) => m === b).length -
        audioMoods.filter((m) => m === a).length,
    )[0] ?? "unknown";
  return {
    niche: "celebrity_documentary_youtube",
    editing_mood: dominantMood,
    intro_rules: {
      typical_duration_seconds: 12,
      hook_style: "unknown — insufficient signal",
      common_assets: [],
      transitions: [],
      sfx: [],
      music_mood: dominantMood,
      notes: "fallback — LLM synthesis unavailable",
    },
    ending_rules: {
      typical_duration_seconds: 10,
      cta_style: "unknown — insufficient signal",
      common_assets: [],
      music_mood: dominantMood,
      notes: "fallback — LLM synthesis unavailable",
    },
    image_treatment_rules: [],
    clip_treatment_rules: [],
    headline_screenshot_rules: [],
    title_card_rules: [],
    lower_third_rules: [],
    transition_rules_notes: "fallback",
    sfx_rules_notes: "fallback",
    sfx_by_context: {},
    music_rules_notes: "fallback",
    music_by_emotional_purpose: {},
    motion_graphic_rules_notes: "fallback",
    motion_graphic_when_to_use: {},
    emotional_editing_rules: [],
    do_rules: [],
    avoid_rules: [],
  };
}
