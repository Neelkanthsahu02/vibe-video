/* Vision pass per beat. Emits the new beat schema fields:
 *   visual_description, asset_type, camera_motion, layout_type,
 *   text_overlay { present, ... }, lower_third { present, ... },
 *   title_card { present, ... }, motion_graphic { present, ... },
 *   story_function, emotional_tone, editing_purpose, confidence. */
import path from "node:path";
import pLimit from "p-limit";
import { OpenRouterClient } from "../../integrations/openrouter/src/index.js";
import { config } from "../../core/src/config.js";
import { createLogger } from "../../utils/src/logger.js";
import { ensureDir, fileExists, readJson, writeJson } from "../../utils/src/paths.js";

const log = createLogger("beat-vision");

export interface BeatVisionInput {
  sceneIndex: number;
  framePaths: string[];
  timestamps: number[];
  transcript: string;
  prevTranscript: string | null;
  nextTranscript: string | null;
  scenePosition: "intro" | "middle" | "ending";
}

export interface BeatVisionOutput {
  sceneIndex: number;
  visual_description: string;
  asset_type: string;
  camera_motion: string;
  layout_type: string;
  text_overlay: {
    present: boolean;
    text: string;
    placement: string;
    style_notes: string;
  };
  lower_third: {
    present: boolean;
    text: string;
    style_notes: string;
  };
  title_card: {
    present: boolean;
    text: string;
    style_notes: string;
  };
  motion_graphic: {
    present: boolean;
    type: string;
    purpose: string;
    style_notes: string;
  };
  story_function: string;
  emotional_tone: string;
  editing_purpose: string;
  confidence: number;
}

const SYSTEM = `You are a senior editor analysing a single editing beat in a
YouTube celebrity / documentary / gossip video. You are given the narration
that plays during this beat and one or more frames sampled from inside it.

Return EXACTLY this JSON object — no prose, no markdown fences:

{
  "visual_description": "1 short factual sentence — what is shown",
  "asset_type": one of:
    "celebrity_photo","event_photo","interview_clip","paparazzi_clip",
    "news_headline_screenshot","social_media_screenshot","title_card",
    "lower_third","motion_graphic","animated_background","mixed_layout",
    "unknown",
  "camera_motion": one of:
    "slow_zoom_in","slow_zoom_out","pan_left","pan_right","push_in",
    "static","blurred_background_fill","split_screen","framed_image","unknown",
  "layout_type": one short phrase describing the layout (e.g.
    "centered_portrait_with_blur_fill", "split_left_right",
    "headline_with_image_above"),
  "text_overlay": {
    "present": boolean,
    "text": "the readable overlay text or empty string",
    "placement": "top|center|bottom|left|right|caption",
    "style_notes": "1 short phrase about font/colour/animation"
  },
  "lower_third": {
    "present": boolean,
    "text": "the visible name/role/date or empty string",
    "style_notes": "1 short phrase"
  },
  "title_card": {
    "present": boolean,
    "text": "title text or empty string",
    "style_notes": "1 short phrase"
  },
  "motion_graphic": {
    "present": boolean,
    "type": "timeline|relationship_map|net_worth|quote_card|chart|public_reaction|other",
    "purpose": "1 short phrase",
    "style_notes": "1 short phrase"
  },
  "story_function": one of:
    "intro","context","setup","betrayal","scandal","reveal",
    "emotional_reflection","timeline_explanation","public_reaction",
    "ending","filler","unknown",
  "emotional_tone": one of:
    "neutral","curious","tense","sad","angry","shocked","hopeful",
    "ominous","uplifting","reflective","unknown",
  "editing_purpose": "1 short phrase describing why this beat exists",
  "confidence": 0..1
}

Rules:
- Prefer "unknown" over guessing.
- "present" must be true ONLY if the element is clearly visible.
- "scene_position" hint: when frames sit at the very start of the video,
  prefer story_function="intro"; at the very end, prefer "ending".
- The narration is authoritative for what the beat is *about*; the frames
  show how it's edited.`;

function userPrompt(input: BeatVisionInput): string {
  return [
    `Beat sceneIndex=${input.sceneIndex} position=${input.scenePosition}`,
    `Narration during this beat: """${input.transcript || "(silence)"}"""`,
    `Previous beat narration: ${input.prevTranscript ?? "(none — first beat)"}`,
    `Next beat narration: ${input.nextTranscript ?? "(none — last beat)"}`,
    `Frames sampled at: ${input.timestamps
      .map((t) => `${t.toFixed(2)}s`)
      .join(", ")}.`,
    "Return the JSON object specified by the system prompt.",
  ].join("\n");
}

