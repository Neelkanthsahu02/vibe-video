import React from "react";
import {
  AbsoluteFill,
  Sequence,
  Audio,
  Video,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from "remotion";
import type {
  Timeline,
  VisualClip,
  OverlaySpec,
  MusicCue,
  SfxCue,
} from "../src/schemas/timeline.js";
import { defaultTimeline } from "./defaultTimeline.js";

// Composition props must be Record<string, unknown>-compatible for Remotion's
// LooseComponentType. We accept an optional timeline and fall back to the
// default placeholder when none is supplied.
type Props = Record<string, unknown> & { timeline?: Timeline };

/**
 * Resolve any path that arrived in the timeline JSON to something Remotion
 * can load. Absolute filesystem paths come from our builder; Remotion's
 * <Img>/<Video>/<Audio> components accept file:// URLs in render mode.
 */
function asUrl(p: string | null | undefined): string | null {
  if (!p) return null;
  if (/^(https?:|file:|data:)/i.test(p)) return p;
  if (p.startsWith("/")) return `file://${p}`;
  return staticFile(p);
}

export const VideoComposition: React.FC<Props> = (props) => {
  const { fps } = useVideoConfig();
  // Fall back to the placeholder timeline when none is provided (cold studio
  // launch). Actual renders pass the real timeline via defaultProps/--props.
  const timeline: Timeline =
    (props.timeline as Timeline | undefined) ?? defaultTimeline;

  return (
    <AbsoluteFill
      style={{ backgroundColor: timeline.composition.background_color }}
    >
      {/* Visual track */}
      {timeline.visuals.map((v) => {
        const fromFrame = Math.max(0, Math.round(v.start_seconds * fps));
        const durFrames = Math.max(
          1,
          Math.round(v.duration_seconds * fps),
        );
        return (
          <Sequence
            key={`v-${v.scene_id}-${v.index}`}
            from={fromFrame}
            durationInFrames={durFrames}
            layout="none"
          >
            <VisualLayer clip={v} />
            {v.overlays.map((o, i) => (
              <OverlayLayer key={`o-${v.scene_id}-${i}`} overlay={o} clip={v} />
            ))}
          </Sequence>
        );
      })}

      {/* Voiceover */}
      {timeline.audio.voiceover_path ? (
        <Audio
          src={asUrl(timeline.audio.voiceover_path) ?? ""}
          volume={timeline.audio.voiceover_gain}
        />
      ) : null}

      {/* Music cues */}
      {timeline.audio.music_cues.map((c, i) => (
        <MusicLayer
          key={`m-${i}`}
          cue={c}
          duckWindows={timeline.audio.duck_windows}
          fps={fps}
        />
      ))}

      {/* SFX cues */}
      {timeline.audio.sfx_cues.map((c, i) => (
        <SfxLayer key={`s-${i}`} cue={c} fps={fps} />
      ))}
    </AbsoluteFill>
  );
};

const VisualLayer: React.FC<{ clip: VisualClip }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const durFrames = Math.max(1, Math.round(clip.duration_seconds * fps));
  const t = frame / durFrames; // 0..1 within this clip

  // Transition-in fade
  const tInFrames = Math.round(clip.transition_in.duration_seconds * fps);
  const tOutFrames = Math.round(clip.transition_out.duration_seconds * fps);
  const opacityIn = tInFrames > 0 && clip.transition_in.type !== "hard_cut"
    ? interpolate(frame, [0, tInFrames], [0, 1], { extrapolateRight: "clamp" })
    : 1;
  const opacityOut = tOutFrames > 0 && clip.transition_out.type !== "hard_cut"
    ? interpolate(
        frame,
        [durFrames - tOutFrames, durFrames],
        [1, 0],
        { extrapolateLeft: "clamp" },
      )
    : 1;
  const opacity = Math.min(opacityIn, opacityOut);

  // Background per layout
  const bg = clip.layout === "blurred_fill_portrait" && clip.asset_path
    ? (
        <Img
          src={asUrl(clip.asset_path) ?? ""}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(40px) brightness(0.55)",
            transform: "scale(1.15)",
          }}
        />
      )
    : null;

  // Ken Burns transform for stills
  const kbScale = motionScale(clip.motion, t);
  const kbTranslate = motionTranslate(clip.motion, t);
  const fitStyle =
    clip.layout === "blurred_fill_portrait" ? "contain" : "cover";

  const cropStyle = applyCrop(clip.crop);

  let main: React.ReactNode = null;
  if (clip.kind === "image" && clip.asset_path) {
    main = (
      <Img
        src={asUrl(clip.asset_path) ?? ""}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: fitStyle,
          transform: `${kbTranslate} scale(${kbScale})`,
          transformOrigin: "center center",
          ...cropStyle,
        }}
      />
    );
  } else if (clip.kind === "clip" && clip.asset_path) {
    const startFrom = Math.round(
      (clip.clip_segment?.start ?? 0) * fps,
    );
    const endAt = clip.clip_segment
      ? Math.round(clip.clip_segment.end * fps)
      : undefined;
    main = (
      <Video
        src={asUrl(clip.asset_path) ?? ""}
        muted={clip.clip_audio_gain <= 0}
        volume={clip.clip_audio_gain}
        startFrom={startFrom}
        endAt={endAt}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: fitStyle,
        }}
      />
    );
  } else if (clip.kind === "title_card") {
    main = (
      <AbsoluteFill
        style={{
          backgroundColor: "#111",
          color: "white",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, Helvetica, Arial, sans-serif",
          fontSize: 86,
          fontWeight: 700,
          letterSpacing: -2,
        }}
      >
        {clip.narration_text || clip.style_rule}
      </AbsoluteFill>
    );
  } else if (clip.kind === "animated_background" && clip.asset_path) {
    main = (
      <Video
        src={asUrl(clip.asset_path) ?? ""}
        muted
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    );
  } else {
    main = (
      <AbsoluteFill
        style={{
          backgroundColor: "#000",
          color: "#666",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          fontSize: 28,
        }}
      >
        {clip.warning ?? `no asset for ${clip.scene_id}`}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ opacity }}>
      {bg}
      {main}
    </AbsoluteFill>
  );
};

