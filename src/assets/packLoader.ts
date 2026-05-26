import path from "node:path";
import fs from "node:fs/promises";
import fg from "fast-glob";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("pack-loader");

export interface AssetPack {
  /** Pack root directory (absolute). */
  dir: string;
  /** All asset files in the pack (absolute paths). */
  files: string[];
}

export interface AssetPacks {
  transitions: AssetPack;
  sfx: AssetPack;
  music: AssetPack;
  animated_backgrounds: AssetPack;
  lower_thirds: AssetPack;
  title_cards: AssetPack;
  motion_graphics: AssetPack;
}

const VIDEO_EXTS = new Set([
  ".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi", ".gif",
]);
const AUDIO_EXTS = new Set([".wav", ".mp3", ".aif", ".aiff", ".flac", ".m4a", ".ogg"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const TEMPLATE_EXTS = new Set([
  ...VIDEO_EXTS,
  ...IMAGE_EXTS,
  ".mogrt", // motion-graphics template
  ".aep",
]);

async function scan(dir: string, allowed: Set<string>): Promise<string[]> {
  try {
    await fs.access(dir);
  } catch {
    return [];
  }
  const files = await fg("**/*", {
    cwd: dir,
    absolute: true,
    onlyFiles: true,
    dot: false,
  });
  return files.filter((f) => allowed.has(path.extname(f).toLowerCase()));
}

export async function loadAssetPacks(
  rootDir: string = config.assetLibraryDir,
): Promise<AssetPacks> {
  const [transitions, sfx, music, animBg, lt, tc, mg] = await Promise.all([
    scan(path.join(rootDir, "transitions"), new Set([...VIDEO_EXTS, ...IMAGE_EXTS])),
    scan(path.join(rootDir, "sfx"), AUDIO_EXTS),
    scan(path.join(rootDir, "music"), AUDIO_EXTS),
    scan(path.join(rootDir, "animated-backgrounds"), new Set([...VIDEO_EXTS, ...IMAGE_EXTS])),
    scan(path.join(rootDir, "lower-thirds"), TEMPLATE_EXTS),
    scan(path.join(rootDir, "title-cards"), TEMPLATE_EXTS),
    scan(path.join(rootDir, "motion-graphics"), TEMPLATE_EXTS),
  ]);

  const packs: AssetPacks = {
    transitions: { dir: path.join(rootDir, "transitions"), files: transitions },
    sfx: { dir: path.join(rootDir, "sfx"), files: sfx },
    music: { dir: path.join(rootDir, "music"), files: music },
    animated_backgrounds: {
      dir: path.join(rootDir, "animated-backgrounds"),
      files: animBg,
    },
    lower_thirds: { dir: path.join(rootDir, "lower-thirds"), files: lt },
    title_cards: { dir: path.join(rootDir, "title-cards"), files: tc },
    motion_graphics: { dir: path.join(rootDir, "motion-graphics"), files: mg },
  };
  log.debug(
    `loaded packs: transitions=${transitions.length} sfx=${sfx.length} music=${music.length} bg=${animBg.length} lt=${lt.length} tc=${tc.length} mg=${mg.length}`,
  );
  return packs;
}

/**
 * Pick the asset whose filename contains the most keyword overlaps with
 * `keywords` (case-insensitive). Returns null if the pack is empty.
 */
export function pickByKeywords(
  pack: AssetPack,
  keywords: string[],
): string | null {
  if (pack.files.length === 0) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const normKeywords = keywords
    .map((k) => norm(k))
    .flatMap((k) => k.split(" "))
    .filter((k) => k.length >= 3);
  if (normKeywords.length === 0) return pack.files[0]!;

  let best: { path: string; score: number } | null = null;
  for (const f of pack.files) {
    const haystack = norm(path.basename(f));
    let score = 0;
    for (const k of normKeywords) {
      if (haystack.includes(k)) score++;
    }
    if (!best || score > best.score) best = { path: f, score };
  }
  return best?.path ?? pack.files[0]!;
}

/** Pick a file from a pack whose filename matches one of the named items
 *  (used when the Style Library lists actual filenames). */
export function findByFilename(
  pack: AssetPack,
  filename: string,
): string | null {
  if (!filename) return null;
  const lc = filename.toLowerCase();
  for (const f of pack.files) {
    if (path.basename(f).toLowerCase() === lc) return f;
    if (path.basename(f, path.extname(f)).toLowerCase() === lc) return f;
  }
  return null;
}