const ASSET_TYPES = [
  "celebrity_photo","event_photo","interview_clip","paparazzi_clip",
  "news_headline_screenshot","social_media_screenshot","title_card",
  "lower_third","motion_graphic","animated_background","mixed_layout","unknown",
] as const;
const CAMERA_MOTIONS = [
  "slow_zoom_in","slow_zoom_out","pan_left","pan_right","push_in",
  "static","blurred_background_fill","split_screen","framed_image","unknown",
] as const;
const STORY_FUNCTIONS = [
  "intro","context","setup","betrayal","scandal","reveal",
  "emotional_reflection","timeline_explanation","public_reaction",
  "ending","filler","unknown",
] as const;
const TONES = [
  "neutral","curious","tense","sad","angry","shocked","hopeful",
  "ominous","uplifting","reflective","unknown",
] as const;
const MG_TYPES = [
  "timeline","relationship_map","net_worth","quote_card","chart",
  "public_reaction","other",
] as const;

function safeEnum<T extends string>(
  v: unknown,
  values: ReadonlyArray<T>,
  fb: T,
): T {
  return typeof v === "string" && (values as readonly string[]).includes(v)
    ? (v as T)
    : fb;
}

function safe01(v: unknown, fb = 0.5): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fb;
  return Math.max(0, Math.min(1, v));
}

function normalize(raw: unknown, sceneIndex: number): BeatVisionOutput {
  const o = (raw ?? {}) as Record<string, unknown>;
  const to = (o.text_overlay ?? {}) as Record<string, unknown>;
  const lt = (o.lower_third ?? {}) as Record<string, unknown>;
  const tc = (o.title_card ?? {}) as Record<string, unknown>;
  const mg = (o.motion_graphic ?? {}) as Record<string, unknown>;
  return {
    sceneIndex,
    visual_description: String(o.visual_description ?? ""),
    asset_type: safeEnum(o.asset_type, ASSET_TYPES, "unknown"),
    camera_motion: safeEnum(o.camera_motion, CAMERA_MOTIONS, "unknown"),
    layout_type: String(o.layout_type ?? ""),
    text_overlay: {
      present: Boolean(to.present),
      text: String(to.text ?? ""),
      placement: String(to.placement ?? ""),
      style_notes: String(to.style_notes ?? ""),
    },
    lower_third: {
      present: Boolean(lt.present),
      text: String(lt.text ?? ""),
      style_notes: String(lt.style_notes ?? ""),
    },
    title_card: {
      present: Boolean(tc.present),
      text: String(tc.text ?? ""),
      style_notes: String(tc.style_notes ?? ""),
    },
    motion_graphic: {
      present: Boolean(mg.present),
      type: safeEnum(mg.type, MG_TYPES, "other"),
      purpose: String(mg.purpose ?? ""),
      style_notes: String(mg.style_notes ?? ""),
    },
    story_function: safeEnum(o.story_function, STORY_FUNCTIONS, "unknown"),
    emotional_tone: safeEnum(o.emotional_tone, TONES, "unknown"),
    editing_purpose: String(o.editing_purpose ?? ""),
    confidence: safe01(o.confidence, 0.5),
  };
}

export async function analyzeBeatsWithVision(
  inputs: BeatVisionInput[],
  cacheDir: string,
  client = new OpenRouterClient(),
): Promise<BeatVisionOutput[]> {
  await ensureDir(cacheDir);
  const limit = pLimit(config.tuning.visionConcurrency);
  return Promise.all(
    inputs.map((input) =>
      limit(async () => {
        const cache = path.join(
          cacheDir,
          `beat_${input.sceneIndex.toString().padStart(5, "0")}.json`,
        );
        if (await fileExists(cache)) {
          try {
            return await readJson<BeatVisionOutput>(cache);
          } catch {
            /* fall through */
          }
        }
        try {
          const raw = await client.visionJson<unknown>(
            SYSTEM,
            userPrompt(input),
            input.framePaths,
            { temperature: 0.1, maxTokens: 900 },
          );
          const out = normalize(raw, input.sceneIndex);
          await writeJson(cache, out);
          return out;
        } catch (e) {
          log.warn(
            `vision failed scene=${input.sceneIndex}: ${(e as Error).message}`,
          );
          return normalize({}, input.sceneIndex);
        }
      }),
    ),
  );
}