const OverlayLayer: React.FC<{ overlay: OverlaySpec; clip: VisualClip }> = ({
  overlay,
  clip,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startFrame = Math.round(overlay.in_seconds * fps);
  if (frame < startFrame) return null;
  const endFrame =
    overlay.duration_seconds != null
      ? startFrame + Math.round(overlay.duration_seconds * fps)
      : Math.round(clip.duration_seconds * fps);
  if (frame > endFrame) return null;

  const fadeIn = interpolate(
    frame,
    [startFrame, startFrame + Math.round(0.25 * fps)],
    [0, 1],
    { extrapolateRight: "clamp" },
  );
  const fadeOut = interpolate(
    frame,
    [endFrame - Math.round(0.3 * fps), endFrame],
    [1, 0],
    { extrapolateLeft: "clamp" },
  );
  const opacity = Math.min(fadeIn, fadeOut);

  switch (overlay.kind) {
    case "title_card_text":
      return (
        <AbsoluteFill
          style={{
            opacity,
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            background: "rgba(0,0,0,0.55)",
            fontFamily: "Inter, Helvetica, Arial, sans-serif",
            fontSize: 92,
            fontWeight: 800,
            letterSpacing: -2,
            textAlign: "center",
            padding: 80,
          }}
        >
          {overlay.text}
        </AbsoluteFill>
      );
    case "lower_third":
      return (
        <AbsoluteFill
          style={{
            opacity,
            alignItems: "flex-start",
            justifyContent: "flex-end",
            padding: "0 0 120px 80px",
          }}
        >
          <div
            style={{
              background: "rgba(0,0,0,0.78)",
              color: "white",
              padding: "16px 28px",
              borderLeft: "6px solid #f6b400",
              fontFamily: "Inter, Helvetica, Arial, sans-serif",
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: -0.5,
              maxWidth: "65%",
            }}
          >
            {overlay.text}
          </div>
        </AbsoluteFill>
      );
    case "text_overlay":
      return (
        <AbsoluteFill
          style={{
            opacity,
            alignItems: "center",
            justifyContent: "flex-start",
            padding: "120px 80px 0",
          }}
        >
          <div
            style={{
              color: "white",
              fontFamily: "Inter, Helvetica, Arial, sans-serif",
              fontSize: 56,
              fontWeight: 700,
              textShadow: "0 4px 24px rgba(0,0,0,0.7)",
              textAlign: "center",
            }}
          >
            {overlay.text}
          </div>
        </AbsoluteFill>
      );
    case "captions":
      return (
        <AbsoluteFill
          style={{
            opacity,
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "0 80px 80px",
          }}
        >
          <div
            style={{
              color: "white",
              fontFamily: "Inter, Helvetica, Arial, sans-serif",
              fontSize: 40,
              fontWeight: 600,
              background: "rgba(0,0,0,0.55)",
              padding: "12px 22px",
              borderRadius: 8,
              textAlign: "center",
              maxWidth: "85%",
            }}
          >
            {overlay.text}
          </div>
        </AbsoluteFill>
      );
    case "headline_card_text":
      return (
        <AbsoluteFill
          style={{
            opacity,
            alignItems: "center",
            justifyContent: "center",
            padding: 100,
          }}
        >
          <div
            style={{
              background: "white",
              color: "black",
              padding: "30px 50px",
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontSize: 64,
              fontWeight: 700,
              borderTop: "8px solid #c00",
              maxWidth: "85%",
              textAlign: "center",
            }}
          >
            {overlay.text}
          </div>
        </AbsoluteFill>
      );
    default:
      return null;
  }
};

const MusicLayer: React.FC<{
  cue: MusicCue;
  duckWindows: Array<{ start_seconds: number; end_seconds: number }>;
  fps: number;
}> = ({ cue, duckWindows, fps }) => {
  const url = asUrl(cue.path);
  if (!url) return null;
  const from = Math.max(0, Math.round(cue.start_seconds * fps));
  const durFrames = Math.max(1, Math.round(cue.duration_seconds * fps));
  return (
    <Sequence from={from} durationInFrames={durFrames} layout="none">
      <DuckedAudio
        src={url}
        cue={cue}
        sequenceStart={cue.start_seconds}
        duckWindows={duckWindows}
        fps={fps}
      />
    </Sequence>
  );
};

const DuckedAudio: React.FC<{
  src: string;
  cue: MusicCue;
  sequenceStart: number;
  duckWindows: Array<{ start_seconds: number; end_seconds: number }>;
  fps: number;
}> = ({ src, cue, sequenceStart, duckWindows, fps }) => {
  // We can't read the absolute frame inside a Sequence directly — Remotion's
  // useCurrentFrame inside a Sequence is relative. Compute absolute volume
  // by sampling at each frame based on time math from sequenceStart.
  const localFrame = useCurrentFrame();
  const tAbs = sequenceStart + localFrame / fps;
  // Duck if inside any duck window
  const ducked = duckWindows.some(
    (w) => tAbs >= w.start_seconds && tAbs < w.end_seconds,
  );
  // Crossfade in/out
  const fadeIn = interpolate(
    localFrame,
    [0, Math.round(cue.fade_in_seconds * fps)],
    [0, 1],
    { extrapolateRight: "clamp", easing: Easing.linear },
  );
  const totalFrames = Math.round(cue.duration_seconds * fps);
  const fadeOut = interpolate(
    localFrame,
    [
      totalFrames - Math.round(cue.fade_out_seconds * fps),
      totalFrames,
    ],
    [1, 0],
    { extrapolateLeft: "clamp" },
  );
  const env = Math.min(fadeIn, fadeOut);
  const volume = env * (ducked ? cue.duck_gain : cue.gain);
  return <Audio src={src} volume={Math.max(0, Math.min(1, volume))} />;
};

const SfxLayer: React.FC<{ cue: SfxCue; fps: number }> = ({ cue, fps }) => {
  const url = asUrl(cue.path);
  if (!url) return null;
  const from = Math.max(0, Math.round(cue.at_seconds * fps));
  // SFX duration is unknown without probing; let Remotion play till end of
  // file by giving it a generous window.
  return (
    <Sequence from={from} durationInFrames={fps * 6} layout="none">
      <Audio src={url} volume={cue.gain} />
    </Sequence>
  );
};

function motionScale(motion: VisualClip["motion"], t: number): number {
  switch (motion) {
    case "slow_zoom_in":
    case "push_in":
      return 1 + 0.08 * t;
    case "slow_zoom_out":
      return 1.08 - 0.08 * t;
    case "blurred_background_fill":
    case "framed_image":
    case "split_screen":
    case "static":
    case "unknown":
      return 1;
    case "pan_left":
    case "pan_right":
      return 1.08; // pan effect uses scale to give room for translation
    default:
      return 1;
  }
}

function motionTranslate(motion: VisualClip["motion"], t: number): string {
  const pct = (n: number) => `${n.toFixed(3)}%`;
  switch (motion) {
    case "pan_left":
      return `translate(${pct(4 - 8 * t)}, 0)`;
    case "pan_right":
      return `translate(${pct(-4 + 8 * t)}, 0)`;
    default:
      return "translate(0, 0)";
  }
}

function applyCrop(
  crop: VisualClip["crop"],
): React.CSSProperties {
  if (!crop) return {};
  // Implement crop via clip-path; preserves underlying image transform.
  const left = (crop.x * 100).toFixed(2) + "%";
  const top = (crop.y * 100).toFixed(2) + "%";
  const right = ((1 - crop.x - crop.width) * 100).toFixed(2) + "%";
  const bottom = ((1 - crop.y - crop.height) * 100).toFixed(2) + "%";
  return {
    clipPath: `inset(${top} ${right} ${bottom} ${left})`,
  };
}
