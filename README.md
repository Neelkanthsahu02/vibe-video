# vibe-video

Autonomous AI Video Editor for cashcow-style YouTube documentary channels.
This repo currently implements **Phase 1: Channel Style Library Builder**.
Later phases (Scene Planner, Asset Sourcing, Visual Quality Checker, Timeline
Builder, Remotion render, Electron app) build on the outputs produced here.

The flow for Phase 1:

```
finished video files ──▶ vibe analyze ──▶ style-library/<channel>/video_analyses/<video>/
                                        ├── video_analysis.json     (full per-beat breakdown)
                                        ├── style_summary.md        (human-readable)
                                        ├── ../../detected_assets/<video>.json
                                        └── ../../asset_usage_reports/<video>.json

multiple analyzed videos ─▶ vibe build-profile ─▶ style-library/<channel>/channel_style_profile.json
```

`channel_style_profile.json` is the Style Library brain — the reusable file that
Phase 2's Scene Planner consumes.

## Prerequisites

Install once on your local PC:

- **ffmpeg / ffprobe** (Homebrew, `apt`, or [ffmpeg.org](https://ffmpeg.org/download.html))
- **Python 3.10+**
- **Node.js 20+** + npm

Set up the project:

```bash
npm install
python3 -m venv .venv && source .venv/bin/activate
pip install -r python/requirements.txt
cp .env.example .env
# edit .env and set OPENROUTER_API_KEY
```

## Folder layout

```
style-library/
  spillrumors/
    channel_style_profile.json           # synthesized Style Library
    video_analyses/
      <video-slug>/
        video_analysis.json
        style_summary.md
        frames/                          # extracted JPEGs (1 per beat sample)
        audio/audio.wav                  # extracted mono PCM
        cache/                           # scenes, transitions, audio, beat vision
    detected_assets/<video-slug>.json
    asset_usage_reports/<video-slug>.json

asset-library/
  transitions/                           # drop your transition pack here
  sfx/                                   # drop your SFX pack here
  music/                                 # drop your music pack here
  animated-backgrounds/
  lower-thirds/
  title-cards/
  motion-graphics/

projects/                                # Phase 2+ project workspaces
```

## CLI usage

```bash
# Sanity check
npx vibe doctor

# Analyze a single finished video
npx vibe analyze \
  -c "SpillRumors" \
  -i /path/to/finished/video.mp4 \
  --sfx-pack ./asset-library/sfx

# Analyze every video in a folder
npx vibe analyze-dir \
  -c "SpillRumors" \
  -i ./downloads/spillrumors \
  --sfx-pack ./asset-library/sfx \
  --recursive

# Build the channel style profile from all analyzed videos
npx vibe build-profile -c "SpillRumors" --channel-url https://www.youtube.com/@SpillRumors

# List what's analyzed so far
npx vibe list -c "SpillRumors"
```

## What gets detected

- **Scenes (visual changes)** — PySceneDetect ContentDetector with caching.
- **Per-beat vision** — OpenRouter vision model classifies each beat's asset
  type, camera motion, overlay/lower-third/title-card text, motion-graphic
  presence, and emotional purpose. Schema-enforced JSON only.
- **Transitions** — OpenCV heuristic on `±6` frames around each cut. Returns
  `hard_cut`, `flash`, `fade_to_black`, `zoom_blur`, `dissolve`, `light_leak`,
  etc., with a confidence score and the reason for the call.
- **Audio** — librosa-based mood guess, tempo, intensity curve, and music
  change-point timestamps.
- **SFX matching** — MFCC-fingerprint matcher against your local SFX pack. Each
  match returns timestamp, duration, and confidence so uncertain matches can
  be deferred. No model dependency.
- **Motion graphics** — flagged by the vision model with kind (`timeline`,
  `relationship_map`, `net_worth_money`, `headline_card`, etc.).

## What `channel_style_profile.json` contains

Synthesized from every analyzed video by aggregating statistics and asking the
reasoning LLM to distill teachable rules. Includes the full schema described in
[`src/schemas/channelStyleProfile.ts`](src/schemas/channelStyleProfile.ts):

- `asset_ratio_rules` — % of beats per asset type
- `pacing_rules` — average + p25/p50/p75 shot duration
- `intro_rules` / `ending_rules`
- `image_treatment_rules` / `clip_treatment_rules` / `headline_screenshot_rules`
- `title_card_rules` / `lower_third_rules`
- `transition_rules.distribution` + `by_context` (per emotional purpose)
- `sfx_rules.most_used` + `by_context`
- `music_rules.mood_distribution` + `by_emotional_purpose` + duck-under-narration
- `motion_graphic_rules.kinds_used` + `when_to_use`
- `emotional_editing_rules[]` — moment → (assets, camera, pacing, music, transition, sfx)
- `do_rules` / `avoid_rules`
- `examples_from_reference_videos[]` — concrete timestamps per emotional purpose
- `confidence_score` (0..1) — based on video count, beat count, vision confidence

## Caching & resumability

Every expensive step (scene detection, transition heuristics, audio analysis,
per-beat vision calls, SFX matching) writes a cache file under the video's
`cache/` directory. Re-running `vibe analyze` on the same video is cheap; pass
`--force` to regenerate.

## Local-first defaults

- No AI-generated visuals are introduced by Phase 1 — the Library only reads.
- The only external API is OpenRouter (vision + reasoning models). Everything
  else (ffmpeg, PySceneDetect, librosa, OpenCV) runs locally.
- Phase 2's image/clip discovery will use Brave Search + yt-dlp, also local.

## Phase 2 — Script + Voiceover Scene Planner

`vibe plan` consumes a `channel_style_profile.json` (built in Phase 1), a
`script.txt`, and a `voiceover.wav/mp3` and produces `scene_plan.json` for
Phase 3 asset sourcing.

Pipeline:

1. **Transcribe** the voiceover with `faster-whisper` locally (word-level
   timestamps, VAD on, language auto-detect).
2. **Align** the canonical script to the recognized timestamps via fuzzy
   token matching with bounded look-ahead. Unmatched script words get
   interpolated timestamps so every word has a usable `(start, end)`.
3. **Segment** aligned sentences into beats whose durations match the
   channel's pacing target (`channel_style_profile.average_visual_change_seconds`).
   Sentences shorter than 55% of target merge forward; sentences longer
   than 170% of target split at internal punctuation / conjunction
   boundaries.
4. **Plan each beat** via the reasoning LLM, constrained by the Style
   Library. Each output beat cites which rule it followed in
   `style_library_rule_used`.
5. **Global synthesis** of intro/ending strategy, emotional arc, music
   arc.

### Project layout (created on first `vibe plan`)

```
projects/<project-slug>/
  input/
    script.txt
    voiceover.wav     # or .mp3 / .m4a
  plan/
    transcript.json
    script_alignment.json
    scene_plan.json
  assets/
    candidates/{images,clips}/
    approved/{images,clips}/
    rejected/
  render/
  exports/
  cache/
    beat_plans/
```

### CLI

```bash
# Place script.txt and voiceover.wav in projects/<slug>/input/, then:
npx tsx src/cli/index.ts plan \
  -p "khloe-tristan-timeline" \
  -c "SpillRumors"

# Or point at any locations:
npx tsx src/cli/index.ts plan \
  -p "khloe-tristan-timeline" -c "SpillRumors" \
  --script ./writing/khloe.txt --voiceover ./tts/khloe.wav \
  --whisper-model small --pacing 3.2
```

### scene_plan.json schema (per beat)

`scene_id`, `index`, `start_time`, `end_time`, `duration`, `narration_text`,
`beat_summary`, `emotional_tone`, `script_function`
(`intro|context|setup|betrayal|scandal|reveal|emotional_reflection|timeline_explanation|public_reaction|ending`),
`visual_goal`, `asset_type_needed`, `image_search_queries[]`,
`youtube_clip_search_queries[]`, `headline_search_queries[]`,
`suggested_visual_layout`, `camera_motion`, `overlay_text`,
`lower_third_text`, `title_card_text`, `motion_graphic_instruction`,
`transition_in`, `transition_out`, `sfx_suggestion`, `music_mood`,
`editing_notes`, `style_library_rule_used`, `alignment_confidence`.

See [`src/schemas/scenePlan.ts`](src/schemas/scenePlan.ts) for the full
schema.

## Next phases (not yet implemented)

- Phase 3: `vibe source` — Brave image search + YouTube clip download per scene.
- Phase 4: `vibe review` — vision quality check on candidate assets.
- Phase 5: `vibe build-timeline` — Remotion timeline construction.
- Phase 6: `vibe render` — local Remotion render.
- Phase 7: Electron desktop app.
