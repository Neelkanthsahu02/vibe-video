import type { WhisperWord, TranscriptResult } from "./transcriber.js";

/**
 * Align the canonical script tokens against the recognized whisper words.
 *
 * Returns one entry per script token with start/end timestamps and a
 * confidence reflecting how closely the script word matched the whisper word.
 * Unmatched script tokens are linearly interpolated between the nearest
 * matched anchors so every word has a usable timestamp.
 */

export interface ScriptToken {
  /** Token text as it appears in the original script (with punctuation). */
  raw: string;
  /** Normalized token used for matching (lowercase, no punctuation). */
  norm: string;
  /** Character offset of `raw` in the original script. */
  charOffset: number;
  /** Sentence index this token belongs to. */
  sentenceIndex: number;
}

export interface AlignedToken extends ScriptToken {
  start: number;
  end: number;
  matched: boolean;
  matchedWhisperWord: string | null;
  confidence: number;
}

export interface AlignedSentence {
  index: number;
  text: string;
  start: number;
  end: number;
  duration: number;
  wordCount: number;
  matchedCount: number;
  charOffsetStart: number;
  charOffsetEnd: number;
  alignmentConfidence: number;
}

export interface ScriptAlignment {
  totalScriptWords: number;
  totalMatched: number;
  matchRate: number;
  audioDuration: number;
  language: string;
  tokens: AlignedToken[];
  sentences: AlignedSentence[];
}

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z"'\(\[])/g;
const WORD_RE = /\S+/g;

export function splitSentences(script: string): { text: string; charOffset: number }[] {
  const cleaned = script.replace(/\r\n/g, "\n").replace(/\s+\n/g, "\n");
  const result: { text: string; charOffset: number }[] = [];
  let cursor = 0;
  // First split by hard newlines (paragraph breaks), then by sentence punctuation.
  for (const para of cleaned.split(/\n+/)) {
    if (!para.trim()) {
      cursor = cleaned.indexOf(para, cursor) + para.length + 1;
      continue;
    }
    const paraStartInScript = cleaned.indexOf(para, cursor);
    cursor = paraStartInScript + para.length;
    const sentences = para.split(SENTENCE_SPLIT_RE);
    let localCursor = 0;
    for (const s of sentences) {
      const trimmed = s.trim();
      if (!trimmed) continue;
      const startInPara = para.indexOf(trimmed, localCursor);
      result.push({
        text: trimmed,
        charOffset: paraStartInScript + startInPara,
      });
      localCursor = startInPara + trimmed.length;
    }
  }
  return result;
}

export function tokenizeScript(script: string): ScriptToken[] {
  const sentences = splitSentences(script);
  const tokens: ScriptToken[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]!;
    const matches = sentence.text.matchAll(WORD_RE);
    for (const m of matches) {
      const raw = m[0];
      tokens.push({
        raw,
        norm: normalize(raw),
        charOffset: sentence.charOffset + (m.index ?? 0),
        sentenceIndex: i,
      });
    }
  }
  return tokens;
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9'’]+/g, "");
}

/** Levenshtein ratio in [0, 1]. */
function ratio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost,
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]!;
  }
  const dist = prev[n]!;
  return 1 - dist / Math.max(m, n);
}

/**
 * Pointer-walk alignment between script tokens and whisper words.
 *
 * Strategy: advance both pointers; consume a script token when it matches
 * the next whisper word, or look ahead a short window in either stream to
 * recover from insertion/deletion drift. Cheap, deterministic, robust to
 * minor mistranscriptions.
 */
