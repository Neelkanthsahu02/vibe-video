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

## Phase 3 — Asset Sourcing

`vibe source` reads `scene_plan.json` and downloads real candidate assets per
scene into the project workspace. No AI-generated visuals, no random stock
footage.

- **Images**: Brave Image Search API per `image_search_queries[]` (and
  `headline_search_queries[]` with " headline screenshot" appended).
  Candidates are downloaded with sharp validation (min long edge, max bytes,
  re-encoded JPEG for predictability) and a SHA-1 of the source URL as the
  filename so re-runs are cheap.
- **Clips**: `yt-dlp ytsearch:` for `youtube_clip_search_queries[]`. Metadata
  is fetched first across all queries, deduped by video id, ranked by view
  count, filtered by `--max-clip-duration`, then the top N are downloaded at
  ≤720p mp4.
- **Manifest**: every candidate ends up in
  `projects/<slug>/assets/candidates/manifest.json` with full provenance —
  query, source URL, page URL, publisher, dimensions, bytes, format, and
  YouTube id/channel. Phase 4 (Visual Quality Checker) consumes this.

```bash
# Get a free Brave Search API key at https://brave.com/search/api/
# Install yt-dlp: pip install -U yt-dlp  (or `brew install yt-dlp`)

npx tsx src/cli/index.ts source -p khloe-tristan-timeline
npx tsx src/cli/index.ts source -p khloe-tristan-timeline \
  --images-per-scene 8 --clips-per-scene 3 --max-clip-duration 600

# Skip clips on first pass to iterate cheaply on images
npx tsx src/cli/index.ts source -p khloe-tristan-timeline --skip-clips
```

Folder layout:

```
projects/<slug>/assets/
  candidates/
    manifest.json
    images/<scene_id>/<sha>.jpg
    clips/<scene_id>/yt_<videoId>.mp4
  approved/   # populated in Phase 4
  rejected/
```

## Phase 4 — Visual Quality Checker

`vibe review` runs every candidate from Phase 3 through an OpenRouter vision
model that answers eight strict questions per asset:

1. Is it the correct person/topic?
2. Is it relevant to the beat?
3. Is it clear / high quality?
4. Is it blurry / stretched / watermarked / unrelated?
5. Does it match the emotional tone?
6. Accept or reject?
7. Where should it be cropped? (normalized rect + focal point)
8. How should it be used? (layout, motion, best clip sub-segment)

Clips are summarized by extracting 3 representative frames at 20% / 50% /
80% positions before being sent to the vision model — the model sees the
whole clip, not just the title card.

Output `projects/<slug>/plan/asset_review.json` schema (see
[`src/schemas/assetReview.ts`](src/schemas/assetReview.ts)):

- per-asset: `accept_or_reject`, `relevance_score`, `quality_score`,
  `emotional_tone_match`, `reason`, `rejection_reasons[]`,
  `is_watermarked` / `is_blurry` / `is_stretched` /
  `appears_ai_generated`, `suggested_crop` (normalized), `suggested_motion`,
  `suggested_layout`, `best_use_case`, `best_clip_segment` (clips only),
  `vision_confidence`
- per-scene: `accepted_count`, `rejected_count`, `best_asset_id` (composite
  relevance-weighted pick), `notes[]`
- totals: how many scenes still have no accepted assets so you can re-source

```bash
npx tsx src/cli/index.ts review -p khloe-tristan-timeline

# Also copy accepted/rejected files into assets/approved|rejected/ on disk
npx tsx src/cli/index.ts review -p khloe-tristan-timeline --copy-approved

# Re-review only a subset of scenes after fixing their candidates
npx tsx src/cli/index.ts review -p khloe-tristan-timeline \
  --scenes scene_0007,scene_0012 --force
```

Per-candidate verdicts cache to `projects/<slug>/cache/asset_reviews/` so
re-runs are cheap; `--force` regenerates.

## Phase 5 — Timeline Builder

`vibe build-timeline` assembles a framework-agnostic `timeline.json` from
the Phase 1 Style Library + Phase 2 scene plan + Phase 3 candidates +
Phase 4 vision verdicts, and renders through a Remotion composition that
reads that JSON.

What the builder does for each beat:

- Picks the visual: `asset_review.best_asset_id` → top accepted entry →
  highest-scoring fallback (logged as a warning).
- Applies `suggested_crop` (normalized rect + focal point),
  `suggested_motion` (Ken Burns / pan / push-in), and
  `best_clip_segment` from the vision review.
- Auto-promotes portrait/tall images shown fullscreen to
  `blurred_fill_portrait` (blurred enlarged background + contained fg).
- Resolves transitions to actual files in
  `asset-library/transitions/` via filename keyword match; falls back to
  the channel's `transition_rules.by_context[<emotional_purpose>][0]`
  when the planner left a transition as `unknown`.
- Adds overlays from `lower_third_text`, `title_card_text`,
  `overlay_text`; optional burned narration captions with `--captions`.
- Schedules music as one cue per consecutive same-`music_mood` arc,
  picked from `asset-library/music/` by mood keyword. Each cue carries
  `gain`, `duck_gain`, fades.
- Schedules SFX from `asset-library/sfx/` using
  `beat.sfx_suggestion` → `sfx_rules.by_context[<purpose>]` →
  `sfx_rules.most_used` → keyword fallback. Throttled to one every 0.6s.
- Records duck windows for every beat with narration; the Remotion
  composition ducks all music cues inside those windows.

Outputs `projects/<slug>/render/timeline.json` and surfaces warnings for
beats with no accepted assets or any other manual-attention issues.

```bash
npx tsx src/cli/index.ts build-timeline -p khloe-tristan-timeline

# 4K, captions on, no music (e.g. for review pass)
npx tsx src/cli/index.ts build-timeline -p khloe-tristan-timeline \
  --width 3840 --height 2160 --fps 60 --captions --skip-music

# Preview in the Remotion Studio
npx remotion studio remotion/index.ts
```

## Next phases (not yet implemented)

- Phase 6: `vibe render` — local Remotion render to MP4.
- Phase 6: `vibe render` — local Remotion render.
- Phase 7: Electron desktop app.
