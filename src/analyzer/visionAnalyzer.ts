import pLimit from "p-limit";
import path from "node:path";
import fs from "node:fs/promises";
import { OpenRouterClient } from "../openrouter/client.js";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import type { BeatFrameRef } from "./frameExtractor.js";
import {
  AssetTypeSchema,
  CameraMotionSchema,
  EmotionalPurposeSchema,
} from "../schemas/videoAnalysis.js";
import { fileExists, readJson, writeJson, ensureDir } from "../utils/paths.js";

const log = createLogger("vision");

export interface BeatVision {
  sceneIndex: number;
  visual_description: string;
  asset_type: string;
  camera_motion: string;
  text_overlays: string[];
  title_card_text: string | null;
  lower_third_text: string | null;
  headline_text: string | null;
  has_motion_graphic: boolean;
  motion_graphic_kind: string | null;
  emotional_purpose: string;
  vision_confidence: number;
  notes: string;
}

const SYSTEM_PROMPT = `You are a YouTube documentary editing analyst.
You look at one or more frames sampled from a single editing beat in a
cashcow celebrity-documentary YouTube video (channels like SpillRumors).

For the given beat, return a SINGLE JSON object with this exact shape:

{
  "visual_description": "short factual description of what is shown",
  "asset_type": one of:
    "celebrity_photo", "event_photo", "interview_clip", "paparazzi_clip",
    "news_headline_screenshot", "social_media_screenshot",
    "animated_background", "title_card", "lower_third",
    "motion_graphic", "mixed_layout", "unknown",
  "camera_motion": one of:
    "slow_zoom_in", "slow_zoom_out", "pan_left", "pan_right", "push_in",
    "static", "blurred_background_fill", "split_screen", "framed_image",
    "unknown",
  "text_overlays": ["string", ...] -- only readable overlay text visible,
  "title_card_text": string | null -- text on a chapter/title card if any,
  "lower_third_text": string | null -- name/role/date if a lower-third is shown,
  "headline_text": string | null -- if a news headline screenshot is shown,
  "has_motion_graphic": boolean,
  "motion_graphic_kind": one of:
    "timeline", "relationship_map", "divorce_legal", "net_worth_money",
    "quote_card", "headline_card", "before_after", "public_reaction",
    "chart_graph", "other", null,
  "emotional_purpose": one of:
    "hook", "context", "setup", "betrayal", "scandal", "reveal",
    "emotional_reflection", "timeline_explanation", "public_reaction",
    "ending", "filler", "unknown",
  "vision_confidence": number 0..1,
  "notes": "any extra observation about cropping, framing, blur fill, etc."
}

Rules:
- Be strict and accurate. Prefer "unknown" over guessing.
- If multiple frames are shown, they are sequential samples of the SAME beat.
- "blurred_background_fill" describes the common style of a portrait-aspect
  image centered on a blurred enlarged copy of itself.
- A "lower_third" is a name/title/date label across the lower portion.
- A "title_card" is a full-screen card text moment, often a chapter break.
- Do NOT return any text outside the JSON object.`;

function userPromptFor(beat: BeatFrameRef, frameCount: number): string {
  return [
    `Beat sceneIndex=${beat.sceneIndex}.`,
    `${frameCount} frame(s) attached, sampled at: ${beat.timestamps
      .map((t) => t.toFixed(2))
      .join(", ")} seconds.`,
    `Return the JSON object specified by the system prompt.`,
  ].join("\n");
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  fallback: T,
): T {
  if (typeof value !== "string") return fallback;
  return (allowed as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : fallback;
}

function normalize(raw: unknown, sceneIndex: number): BeatVision {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const assetTypeValues = AssetTypeSchema.options;
  const cameraMotionValues = CameraMotionSchema.options;
  const emotionalPurposeValues = EmotionalPurposeSchema.options;

  return {
    sceneIndex,
    visual_description: String(obj.visual_description ?? ""),
    asset_type: normalizeEnum(obj.asset_type, assetTypeValues, "unknown"),
    camera_motion: normalizeEnum(
      obj.camera_motion,
      cameraMotionValues,
      "unknown",
    ),
    text_overlays: Array.isArray(obj.text_overlays)
      ? (obj.text_overlays as unknown[]).map((s) => String(s))
      : [],
    title_card_text:
      typeof obj.title_card_text === "string" ? obj.title_card_text : null,
    lower_third_text:
      typeof obj.lower_third_text === "string" ? obj.lower_third_text : null,
    headline_text:
      typeof obj.headline_text === "string" ? obj.headline_text : null,
    has_motion_graphic: Boolean(obj.has_motion_graphic),
    motion_graphic_kind:
      typeof obj.motion_graphic_kind === "string"
        ? obj.motion_graphic_kind
        : null,
    emotional_purpose: normalizeEnum(
      obj.emotional_purpose,
      emotionalPurposeValues,
      "unknown",
    ),
    vision_confidence:
      typeof obj.vision_confidence === "number"
        ? Math.max(0, Math.min(1, obj.vision_confidence))
        : 0.5,
    notes: String(obj.notes ?? ""),
  };
}

export async function analyzeBeatsWithVision(
  beats: BeatFrameRef[],
  cacheDir: string,
  client = new OpenRouterClient(),
): Promise<BeatVision[]> {
  await ensureDir(cacheDir);
  const limit = pLimit(config.tuning.visionConcurrency);

  const work = beats.map((beat) =>
    limit(async () => {
      const cache = path.join(cacheDir, `beat_${beat.sceneIndex.toString().padStart(5, "0")}.json`);
      if (await fileExists(cache)) {
        try {
          const cached = await readJson<BeatVision>(cache);
          return cached;
        } catch {
          // fall through and re-fetch
        }
      }
      try {
        const raw = await client.visionJson<unknown>(
          SYSTEM_PROMPT,
          userPromptFor(beat, beat.framePaths.length),
          beat.framePaths,
          { temperature: 0.1, maxTokens: 600 },
        );
        const v = normalize(raw, beat.sceneIndex);
        await writeJson(cache, v);
        return v;
      } catch (e) {
        log.warn(
          `vision failed for scene ${beat.sceneIndex}: ${(e as Error).message}`,
        );
        const fallback: BeatVision = normalize({}, beat.sceneIndex);
        fallback.notes = `vision_error: ${(e as Error).message.slice(0, 200)}`;
        fallback.vision_confidence = 0;
        // Don't cache failures.
        return fallback;
      }
    }),
  );

  return Promise.all(work);
}

/** Stand-alone helper: list cached beat files so we can resume after a crash. */
export async function listCachedBeatFiles(cacheDir: string): Promise<string[]> {
  try {
    const items = await fs.readdir(cacheDir);
    return items.filter((n) => n.startsWith("beat_") && n.endsWith(".json"));
  } catch {
    return [];
  }
}