export function alignScriptToWhisper(
  script: string,
  transcript: TranscriptResult,
): ScriptAlignment {
  const tokens = tokenizeScript(script);
  const whisper: WhisperWord[] = transcript.words.map((w) => ({
    ...w,
    text: w.text,
  }));
  const whisperNorm = whisper.map((w) => normalize(w.text));

  const aligned: AlignedToken[] = tokens.map((t) => ({
    ...t,
    start: -1,
    end: -1,
    matched: false,
    matchedWhisperWord: null,
    confidence: 0,
  }));

  const LOOKAHEAD_W = 5;
  const LOOKAHEAD_S = 3;
  const MATCH_THRESHOLD = 0.7;

  let si = 0;
  let wi = 0;
  while (si < aligned.length && wi < whisper.length) {
    const tok = aligned[si]!;
    if (!tok.norm) {
      si++;
      continue;
    }
    // 1. direct compare
    const wnorm = whisperNorm[wi]!;
    const r = ratio(tok.norm, wnorm);
    if (r >= MATCH_THRESHOLD) {
      const ww = whisper[wi]!;
      tok.start = ww.start;
      tok.end = ww.end;
      tok.matched = true;
      tok.matchedWhisperWord = ww.text;
      tok.confidence = r * ww.probability;
      si++;
      wi++;
      continue;
    }
    // 2. look ahead in whisper (script token missed words) — pick best match
    let bestR = 0;
    let bestOff = -1;
    for (let off = 1; off <= LOOKAHEAD_W && wi + off < whisper.length; off++) {
      const rr = ratio(tok.norm, whisperNorm[wi + off]!);
      if (rr > bestR) {
        bestR = rr;
        bestOff = off;
      }
    }
    // 3. look ahead in script (whisper inserted extra words)
    let bestRS = 0;
    let bestOffS = -1;
    for (let off = 1; off <= LOOKAHEAD_S && si + off < aligned.length; off++) {
      const rr = ratio(aligned[si + off]!.norm, wnorm);
      if (rr > bestRS) {
        bestRS = rr;
        bestOffS = off;
      }
    }
    if (bestR >= MATCH_THRESHOLD && bestR >= bestRS) {
      // skip whisper words [wi, wi+bestOff)
      wi += bestOff;
      // try direct match again on next loop iteration
      continue;
    }
    if (bestRS >= MATCH_THRESHOLD) {
      // skip script tokens [si, si+bestOffS)
      si += bestOffS;
      continue;
    }
    // No good match nearby — advance whichever stream is "behind".
    wi++;
  }

  interpolateUnmatched(aligned, transcript.duration);

  // Group into sentences using token sentenceIndex
  const sentences = buildSentenceTable(aligned, script);

  const matched = aligned.filter((a) => a.matched).length;
  return {
    totalScriptWords: aligned.length,
    totalMatched: matched,
    matchRate: aligned.length ? matched / aligned.length : 0,
    audioDuration: transcript.duration,
    language: transcript.language,
    tokens: aligned,
    sentences,
  };
}

function interpolateUnmatched(tokens: AlignedToken[], duration: number): void {
  if (tokens.length === 0) return;
  // Anchor first/last to bounds if missing
  let firstMatched = tokens.findIndex((t) => t.matched);
  if (firstMatched === -1) {
    // Nothing matched at all — distribute evenly across the duration.
    const step = duration / tokens.length;
    for (let i = 0; i < tokens.length; i++) {
      tokens[i]!.start = i * step;
      tokens[i]!.end = (i + 1) * step;
      tokens[i]!.confidence = 0.1;
    }
    return;
  }
  // Fill from start to first matched
  for (let i = 0; i < firstMatched; i++) {
    const ratio = (i + 1) / (firstMatched + 1);
    const target = tokens[firstMatched]!.start * ratio;
    tokens[i]!.start = target;
    tokens[i]!.end = target;
    tokens[i]!.confidence = 0.2;
  }
  // Walk anchor → anchor
  let prev = firstMatched;
  for (let i = firstMatched + 1; i < tokens.length; i++) {
    if (tokens[i]!.matched) {
      // Interpolate (prev, i)
      const a = tokens[prev]!;
      const b = tokens[i]!;
      const gap = i - prev;
      if (gap > 1) {
        const span = b.start - a.end;
        const step = span / gap;
        for (let k = 1; k < gap; k++) {
          const t = a.end + step * k;
          tokens[prev + k]!.start = t;
          tokens[prev + k]!.end = t + Math.max(0.05, step);
          tokens[prev + k]!.confidence = 0.3;
        }
      }
      prev = i;
    }
  }
  // Tail
  const last = tokens[prev]!;
  for (let i = prev + 1; i < tokens.length; i++) {
    const r = (i - prev) / (tokens.length - prev);
    const t = last.end + (duration - last.end) * r;
    tokens[i]!.start = t;
    tokens[i]!.end = t;
    tokens[i]!.confidence = 0.2;
  }
}

function buildSentenceTable(
  tokens: AlignedToken[],
  script: string,
): AlignedSentence[] {
  const sentenceMap = new Map<number, AlignedToken[]>();
  for (const t of tokens) {
    const arr = sentenceMap.get(t.sentenceIndex);
    if (arr) arr.push(t);
    else sentenceMap.set(t.sentenceIndex, [t]);
  }
  const sentences = splitSentences(script);
  const out: AlignedSentence[] = [];
  for (const [idx, toks] of [...sentenceMap.entries()].sort((a, b) => a[0] - b[0])) {
    if (toks.length === 0) continue;
    const start = toks[0]!.start;
    const end = toks[toks.length - 1]!.end;
    const matchedCount = toks.filter((t) => t.matched).length;
    const meta = sentences[idx]!;
    const conf =
      toks.reduce((sum, t) => sum + t.confidence, 0) / toks.length;
    out.push({
      index: idx,
      text: meta.text,
      start,
      end,
      duration: Math.max(0, end - start),
      wordCount: toks.length,
      matchedCount,
      charOffsetStart: meta.charOffset,
      charOffsetEnd: meta.charOffset + meta.text.length,
      alignmentConfidence: conf,
    });
  }
  return out;
}
