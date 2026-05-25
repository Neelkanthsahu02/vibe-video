import { OpenRouterClient } from "../openrouter/client.js";
import type { Beat, VideoAnalysis } from "../schemas/videoAnalysis.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("visual-rules");

const SYSTEM = `You distill an editor's visual style from a list of beats
extracted from a single YouTube documentary video.

Return EXACTLY this JSON object:

{
  "image_crop_style": "...",
  "zoom_pan_style": "...",
  "background_blur_usage": "...",
  "text_placement": "...",
  "title_card_design": "...",
  "lower_third_design": "...",
  "headline_card_design": "...",
  "motion_graphic_style": "...",
  "color_tone": "...",
  "brightness_contrast": "...",
  "saturation": "...",
  "pacing_style": "..."
}

Each value is a short concrete sentence. Base it ONLY on the beats given.
If you don't have enough data, say "unknown — insufficient signal".
Do not invent specifics that aren't observable. No prose outside the JSON.`;

function compactBeats(beats: Beat[]): string {
  const sample = beats.length > 80
    ? beats.filter((_, i) => i % Math.ceil(beats.length / 80) === 0).slice(0, 80)
    : beats;
  return sample
    .map((b) =>
      [
        `#${b.index}`,
        `t=${b.start_time.toFixed(1)}-${b.end_time.toFixed(1)}s`,
        `asset=${b.asset_type}`,
        `cam=${b.camera_motion}`,
        b.lower_third_text ? `lt="${b.lower_third_text.slice(0, 40)}"` : "",
        b.title_card_text ? `tc="${b.title_card_text.slice(0, 40)}"` : "",
        b.headline_text ? `hl="${b.headline_text.slice(0, 40)}"` : "",
        b.text_overlays.length > 0
          ? `ov="${b.text_overlays.join("|").slice(0, 60)}"`
          : "",
        b.notes ? `notes="${b.notes.slice(0, 60)}"` : "",
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
}

export async function extractVisualStyleRules(
  beats: Beat[],
  context: { width: number; height: number; overallMood: string },
  client = new OpenRouterClient(),
): Promise<VideoAnalysis["visual_style_rules"]> {
  const fallback: VideoAnalysis["visual_style_rules"] = {
    image_crop_style: "unknown — insufficient signal",
    zoom_pan_style: "unknown — insufficient signal",
    background_blur_usage: "unknown — insufficient signal",
    text_placement: "unknown — insufficient signal",
    title_card_design: "unknown — insufficient signal",
    lower_third_design: "unknown — insufficient signal",
    headline_card_design: "unknown — insufficient signal",
    motion_graphic_style: "unknown — insufficient signal",
    color_tone: "unknown — insufficient signal",
    brightness_contrast: "unknown — insufficient signal",
    saturation: "unknown — insufficient signal",
    pacing_style: "unknown — insufficient signal",
  };
  if (beats.length === 0) return fallback;
  try {
    const prompt = [
      `Video is ${context.width}x${context.height}, overall audio mood: ${context.overallMood}.`,
      `There are ${beats.length} beats. Beat summary:`,
      compactBeats(beats),
    ].join("\n");
    const rules = await client.chatJson<VideoAnalysis["visual_style_rules"]>(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      { temperature: 0.2, maxTokens: 700 },
    );
    return { ...fallback, ...rules };
  } catch (e) {
    log.warn(`visual style rule extraction failed: ${(e as Error).message}`);
    return fallback;
  }
}
