import path from "node:path";
import type { ChannelStyleProfile } from "../schemas/channelStyleProfile.js";
import type { ScenePlan } from "../schemas/scenePlan.js";
import type { MusicCue } from "../schemas/timeline.js";
import type { AssetPack } from "../assets/packLoader.js";

/**
 * Group consecutive beats whose music_mood is the same into music "arcs",
 * then assign one music file per arc from the pack. Files are picked by
 * filename keyword match against the mood label.
 */
export function scheduleMusic(
  plan: ScenePlan,
  profile: ChannelStyleProfile,
  pack: AssetPack,
): MusicCue[] {
  if (pack.files.length === 0) return [];
  const arcs: Array<{ mood: string; start: number; end: number }> = [];
  for (const beat of plan.beats) {
    const mood = beat.music_mood || "unknown";
    const last = arcs[arcs.length - 1];
    if (last && last.mood === mood) {
      last.end = beat.end_time;
    } else {
      arcs.push({ mood, start: beat.start_time, end: beat.end_time });
    }
  }

  // Avoid using the same music file back-to-back when possible
  const used: string[] = [];
  const cues: MusicCue[] = [];
  for (const arc of arcs) {
    const picked = pickMusicForMood(arc.mood, pack, used);
    if (!picked) continue;
    used.push(picked);
    cues.push({
      path: picked,
      start_seconds: arc.start,
      duration_seconds: Math.max(0, arc.end - arc.start),
      mood: arc.mood,
      gain: 0.6,
      duck_gain: 0.15,
      fade_in_seconds: 1.2,
      fade_out_seconds: 1.8,
    });
  }
  // Music ducks under narration by default; the duck windows are computed
  // from the script alignment in the builder.
  void profile;
  return cues;
}

function pickMusicForMood(
  mood: string,
  pack: AssetPack,
  recentlyUsed: string[],
): string | null {
  if (pack.files.length === 0) return null;
  const moodKeywords = MOOD_KEYWORDS[mood] ?? [mood];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const recents = new Set(recentlyUsed.slice(-2));

  let best: { path: string; score: number } | null = null;
  for (const f of pack.files) {
    const haystack = norm(path.basename(f));
    let score = 0;
    for (const k of moodKeywords) {
      if (haystack.includes(k)) score += 1;
    }
    if (recents.has(f)) score -= 0.5;
    if (!best || score > best.score) best = { path: f, score };
  }
  // If nothing matched (score 0) pick a deterministic fallback
  if (!best || best.score <= 0) return pack.files[0] ?? null;
  return best.path;
}

const MOOD_KEYWORDS: Record<string, string[]> = {
  sad_emotional: ["sad", "emotional", "melancholy", "piano", "mourn"],
  tense_documentary: ["tense", "doc", "suspense", "mystery", "investigation"],
  neutral_narrative: ["narrative", "neutral", "underscore", "ambient"],
  energetic_reveal: ["energetic", "reveal", "uplift", "drive"],
  uplifting: ["uplift", "hope", "warm", "inspire"],
  dark_scandal: ["dark", "scandal", "ominous", "drama", "betrayal"],
  unknown: ["under", "neutral", "ambient"],
};
