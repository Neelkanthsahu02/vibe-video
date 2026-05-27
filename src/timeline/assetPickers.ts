import type { ScenePlanBeat } from "../schemas/scenePlan.js";
import type { CandidateAsset, SceneCandidates } from "../schemas/assetCandidates.js";
import type { AssetReviewEntry, SceneReview } from "../schemas/assetReview.js";

export interface PickedVisual {
  candidate: CandidateAsset | null;
  review: AssetReviewEntry | null;
  reason: string;
}

/**
 * Choose the best approved candidate for a beat:
 *   1. asset_review.best_asset_id, if accepted
 *   2. else the highest-scoring accepted entry
 *   3. else the highest-scoring entry of any verdict (fallback)
 *   4. else null with a warning reason
 */
export function pickVisualForBeat(
  beat: ScenePlanBeat,
  sceneCandidates: SceneCandidates | undefined,
  sceneReview: SceneReview | undefined,
): PickedVisual {
  if (!sceneCandidates || sceneCandidates.candidates.length === 0) {
    return { candidate: null, review: null, reason: "no candidates sourced" };
  }
  if (!sceneReview || sceneReview.entries.length === 0) {
    // Use the first candidate without a review (rare path)
    return {
      candidate: sceneCandidates.candidates[0] ?? null,
      review: null,
      reason: "no review yet — using first candidate",
    };
  }
  const candidateById = new Map(
    sceneCandidates.candidates.map((c) => [c.asset_id, c]),
  );
  const entryById = new Map(sceneReview.entries.map((e) => [e.asset_id, e]));

  if (sceneReview.best_asset_id) {
    const entry = entryById.get(sceneReview.best_asset_id);
    const cand = candidateById.get(sceneReview.best_asset_id);
    if (entry && cand && entry.accept_or_reject === "accept") {
      return { candidate: cand, review: entry, reason: "best_asset_id" };
    }
  }

  const accepted = sceneReview.entries.filter(
    (e) => e.accept_or_reject === "accept",
  );
  if (accepted.length > 0) {
    const top = accepted
      .slice()
      .sort(
        (a, b) =>
          b.relevance_score * 0.55 +
          b.quality_score * 0.25 +
          b.emotional_tone_match * 0.2 -
          (a.relevance_score * 0.55 +
            a.quality_score * 0.25 +
            a.emotional_tone_match * 0.2),
      )[0]!;
    return {
      candidate: candidateById.get(top.asset_id) ?? null,
      review: top,
      reason: "top accepted entry",
    };
  }

  // No accepts — pick the highest-scoring rejected as a fallback so the
  // beat has *something*, and surface a warning upstream.
  const fallback = sceneReview.entries
    .slice()
    .sort(
      (a, b) =>
        b.relevance_score * 0.55 +
        b.quality_score * 0.25 +
        b.emotional_tone_match * 0.2 -
        (a.relevance_score * 0.55 +
          a.quality_score * 0.25 +
          a.emotional_tone_match * 0.2),
    )[0]!;
  return {
    candidate: candidateById.get(fallback.asset_id) ?? null,
    review: fallback,
    reason: "all candidates rejected — fallback used",
  };
}

void function ensureBeatTypeReferenced(_: ScenePlanBeat) {
  // Forces tsc to retain the import for downstream consumers.
};
