import pLimit from "p-limit";
import path from "node:path";
import { OpenRouterClient } from "../openrouter/client.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/paths.js";
import type { RawBeat } from "./beatSegmenter.js";
import type { ChannelStyleProfile } from "../schemas/channelStyleProfile.js";
import type { ScenePlanBeat } from "../schemas/scenePlan.js";
import {
  AssetTypeSchema,
  CameraMotionSchema,
  MusicMoodSchema,
  TransitionTypeSchema,
} from "../schemas/videoAnalysis.js";
import {
  EmotionalToneSchema,
  ScriptFunctionSchema,
  SuggestedVisualLayoutSchema,
} from "../schemas/scenePlan.js";

const log = createLogger("beat-planner");

const SYSTEM = `You plan the visual editing of a single beat in a YouTube
celebrity-documentary video for the channel described in the supplied
"channel_style_profile". You MUST follow the channel's style — do not invent
a different style. Cite the specific rule you applied in "style_library_rule_used".

For each beat, return a JSON object with EXACTLY this shape:

{
  "beat_summary": "1-sentence summary of what this beat is about",
  "emotional_tone": one of:
    "neutral","curious","tense","sad","angry","shocked","hopeful",
    "ominous","uplifting","reflective","unknown",
  "script_function": one of:
    "intro","context","setup","betrayal","scandal","reveal",
    "emotional_reflection","timeline_explanation","public_reaction","ending",
  "visual_goal": "what the viewer should see/feel during this beat",
  "asset_type_needed": one of:
    "celebrity_photo","event_photo","interview_clip","paparazzi_clip",
    "news_headline_screenshot","social_media_screenshot",
    "animated_background","title_card","lower_third","motion_graphic",
    "mixed_layout","unknown",
  "image_search_queries": [3-5 concrete Brave-image-search queries],
  "youtube_clip_search_queries": [2-4 concrete YouTube search queries],
  "headline_search_queries": [0-3 news-headline search queries],
  "suggested_visual_layout": one of:
    "fullscreen_image","fullscreen_clip","blurred_fill_portrait",
    "split_screen","framed_inset","headline_card","title_card",
    "lower_third_over_clip","motion_graphic_only","stacked_quote_card",
    "ken_burns_image","unknown",
  "camera_motion": one of:
    "slow_zoom_in","slow_zoom_out","pan_left","pan_right","push_in",
    "static","blurred_background_fill","split_screen","framed_image","unknown",
  "overlay_text": string | null  (short on-screen text, keep under ~6 words),
  "lower_third_text": string | null  (name/role/date if appropriate),
  "title_card_text": string | null  (only for chapter / reveal moments),
  "motion_graphic_instruction": string | null  (only when the style library says so),
  "transition_in": one of:
    "hard_cut","flash","fade_to_black","fade_from_black","fade_to_white",
    "fade_from_white","zoom_blur","motion_blur","wipe","glitch",
    "light_leak","dissolve","overlay","unknown",
  "transition_out": same enum as transition_in,
  "sfx_suggestion": string | null  (use names that appear in style_library sfx_rules.most_used when possible),
  "music_mood": one of:
    "sad_emotional","tense_documentary","neutral_narrative","energetic_reveal",
    "uplifting","dark_scandal","unknown",
  "editing_notes": "short note on cropping / pacing / why",
  "style_library_rule_used": "Quote/cite the specific rule key + value from channel_style_profile you followed"
}

Rules:
- Use ONLY assets, transitions, motion-graphic kinds, sfx and music moods
  that match the channel's profile distribution. Prefer the channel's most-used
  items unless the moment specifically calls for an outlier.
- For "image_search_queries", include the person's name, the event, and the
  emotional valence. Avoid generic queries like "celebrity sad".
- Output ONLY the JSON object. No prose, no markdown fences.`;

interface PlannerContext {
  profile: ChannelStyleProfile;
  totalBeats: number;
  voiceoverDuration: number;
}

