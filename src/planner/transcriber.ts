import { runPython } from "../utils/python.js";
import { fileExists, readJson, writeJson } from "../utils/paths.js";

export interface WhisperWord {
  text: string;
  start: number;
  end: number;
  probability: number;
}

export interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  audio: string;
  language: string;
  language_probability: number;
  duration: number;
  model: string;
  words: WhisperWord[];
  segments: WhisperSegment[];
}

export interface TranscribeOptions {
  model?: string;
  device?: string;
  computeType?: string;
  language?: string;
}

export async function transcribeVoiceover(
  audioPath: string,
  cacheFile: string,
  opts: TranscribeOptions = {},
): Promise<TranscriptResult> {
  if (await fileExists(cacheFile)) {
    return readJson<TranscriptResult>(cacheFile);
  }
  const args = [audioPath];
  if (opts.model) args.push("--model", opts.model);
  if (opts.device) args.push("--device", opts.device);
  if (opts.computeType) args.push("--compute-type", opts.computeType);
  if (opts.language) args.push("--language", opts.language);

  const result = await runPython<TranscriptResult>("transcribe.py", args);
  await writeJson(cacheFile, result);
  return result;
}
