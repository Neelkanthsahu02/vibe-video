/* Pick which channel videos to analyze given the user's mode. */
import type { ApifyVideoItem } from "../../integrations/apify/src/index.js";

export type SelectionMode = "top" | "recent" | "manual" | "mixed";

export interface SelectionOptions {
  mode: SelectionMode;
  count: number;
  /** For "manual" / "mixed": user-specified URLs to always include. */
  manualUrls?: string[];
  /** Skip videos longer than this many seconds (e.g. live streams). */
  maxDurationSeconds?: number;
  /** Skip videos shorter than this many seconds (e.g. shorts). */
  minDurationSeconds?: number;
}

export interface SelectionResult {
  picked: ApifyVideoItem[];
  skippedTooLong: ApifyVideoItem[];
  skippedTooShort: ApifyVideoItem[];
  notes: string[];
}

/**
 * Apply the mode-specific ranking and pick `count` items. Manual URLs (when
 * provided) are always included first, then top/recent/mixed fills the rest.
 */
export function selectVideos(
  videos: ApifyVideoItem[],
  manualVideos: ApifyVideoItem[],
  opts: SelectionOptions,
): SelectionResult {
  const maxDur = opts.maxDurationSeconds ?? 60 * 90; // skip > 90min
  const minDur = opts.minDurationSeconds ?? 60; // skip < 60s
  const tooLong = videos.filter(
    (v) => v.durationSeconds != null && v.durationSeconds > maxDur,
  );
  const tooShort = videos.filter(
    (v) => v.durationSeconds != null && v.durationSeconds < minDur,
  );
  const eligible = videos.filter(
    (v) =>
      (v.durationSeconds == null || v.durationSeconds <= maxDur) &&
      (v.durationSeconds == null || v.durationSeconds >= minDur),
  );

  const notes: string[] = [];

  // Start with manual picks (always honored).
  const picked: ApifyVideoItem[] = [];
  const seen = new Set<string>();
  for (const m of manualVideos) {
    if (seen.has(m.id)) continue;
    picked.push(m);
    seen.add(m.id);
  }

  const remaining = Math.max(0, opts.count - picked.length);
  const candidates = eligible.filter((v) => !seen.has(v.id));

  let ordered: ApifyVideoItem[] = [];
  switch (opts.mode) {
    case "top":
      ordered = sortByViews(candidates);
      break;
    case "recent":
      ordered = sortByDate(candidates);
      break;
    case "manual":
      // For pure manual mode, we ONLY include manual picks — but if the user
      // asked for more than provided, fall back to top to fill.
      ordered = [];
      if (picked.length < opts.count) {
        notes.push("manual mode supplied fewer URLs than requested; filling with top-viewed");
        ordered = sortByViews(candidates);
      }
      break;
    case "mixed":
      // The plan's default: 2 top + 2 recent + 1 manual (already added).
      ordered = mix(sortByViews(candidates), sortByDate(candidates), remaining);
      break;
  }

  for (const v of ordered) {
    if (picked.length >= opts.count) break;
    if (seen.has(v.id)) continue;
    picked.push(v);
    seen.add(v.id);
  }

  if (picked.length < opts.count) {
    notes.push(
      `requested ${opts.count} videos but only ${picked.length} eligible after filtering`,
    );
  }

  return {
    picked,
    skippedTooLong: tooLong,
    skippedTooShort: tooShort,
    notes,
  };
}

function sortByViews(items: ApifyVideoItem[]): ApifyVideoItem[] {
  return [...items].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
}

function sortByDate(items: ApifyVideoItem[]): ApifyVideoItem[] {
  return [...items].sort((a, b) => {
    const aT = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bT = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return bT - aT;
  });
}

function mix(
  top: ApifyVideoItem[],
  recent: ApifyVideoItem[],
  count: number,
): ApifyVideoItem[] {
  const out: ApifyVideoItem[] = [];
  const seen = new Set<string>();
  let i = 0;
  let j = 0;
  while (out.length < count && (i < top.length || j < recent.length)) {
    // Alternate top/recent. Top first.
    if (i < top.length) {
      const t = top[i++]!;
      if (!seen.has(t.id)) {
        out.push(t);
        seen.add(t.id);
      }
    }
    if (out.length >= count) break;
    if (j < recent.length) {
      const r = recent[j++]!;
      if (!seen.has(r.id)) {
        out.push(r);
        seen.add(r.id);
      }
    }
  }
  return out;
}