function compactProfile(profile: ChannelStyleProfile): string {
  return JSON.stringify({
    channel: profile.channel_name,
    niche: profile.niche,
    editing_mood: profile.editing_mood,
    pacing: profile.pacing_rules,
    asset_ratios: profile.asset_ratio_rules,
    intro_rules: profile.intro_rules,
    ending_rules: profile.ending_rules,
    transition_distribution: profile.transition_rules.distribution,
    transition_by_context: profile.transition_rules.by_context,
    sfx_most_used: profile.sfx_rules.most_used,
    sfx_by_context: profile.sfx_rules.by_context,
    music_mood_distribution: profile.music_rules.mood_distribution,
    music_by_emotional_purpose: profile.music_rules.by_emotional_purpose,
    motion_graphic_kinds_used: profile.motion_graphic_rules.kinds_used,
    motion_graphic_when_to_use: profile.motion_graphic_rules.when_to_use,
    emotional_editing_rules: profile.emotional_editing_rules,
    image_treatment_rules: profile.image_treatment_rules,
    clip_treatment_rules: profile.clip_treatment_rules,
    title_card_rules: profile.title_card_rules,
    lower_third_rules: profile.lower_third_rules,
    headline_screenshot_rules: profile.headline_screenshot_rules,
    do_rules: profile.do_rules,
    avoid_rules: profile.avoid_rules,
  });
}

function userPromptFor(
  beat: RawBeat,
  ctx: PlannerContext,
  prevBeatText: string | null,
  nextBeatText: string | null,
): string {
  return [
    `Channel style profile (truncated): ${compactProfile(ctx.profile)}`,
    "",
    `Beat ${beat.index + 1}/${ctx.totalBeats}, position_ratio=${beat.position_ratio.toFixed(2)},`,
    `duration=${beat.duration.toFixed(2)}s, words=${beat.word_count}.`,
    `Previous beat: ${prevBeatText ?? "(none — this is the opening beat)"}`,
    `This beat narration: """${beat.narration_text}"""`,
    `Next beat: ${nextBeatText ?? "(none — this is the closing beat)"}`,
    "",
    "Return the JSON object for THIS beat only.",
  ].join("\n");
}

function safeEnum<T extends string>(
  v: unknown,
  values: ReadonlyArray<T>,
  fallback: T,
): T {
  return typeof v === "string" && (values as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

function toStringArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === "string" && x.trim().length > 0)
    .map((x) => String(x))
    .slice(0, max);
}

function normalize(raw: unknown, beat: RawBeat): ScenePlanBeat {
  const o = (raw ?? {}) as Record<string, unknown>;
  const sceneId = `scene_${beat.index.toString().padStart(4, "0")}`;
  return {
    scene_id: sceneId,
    index: beat.index,
    start_time: beat.start_time,
    end_time: beat.end_time,
    duration: beat.duration,
    narration_text: beat.narration_text,
    beat_summary: String(o.beat_summary ?? beat.narration_text.slice(0, 100)),
    emotional_tone: safeEnum(
      o.emotional_tone,
      EmotionalToneSchema.options,
      "unknown",
    ),
    script_function: safeEnum(
      o.script_function,
      ScriptFunctionSchema.options,
      "context",
    ),
    visual_goal: String(o.visual_goal ?? ""),
    asset_type_needed: safeEnum(
      o.asset_type_needed,
      AssetTypeSchema.options,
      "unknown",
    ),
    image_search_queries: toStringArray(o.image_search_queries, 5),
    youtube_clip_search_queries: toStringArray(o.youtube_clip_search_queries, 4),
    headline_search_queries: toStringArray(o.headline_search_queries, 3),
    suggested_visual_layout: safeEnum(
      o.suggested_visual_layout,
      SuggestedVisualLayoutSchema.options,
      "fullscreen_image",
    ),
    camera_motion: safeEnum(
      o.camera_motion,
      CameraMotionSchema.options,
      "static",
    ),
    overlay_text: typeof o.overlay_text === "string" ? o.overlay_text : null,
    lower_third_text:
      typeof o.lower_third_text === "string" ? o.lower_third_text : null,
    title_card_text:
      typeof o.title_card_text === "string" ? o.title_card_text : null,
    motion_graphic_instruction:
      typeof o.motion_graphic_instruction === "string"
        ? o.motion_graphic_instruction
        : null,
    transition_in: safeEnum(
      o.transition_in,
      TransitionTypeSchema.options,
      "hard_cut",
    ),
    transition_out: safeEnum(
      o.transition_out,
      TransitionTypeSchema.options,
      "hard_cut",
    ),
    sfx_suggestion:
      typeof o.sfx_suggestion === "string" ? o.sfx_suggestion : null,
    music_mood: safeEnum(o.music_mood, MusicMoodSchema.options, "unknown"),
    editing_notes: String(o.editing_notes ?? ""),
    style_library_rule_used: String(
      o.style_library_rule_used ?? "(no rule cited)",
    ),
    alignment_confidence: beat.alignment_confidence,
  };
}

