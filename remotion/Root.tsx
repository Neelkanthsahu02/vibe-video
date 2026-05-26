import React from "react";
import { Composition, getInputProps } from "remotion";
import { VideoComposition } from "./VideoComposition.js";
import type { Timeline } from "../src/schemas/timeline.js";
import { defaultTimeline } from "./defaultTimeline.js";

interface InputProps {
  timeline?: Timeline;
}

export const RemotionRoot: React.FC = () => {
  const input = getInputProps() as InputProps;
  const timeline = input.timeline ?? defaultTimeline;

  const fps = timeline.composition.fps;
  const durationFrames = Math.max(
    1,
    Math.ceil(timeline.composition.duration_seconds * fps),
  );
  return (
    <>
      <Composition
        id="VibeVideo"
        component={VideoComposition}
        durationInFrames={durationFrames}
        fps={fps}
        width={timeline.composition.width}
        height={timeline.composition.height}
        defaultProps={{ timeline }}
      />
    </>
  );
};
