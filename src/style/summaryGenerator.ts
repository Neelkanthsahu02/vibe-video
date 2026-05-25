import type { VideoAnalysis } from "../schemas/videoAnalysis.js";

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, "0")}`;
}

function topN<T>(items: T[], key: (t: T) => string, n = 5): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

export async function generateStyleSummary(
  a: VideoAnalysis,
): Promise<string> {
  const beats = a.beats;
  const total = beats.length;
  const assetTop = topN(beats, (b) => b.asset_type, 6);
  const motionTop = topN(beats, (b) => b.camera_motion, 6);
  const emotionTop = topN(beats, (b) => b.emotional_purpose, 6);
  const transTop = topN(a.transitions, (t) => t.type, 8);

  const lines: string[] = [];
  lines.push(`# Style summary — ${a.video_slug}`);
  lines.push("");
  lines.push(`- Channel: \`${a.channel_slug}\``);
  lines.push(`- Source: \`${a.video_path}\``);
  lines.push(`- Generated: ${a.generated_at}`);
  lines.push("");
  lines.push("## Global");
  lines.push(
    `- Duration: ${a.global.duration.toFixed(1)}s | ${a.global.width}x${a.global.height} | ${a.global.fps.toFixed(2)} fps`,
  );
  lines.push(`- Codec: ${a.global.video_codec}${a.global.audio_codec ? " / " + a.global.audio_codec : ""}`);
  lines.push(`- Visual changes (cuts): ${a.global.total_visual_changes}`);
  lines.push(
    `- Avg shot: ${a.global.average_shot_duration.toFixed(2)}s | freq: ${a.global.average_visual_change_frequency_hz.toFixed(3)} Hz`,
  );
  lines.push(`- Overall mood (audio): ${a.global.overall_mood}`);
  lines.push(`- Intro: ${a.global.intro_pattern}`);
  lines.push(`- Ending: ${a.global.ending_pattern}`);
  lines.push("");

  lines.push("## Asset-type mix");
  for (const [k, v] of assetTop) {
    const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
    lines.push(`- ${k}: ${v} beats (${pct}%)`);
  }
  lines.push("");

  lines.push("## Camera motion mix");
  for (const [k, v] of motionTop) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");

  lines.push("## Emotional purpose mix");
  for (const [k, v] of emotionTop) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");

  lines.push("## Transitions (detected)");
  for (const [k, v] of transTop) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");

  lines.push("## Visual style rules");
  const rules = a.visual_style_rules;
  for (const [k, v] of Object.entries(rules)) {
    lines.push(`- **${k}**: ${v}`);
  }
  lines.push("");

  lines.push("## SFX matches (sample)");
  if (a.sfx_matches.length === 0) {
    lines.push("- none (no SFX pack supplied or no matches above threshold)");
  } else {
    for (const m of a.sfx_matches.slice(0, 15)) {
      lines.push(
        `- ${fmtTime(m.timestamp)} → \`${m.sfx_filename}\` (conf ${m.confidence.toFixed(2)})`,
      );
    }
  }
  lines.push("");

  lines.push("## Motion graphics");
  if (a.detected_motion_graphics.length === 0) {
    lines.push("- none detected");
  } else {
    for (const mg of a.detected_motion_graphics.slice(0, 15)) {
      lines.push(`- ${fmtTime(mg.at)} → ${mg.kind}: ${mg.description}`);
    }
  }
  lines.push("");

  lines.push("## Beat-by-beat (first 30)");
  for (const b of beats.slice(0, 30)) {
    lines.push(
      `- #${b.index} ${fmtTime(b.start_time)}–${fmtTime(b.end_time)} (${b.duration.toFixed(2)}s) — ${b.asset_type} / ${b.camera_motion} / ${b.emotional_purpose} — ${b.visual_description.slice(0, 120)}`,
    );
  }
  if (beats.length > 30) {
    lines.push(`- … ${beats.length - 30} more beats (see video_analysis.json)`);
  }

  return lines.join("\n");
}
