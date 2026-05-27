# Autonomous AI Video Editor

Dashboard-based system that analyzes existing YouTube channels, extracts
their editing style as a reusable **Style Preset**, and uses that preset
to produce new videos from script + voiceover — with real images, real
YouTube clips, your local asset packs, and local Remotion rendering.

This repo contains two parallel pipelines as the system transitions to
its new architecture:

- **`packages/` (new)** — monorepo per the revised plan. PHASES 1–2 are
  live: channel URL → Apify → yt-dlp → ffmpeg → PySceneDetect → Whisper
  → OpenRouter vision → per-video `video_analysis.json` → multi-video
  `style_preset.json`. Driven by `npm run analyze:channel`.
- **`src/` (legacy)** — the original Phase-1-to-7 pipeline that already
  ships an end-to-end CLI + Electron desktop app. Still works behind the
  `npm run vibe ...` entry point. The new packages re-export from these
  modules where the internals are sound; the legacy entry points will be
  retired once the new pipeline reaches feature parity.

## New architecture

```
autonomous-video-editor/
├── apps/                         (planned)
│   ├── dashboard/                # web/Electron dashboard
│   └── renderer/                 # Remotion app shell
├── packages/
│   ├── core/                     # config
│   ├── analyzer/                 # Style Analyzer pipeline (Phases 2–4)
│   ├── editor/                   # Editor pipeline (Phases 6–10) [planned]
│   ├── integrations/             # one wrapper per external tool
│   │   ├── openrouter/  apify/   brave/   ytdlp/
│   │   ├── ffmpeg/      scenedetect/ whisper/ remotion/
│   ├── schemas/                  # zod-validated JSON contracts
│   ├── storage/                  # SQLite index (node:sqlite)
│   └── utils/                    # logger, paths, slugify, timestamps
├── scripts/                      # PHASE 13 CLI entry points
├── asset-library/                # user transitions / sfx / music / etc.
├── style-presets/<channel>/      # generated style_preset.json + manifest
├── reference-videos/<channel>/   # downloaded source videos + per-video JSONs
├── projects/                     # editor projects (when Phase 6+ runs)
├── cache/                        # vibe.sqlite + scratch
├── src/                          # legacy pipeline (Phase 1–7)
├── desktop/                      # legacy Electron app
├── remotion/                     # legacy Remotion composition
└── python/                       # PySceneDetect / librosa / Whisper drivers
```

## Required API keys

Copy `.env.example` to `.env` and set:

- `OPENROUTER_API_KEY` — vision + reasoning gateway.
- `APIFY_API_KEY` — YouTube channel + video scraping (PHASE 2 entry point).
- `BRAVE_SEARCH_API_KEY` — image / news / video search (PHASE 7).

Optional later: `YOUTUBE_DATA_API_KEY`.

Local binaries: `ffmpeg`, `ffprobe`, `yt-dlp`, `python3`. Python deps via
`pip install -r python/requirements.txt`.

## Style Analyzer — the first milestone

`npm run analyze:channel` is the PHASE 16 milestone. It:

1. Calls Apify to list a channel's videos (with title, view count,
   duration, published-at).
2. Selects 3 / 5 / 10 (or any N) using `--mode top | recent | manual | mixed`
   and optional `--manual <urls>`.
3. Downloads each picked video with `yt-dlp` (≤1080p mp4).
4. Per video: ffprobe → audio extract → PySceneDetect → librosa audio
   analysis → OpenCV transition heuristics → faster-whisper transcript →
   keyframes extracted at scene midpoints + audio spikes → OpenRouter
   vision analysis per beat (new beat schema with structured
   `text_overlay` / `lower_third` / `title_card` / `motion_graphic`
   objects).
5. Emits `reference-videos/<slug>/<videoId>/video_analysis.json` (exact
   PHASE 3 schema) + `style_summary.md`.
6. After all videos finish, combines stats + asks the reasoning LLM to
   synthesize the qualitative rule blocks (mood / scripting / image /
   clip / headline / title-card / lower-third / transition / sfx /
   music / motion-graphic) and writes
   `style-presets/<slug>/style_preset.json` per the exact PHASE 4
   schema, plus an `analysis_manifest.json` next to it summarising which
   videos were chosen and why.
7. Records preset + per-video metadata in
   `cache/vibe.sqlite` (lazy `node:sqlite`; non-fatal if unavailable).

### CLI

```bash
# PHASE 13.1 — channel mode (the milestone):
npm run analyze:channel -- \
  --url "https://www.youtube.com/@SpillRumors" \
  --mode mixed --videos 5 \
  --manual "https://www.youtube.com/watch?v=...,https://www.youtube.com/watch?v=..."

# PHASE 13.2 — analyze one video (URL or local file):
npm run analyze:video -- --url "https://...watch?v=..." --preset spillrumors
npm run analyze:video -- --file ./reference-videos/v1.mp4 --preset spillrumors

# PHASE 13.3 — rebuild preset from already-analyzed reference videos:
npm run preset:generate -- --channel spillrumors --name "SpillRumors"
```

Selection modes:
- `top` — highest view count first
- `recent` — most recent uploads first
- `manual` — only the `--manual` URLs (fills with top if you asked for more)
- `mixed` (default per the plan) — alternates top / recent picks, plus any
  `--manual` URLs always included first

Each long-running step caches under
`reference-videos/<slug>/<videoId>/cache/` so re-runs are cheap; pass
`--force` to regenerate.

## What's still to build (new pipeline)

- PHASE 5 Asset library matching (SFX fingerprint, transition compare) —
  the legacy pipeline already ships this; needs porting + new schema.
- PHASE 6 Script + Voiceover Scene Planner — legacy `vibe plan` ships
  this; new schema (`scene_plan.json` with web_headline_search_queries
  and explicit `selected_style_preset` field) defined in
  `packages/schemas/src/scene-plan.ts`, port pending.
- PHASE 7 Asset sourcing system — legacy `vibe source` ships this.
- PHASE 8 Visual Quality Checker — legacy `vibe review` ships this; new
  schema in `packages/schemas/src/asset-review.ts`.
- PHASE 9 Timeline builder — legacy `vibe build-timeline` ships this.
- PHASE 10 Remotion renderer — legacy `vibe render` ships this.
- PHASE 11 Dashboard — replaces the legacy Electron app.

## Legacy CLI (still works)

```bash
vibe doctor
vibe analyze -i <video> -c "SpillRumors"
vibe build-profile -c "SpillRumors"
vibe plan -p <slug> -c "SpillRumors"
vibe source -p <slug>
vibe review -p <slug>
vibe build-timeline -p <slug>
vibe render -p <slug>
npm run desktop:dev
```

## Important rules

- **No stock footage. No random filler b-roll. No AI-generated visuals
  by default.** Every visual must trace back to a real source URL.
- Every long-running step writes a cache + a structured JSON output —
  every result is auditable.
- When confidence is low, the analyzer says so (`confidence` fields are
  preserved end to end) rather than guessing.
- Rendering happens locally via Remotion (legacy `vibe render`; new
  package will re-use the existing renderer).
