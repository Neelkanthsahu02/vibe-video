import path from "node:path";
import type { ChannelStyleProfile } from "../schemas/channelStyleProfile.js";
import type { ScenePlan } from "../schemas/scenePlan.js";
import type { SfxCue } from "../schemas/timeline.js";
import type { AssetPack } from "../assets/packLoader.js";
import { findByFilename, pickByKeywords } from "../assets/packLoader.js";

/**
 * For each beat, decide whether to fire an SFX based on the beat's
 * sfx_suggestion (from the planner) and/or the channel's sfx_rules.by_context
 * for the beat's emotional purpose. SFX fires at the beat's start_time.
 */
export function scheduleSfx(
  plan: ScenePlan,
  profile: ChannelStyleProfile,
  pack: AssetPack,
): SfxCue[] {
  if (pack.files.length === 0) return [];
  const cues: SfxCue[] = [];
  let lastSfxAt = -Infinity;
  const MIN_GAP = 0.6; // avoid stacking SFX too close

  for (const beat of plan.beats) {
    if (beat.start_time - lastSfxAt < MIN_GAP) continue;
    const contextList = profile.sfx_rules.by_context?.[beat.script_function];
    let chosenPath: string | null = null;
    let sourceRule: string | null = null;

    // 1. planner's literal sfx_suggestion (filename in style-library most_used)
    if (beat.sfx_suggestion) {
      chosenPath = findByFilename(pack, beat.sfx_suggestion);
      if (chosenPath) {
        sourceRule = `beat.sfx_suggestion="${beat.sfx_suggestion}"`;
      }
    }
    // 2. by_context list
    if (!chosenPath && contextList && contextList.length > 0) {
      for (const name of contextList) {
        const p = findByFilename(pack, name);
        if (p) {
          chosenPath = p;
          sourceRule = `sfx_rules.by_context.${beat.script_function}="${name}"`;
          break;
        }
      }
    }
    // 3. most_used (any)
    if (!chosenPath && profile.sfx_rules.most_used?.length) {
      for (const name of profile.sfx_rules.most_used) {
        const p = findByFilename(pack, name);
        if (p) {
          chosenPath = p;
          sourceRule = `sfx_rules.most_used="${name}"`;
          break;
        }
      }
    }
    // 4. keyword fallback
    if (!chosenPath) {
      chosenPath = pickByKeywords(pack, [beat.script_function, beat.emotional_tone]);
      if (chosenPath) sourceRule = "keyword_fallback";
    }
    if (!chosenPath) continue;

    cues.push({
      path: chosenPath,
      at_seconds: beat.start_time,
      gain: 0.8,
      source_rule: sourceRule,
      scene_id: beat.scene_id,
    });
    lastSfxAt = beat.start_time;
  }
  void path;
  return cues;
}
