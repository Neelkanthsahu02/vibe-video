import type { Timeline } from "../src/schemas/timeline.js";

/**
 * Placeholder timeline used when the Remotion CLI loads Root without input
 * props (e.g. the studio launching cold before `vibe build-timeline` ran).
 * Production renders pass a real timeline via --props.
 */
export const defaultTimeline: Timeline = {
  schema_version: "1.0.0",
  project_name: "placeholder",
  channel_slug: "placeholder",
  generated_at: new Date().toISOString(),
  composition: {
    width: 1920,
    height: 1080,
    fps: 30,
    duration_seconds: 5,
    background_color: "#000000",
  },
  audio: {
    voiceover_path: "",
    voiceover_gain: 0,
    music_cues: [],
    sfx_cues: [],
    duck_windows: [],
  },
  visuals: [
    {
      scene_id: "scene_0000",
      index: 0,
      start_seconds: 0,
      duration_seconds: 5,
      kind: "color_fill",
      asset_path: null,
      source_asset_id: null,
      layout: "fullscreen_image",
      motion: "static",
      crop: null,
      clip_segment: null,
      clip_audio_gain: 0,
      overlays: [
        {
          kind: "title_card_text",
          text: "vibe-video — pass --props to render a real timeline",
          in_seconds: 0,
          duration_seconds: null,
          template_path: null,
          position: "center",
        },
      ],
      transition_in: { type: "hard_cut", duration_seconds: 0, asset_path: null, source_rule: null },
      transition_out: { type: "hard_cut", duration_seconds: 0, asset_path: null, source_rule: null },
      style_rule: "placeholder",
      narration_text: "",
      warning: null,
    },
  ],
  warnings: [],
  source: {
    scene_plan_path: "",
    asset_review_path: "",
    style_profile_path: "",
    asset_library_dir: "",
  },
};
