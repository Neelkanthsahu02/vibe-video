import path from "node:path";
import { createLogger } from "../utils/logger.js";
import { fileExists, writeJson } from "../utils/paths.js";
import { checkBinaries } from "../utils/ffmpeg.js";
import { OpenRouterClient } from "../openrouter/client.js";
import { config } from "../config.js";
import {
  resolveProjectPaths,
  loadStyleProfile,
  readScript,
} from "./projectIO.js";
import { transcribeVoiceover } from "./transcriber.js";
import { alignScriptToWhisper } from "./scriptAligner.js";
import { segmentIntoBeats } from "./beatSegmenter.js";
import { planBeats } from "./beatPlanner.js";
import type { ScenePlan, ScenePlanBeat } from "../schemas/scenePlan.js";
import type { ChannelStyleProfile } from "../schemas/channelStyleProfile.js";
import { slugify } from "../utils/paths.js";

const log = createLogger("plan");

export interface PlanSceneOptions {
  projectName: string;
  channelName: string;
  channelSlug?: string;
  scriptPath?: string;
  voiceoverPath?: string;
  whisperModel?: string;
  whisperDevice?: string;
  whisperCompute?: string;
  language?: string;
  /** Override pacing target (seconds per beat). Default: profile value. */
  pacingTargetSeconds?: number;
  force?: boolean;
}

export interface PlanSceneResult {
  scenePlanPath: string;
  transcriptPath: string;
  alignmentPath: string;
  plan: ScenePlan;
}

export async function planScenes(
  opts: PlanSceneOptions,
): Promise<PlanSceneResult> {
  const channelSlug = opts.channelSlug ?? slugify(opts.channelName);
  const { profilePath, profile } = await loadStyleProfile(channelSlug);
  const paths = await resolveProjectPaths(opts.projectName, {
    scriptPath: opts.scriptPath,
    voiceoverPath: opts.voiceoverPath,
  });

  if (!(await fileExists(paths.voiceoverPath))) {
    throw new Error(
      `voiceover not found at ${paths.voiceoverPath}. Place a voiceover.wav/mp3 in ${paths.inputDir} or pass --voiceover.`,
    );
  }
  const bins = await checkBinaries();
  if (!bins.python) {
    throw new Error(
      "python3 missing — required for faster-whisper transcription.",
    );
  }

  // 1. Transcribe
  log.info(`transcribing voiceover ${paths.voiceoverPath}`);
  const transcript = await transcribeVoiceover(
    paths.voiceoverPath,
    paths.transcriptJson,
    {
      model: opts.whisperModel,
      device: opts.whisperDevice,
      computeType: opts.whisperCompute,
      language: opts.language,
    },
  );
  log.info(
    `transcript: ${transcript.words.length} words, ${transcript.duration.toFixed(1)}s, lang=${transcript.language}`,
  );

  // 2. Align canonical script to transcript timestamps
  const script = await readScript(paths.scriptPath);
  const alignment = alignScriptToWhisper(script, transcript);
  await writeJson(paths.alignmentJson, alignment);
  log.info(
    `aligned ${alignment.totalMatched}/${alignment.totalScriptWords} script words (rate ${(alignment.matchRate * 100).toFixed(1)}%)`,
  );

  // 3. Segment into beats per pacing target
  const pacingTarget =
    opts.pacingTargetSeconds ?? profile.average_visual_change_seconds ?? 3.5;
  const rawBeats = segmentIntoBeats(alignment, {
    pacingTargetSeconds: pacingTarget,
  });
  log.info(
    `${rawBeats.length} beats @ pacing target ${pacingTarget.toFixed(2)}s`,
  );

  // 4. LLM enrich each beat
  const cacheDir = path.join(paths.cacheDir, "beat_plans");
  const plannedBeats = await planBeats(
    rawBeats,
    profile,
    transcript.duration,
    cacheDir,
    new OpenRouterClient(),
  );

  // 5. Global plan synthesis (intro/ending strategy + arc summary)
  const globalPlan = await synthesizeGlobal(profile, plannedBeats);

  const totalDuration = plannedBeats.reduce(
    (sum, b) => sum + b.duration,
    0,
  );
  const avgBeat = plannedBeats.length
    ? totalDuration / plannedBeats.length
    : 0;

  const plan: ScenePlan = {
    schema_version: "1.0.0",
    project_name: opts.projectName,
    channel_slug: channelSlug,
    generated_at: new Date().toISOString(),
    voiceover_path: paths.voiceoverPath,
    script_path: paths.scriptPath,
    voiceover_duration: transcript.duration,
    source_style_profile: profilePath,
    pacing_target_seconds: pacingTarget,
    language: transcript.language,
    totals: {
      beats: plannedBeats.length,
      average_beat_duration: avgBeat,
      coverage_seconds: totalDuration,
    },
    global: globalPlan,
    beats: plannedBeats,
  };

  await writeJson(paths.scenePlanJson, plan);
  log.info(`scene_plan.json → ${paths.scenePlanJson}`);

  return {
    scenePlanPath: paths.scenePlanJson,
    transcriptPath: paths.transcriptJson,
    alignmentPath: paths.alignmentJson,
    plan,
  };
}

async function synthesizeGlobal(
  profile: ChannelStyleProfile,
  beats: ScenePlanBeat[],
): Promise<ScenePlan["global"]> {
  if (beats.length === 0) {
    return {
      intro_strategy: "no beats",
      ending_strategy: "no beats",
      overall_emotional_arc: "unknown",
      music_arc: "unknown",
      notes: "empty plan",
    };
  }
  const client = new OpenRouterClient();
  const compactBeats = beats.map((b) => ({
    i: b.index,
    t: `${b.start_time.toFixed(1)}-${b.end_time.toFixed(1)}`,
    fn: b.script_function,
    tone: b.emotional_tone,
    asset: b.asset_type_needed,
    layout: b.suggested_visual_layout,
    music: b.music_mood,
  }));
  const system = `Summarize the overall editing plan in JSON only:
{
  "intro_strategy": "...",
  "ending_strategy": "...",
  "overall_emotional_arc": "...",
  "music_arc": "...",
  "notes": "..."
}
Base every statement on the supplied beats and channel profile. No prose outside JSON.`;
  try {
    return await client.chatJson<ScenePlan["global"]>(
      [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            `Channel: ${profile.channel_name}`,
            `Intro rules: ${JSON.stringify(profile.intro_rules)}`,
            `Ending rules: ${JSON.stringify(profile.ending_rules)}`,
            `Beats (summary): ${JSON.stringify(compactBeats)}`,
          ].join("\n"),
        },
      ],
      {
        model: config.openrouter.reasoningModel,
        temperature: 0.2,
        maxTokens: 600,
      },
    );
  } catch (e) {
    log.warn(`global plan synthesis failed: ${(e as Error).message}`);
    return {
      intro_strategy: profile.intro_rules.hook_style,
      ending_strategy: profile.ending_rules.cta_style,
      overall_emotional_arc: "fallback",
      music_arc: "fallback",
      notes: `fallback — ${(e as Error).message.slice(0, 200)}`,
    };
  }
}