export async function planBeats(
  beats: RawBeat[],
  profile: ChannelStyleProfile,
  voiceoverDuration: number,
  cacheDir: string,
  client = new OpenRouterClient(),
): Promise<ScenePlanBeat[]> {
  await ensureDir(cacheDir);
  const ctx: PlannerContext = {
    profile,
    totalBeats: beats.length,
    voiceoverDuration,
  };
  const limit = pLimit(Math.max(1, config.tuning.visionConcurrency));

  const work = beats.map((beat, i) =>
    limit(async () => {
      const cache = path.join(
        cacheDir,
        `beat_${beat.index.toString().padStart(4, "0")}.json`,
      );
      if (await fileExists(cache)) {
        try {
          return await readJson<ScenePlanBeat>(cache);
        } catch {
          /* fall through */
        }
      }
      const prev = i > 0 ? beats[i - 1]!.narration_text : null;
      const next = i < beats.length - 1 ? beats[i + 1]!.narration_text : null;
      try {
        const raw = await client.chatJson<unknown>(
          [
            { role: "system", content: SYSTEM },
            { role: "user", content: userPromptFor(beat, ctx, prev, next) },
          ],
          {
            model: config.openrouter.reasoningModel,
            temperature: 0.3,
            maxTokens: 1200,
          },
        );
        const planned = normalize(raw, beat);
        await writeJson(cache, planned);
        return planned;
      } catch (e) {
        log.warn(
          `beat planner failed for beat ${beat.index}: ${(e as Error).message}`,
        );
        return fallbackBeat(beat, profile);
      }
    }),
  );

  return Promise.all(work);
}

function fallbackBeat(
  beat: RawBeat,
  profile: ChannelStyleProfile,
): ScenePlanBeat {
  const sceneId = `scene_${beat.index.toString().padStart(4, "0")}`;
  const dominantMusic = topKey(profile.music_rules.mood_distribution);
  const isIntro = beat.position_ratio < 0.05;
  const isEnding = beat.position_ratio > 0.95;
  return {
    scene_id: sceneId,
    index: beat.index,
    start_time: beat.start_time,
    end_time: beat.end_time,
    duration: beat.duration,
    narration_text: beat.narration_text,
    beat_summary: beat.narration_text.slice(0, 120),
    emotional_tone: "unknown",
    script_function: isIntro ? "intro" : isEnding ? "ending" : "context",
    visual_goal: "unknown — LLM planner failed",
    asset_type_needed: "celebrity_photo",
    image_search_queries: [],
    youtube_clip_search_queries: [],
    headline_search_queries: [],
    suggested_visual_layout: "fullscreen_image",
    camera_motion: "slow_zoom_in",
    overlay_text: null,
    lower_third_text: null,
    title_card_text: null,
    motion_graphic_instruction: null,
    transition_in: "hard_cut",
    transition_out: "hard_cut",
    sfx_suggestion: null,
    music_mood: safeMood(dominantMusic),
    editing_notes: "fallback — planner unavailable",
    style_library_rule_used: "fallback",
    alignment_confidence: beat.alignment_confidence,
  };
}

function safeMood(s: string): ScenePlanBeat["music_mood"] {
  const allowed = MusicMoodSchema.options as readonly string[];
  return allowed.includes(s) ? (s as ScenePlanBeat["music_mood"]) : "unknown";
}

function topKey(dist: Record<string, number>): string {
  let bestK = "unknown";
  let bestV = -Infinity;
  for (const [k, v] of Object.entries(dist)) {
    if (v > bestV) {
      bestV = v;
      bestK = k;
    }
  }
  return bestK;
}
