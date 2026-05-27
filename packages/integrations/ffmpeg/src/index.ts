/* Thin re-export: the existing src/utils/ffmpeg.ts already does the right
 * thing — ffprobe + frame extraction + audio extraction. We re-export it
 * from the new package so analyzer code doesn't reach into the legacy tree. */
export {
  ffprobe,
  extractFrame,
  extractFrames,
  extractAudio,
  checkBinaries,
  type ProbeResult,
} from "../../../../src/utils/ffmpeg.js";
