import type { RawScene } from "./sceneDetector.js";
import type { BeatVision } from "./visionAnalyzer.js";
import type { RawTransitionResult } from "./transitionDetector.js";
import { normalizeTransitionType } from "./transitionDetector.js";
import type { AudioAnalysisResult } from "./audioAnalyzer.js";
import type { Beat, TransitionEvent } from "../schemas/videoAnalysis.js";
import {
  AssetTypeSchema,
  CameraMotionSchema,
  EmotionalPurposeSchema,
  MusicMoodSchema,
} from "../schemas/videoAnalysis.js";

function lookupIntensity(
  curve: AudioAnalysisResult["intensity_curve"],
  t: number,
): number {
  if (curve.length === 0) return 0;
  // Binary search would be nice — but curves are short (1Hz).
  let last = curve[0]!.intensity;
  for (const sample of curve) {
    if (sample.t > t) break;
    last = sample.intensity;
  }
  return last;
}

function asAssetType(v: string): Beat["asset_type"] {
  return (AssetTypeSchema.options as readonly string[]).includes(v)
    ? (v as Beat["asset_type"])
    : "unknown";
}
function asCameraMotion(v: string): Beat["camera_motion"] {
  return (CameraMotionSchema.options as readonly string[]).includes(v)
    ? (v as Beat["camera_motion"])
    : "unknown";
}
function asEmotional(v: string): Beat["emotional_purpose"] {
  return (EmotionalPurposeSchema.options as readonly string[]).includes(v)
    ? (v as Beat["emotional_purpose"])
    : "unknown";
}
function asMusicMood(v: string): Beat["music_mood"] {
  return (MusicMoodSchema.options as readonly string[]).includes(v)
    ? (v as Beat["music_mood"])
    : "unknown";
}

/**
 * Build the per-beat list and the per-cut transition events from the raw
 * analysis inputs.
 */
export function buildBeats(
  scenes: RawScene[],
  visions: BeatVision[],
  transitions: RawTransitionResult,
  audio: AudioAnalysisResult,
): { beats: Beat[]; transitionEvents: TransitionEvent[] } {
  const visionBySceneIndex = new Map<number, BeatVision>();
  for (const v of visions) visionBySceneIndex.set(v.sceneIndex, v);

  const transitionEvents: TransitionEvent[] = transitions.transitions.map(
    (t) => ({
      at: t.at,
      type: normalizeTransitionType(t.type),
      duration_frames: t.duration_frames,
      confidence: t.confidence,
      reason: t.reason,
      matched_asset: null,
    }),
  );

  const transitionByScene = new Map<number, TransitionEvent>();
  for (let i = 0; i < transitions.transitions.length; i++) {
    const raw = transitions.transitions[i]!;
    transitionByScene.set(raw.scene_index, transitionEvents[i]!);
  }

  const beats: Beat[] = scenes.map((scene, idx) => {
    const v = visionBySceneIndex.get(scene.index);
    const transitionIn = transitionByScene.get(scene.index);
    const nextScene = scenes[idx + 1];
    const transitionOut = nextScene
      ? transitionByScene.get(nextScene.index)
      : undefined;
    const midpoint = scene.start + scene.duration / 2;

    return {
      index: scene.index,
      start_time: scene.start,
      end_time: scene.end,
      duration: scene.duration,
      visual_description: v?.visual_description ?? "",
      asset_type: asAssetType(v?.asset_type ?? "unknown"),
      camera_motion: asCameraMotion(v?.camera_motion ?? "unknown"),
      text_overlays: v?.text_overlays ?? [],
      title_card_text: v?.title_card_text ?? null,
      lower_third_text: v?.lower_third_text ?? null,
      headline_text: v?.headline_text ?? null,
      transition_in: transitionIn?.type ?? (idx === 0 ? "unknown" : "hard_cut"),
      transition_out: transitionOut?.type ?? "unknown",
      likely_sfx: [],
      music_mood: asMusicMood(audio.mood_guess),
      music_intensity: lookupIntensity(audio.intensity_curve, midpoint),
      emotional_purpose: asEmotional(v?.emotional_purpose ?? "unknown"),
      vision_confidence: v?.vision_confidence ?? 0,
      notes: v?.notes ?? "",
    };
  });

  return { beats, transitionEvents };
}

/** Attach SFX matches to the nearest beat by timestamp. */
export function attachSfxToBeats(
  beats: Beat[],
  sfx: Array<{ sfx_filename: string; timestamp: number; confidence: number }>,
): void {
  for (const s of sfx) {
    const beat = beats.find(
      (b) => s.timestamp >= b.start_time && s.timestamp < b.end_time,
    );
    if (beat) {
      beat.likely_sfx.push(
        `${s.sfx_filename}@${s.timestamp.toFixed(2)}s (conf ${s.confidence.toFixed(2)})`,
      );
    }
  }
}
