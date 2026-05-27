import type {
  AlignedSentence,
  AlignedToken,
  ScriptAlignment,
} from "./scriptAligner.js";

export interface RawBeat {
  index: number;
  start_time: number;
  end_time: number;
  duration: number;
  narration_text: string;
  source_sentence_indices: number[];
  alignment_confidence: number;
  word_count: number;
  /** Position in [0, 1] across the voiceover for intro/ending logic. */
  position_ratio: number;
}

export interface SegmentOptions {
  /** Target beat duration in seconds — from channel_style_profile. */
  pacingTargetSeconds: number;
  /** Allow merging sentences shorter than this fraction of pacingTarget. */
  minRatio?: number;
  /** Allow splitting sentences longer than this fraction of pacingTarget. */
  maxRatio?: number;
}

/**
 * Convert aligned sentences into beats that match the channel's pacing.
 *
 *  - sentence shorter than `min` → merged with the next sentence
 *  - sentence longer than `max` → split at internal punctuation /
 *    conjunctions, then split evenly across word boundaries as a last resort
 */
export function segmentIntoBeats(
  alignment: ScriptAlignment,
  options: SegmentOptions,
): RawBeat[] {
  const min = options.pacingTargetSeconds * (options.minRatio ?? 0.55);
  const max = options.pacingTargetSeconds * (options.maxRatio ?? 1.7);
  const duration = Math.max(alignment.audioDuration, 0.001);

  const sentences = [...alignment.sentences].sort((a, b) => a.index - b.index);

  // 1. Split oversized sentences first
  const expanded: AlignedSentence[] = [];
  for (const s of sentences) {
    if (s.duration > max) {
      expanded.push(...splitLongSentence(s, alignment.tokens, max));
    } else {
      expanded.push(s);
    }
  }

  // 2. Greedy merge small sentences forward
  const merged: AlignedSentence[] = [];
  let buf: AlignedSentence | null = null;
  for (const s of expanded) {
    if (!buf) {
      buf = { ...s };
      continue;
    }
    const mergedDuration = s.end - buf.start;
    if (buf.duration < min && mergedDuration <= max) {
      buf = {
        index: buf.index,
        text: `${buf.text} ${s.text}`,
        start: buf.start,
        end: s.end,
        duration: s.end - buf.start,
        wordCount: buf.wordCount + s.wordCount,
        matchedCount: buf.matchedCount + s.matchedCount,
        charOffsetStart: buf.charOffsetStart,
        charOffsetEnd: s.charOffsetEnd,
        alignmentConfidence:
          (buf.alignmentConfidence + s.alignmentConfidence) / 2,
      };
    } else {
      merged.push(buf);
      buf = { ...s };
    }
  }
  if (buf) merged.push(buf);

  return merged.map((s, i) => {
    const midpoint = (s.start + s.end) / 2;
    return {
      index: i,
      start_time: s.start,
      end_time: s.end,
      duration: s.end - s.start,
      narration_text: s.text,
      source_sentence_indices: [s.index],
      alignment_confidence: s.alignmentConfidence,
      word_count: s.wordCount,
      position_ratio: Math.min(1, Math.max(0, midpoint / duration)),
    };
  });
}

const SPLIT_PUNCT_RE = /([,;:—–]\s+|\s+(?:and|but|because|then|so|while|when|after|before|until|though)\s+)/gi;

function splitLongSentence(
  s: AlignedSentence,
  tokens: AlignedToken[],
  maxSeconds: number,
): AlignedSentence[] {
  // Gather tokens belonging to this sentence in order.
  const own = tokens
    .filter((t) => t.sentenceIndex === s.index)
    .sort((a, b) => a.start - b.start);
  if (own.length === 0) return [s];

  // Walk tokens; whenever we cross maxSeconds OR hit a split-punctuation
  // token boundary, finalize a chunk.
  const chunks: AlignedSentence[] = [];
  let chunkStart = 0;
  let chunkStartTime = own[0]!.start;

  for (let i = 1; i < own.length; i++) {
    const curr = own[i]!;
    const dur = curr.end - chunkStartTime;
    const prev = own[i - 1]!;
    const punctuationBoundary = /[,;:—–]\s*$/.test(prev.raw);
    const overflow = dur > maxSeconds;
    if ((punctuationBoundary && dur > maxSeconds * 0.6) || overflow) {
      chunks.push(makeChunkSentence(s, own, chunkStart, i, chunkStartTime, prev.end));
      chunkStart = i;
      chunkStartTime = curr.start;
    }
  }
  // tail
  const last = own[own.length - 1]!;
  chunks.push(
    makeChunkSentence(s, own, chunkStart, own.length, chunkStartTime, last.end),
  );
  return chunks;
}

function makeChunkSentence(
  parent: AlignedSentence,
  tokens: AlignedToken[],
  startIdx: number,
  endIdx: number,
  start: number,
  end: number,
): AlignedSentence {
  const slice = tokens.slice(startIdx, endIdx);
  const text = slice.map((t) => t.raw).join(" ");
  const matched = slice.filter((t) => t.matched).length;
  const conf =
    slice.reduce((sum, t) => sum + t.confidence, 0) / Math.max(1, slice.length);
  return {
    index: parent.index,
    text,
    start,
    end,
    duration: Math.max(0, end - start),
    wordCount: slice.length,
    matchedCount: matched,
    charOffsetStart: parent.charOffsetStart,
    charOffsetEnd: parent.charOffsetEnd,
    alignmentConfidence: conf,
  };
}
