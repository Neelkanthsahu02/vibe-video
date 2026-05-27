import React, { useMemo, useState } from "react";
import type {
  ProjectSnapshot,
} from "../../../src/desktop/api-types.js";
import type { CandidateAsset } from "../../../src/schemas/assetCandidates.js";
import type { AssetReviewEntry } from "../../../src/schemas/assetReview.js";
import type { ScenePlanBeat } from "../../../src/schemas/scenePlan.js";

interface Props {
  snapshot: ProjectSnapshot;
  onRefresh: () => Promise<void> | void;
}

interface SceneRow {
  beat: ScenePlanBeat;
  candidates: CandidateAsset[];
  entries: AssetReviewEntry[];
  bestAssetId: string | null;
}

export const ScenesView: React.FC<Props> = ({ snapshot, onRefresh }) => {
  const [busy, setBusy] = useState<string | null>(null);

  const rows: SceneRow[] = useMemo(() => {
    if (!snapshot.scenePlan) return [];
    const candidatesBySceneId = new Map(
      (snapshot.candidates?.scenes ?? []).map((s) => [s.scene_id, s.candidates]),
    );
    const reviewBySceneId = new Map(
      (snapshot.review?.scenes ?? []).map((s) => [s.scene_id, s]),
    );
    return snapshot.scenePlan.beats.map((beat) => ({
      beat,
      candidates: candidatesBySceneId.get(beat.scene_id) ?? [],
      entries: reviewBySceneId.get(beat.scene_id)?.entries ?? [],
      bestAssetId:
        reviewBySceneId.get(beat.scene_id)?.best_asset_id ?? null,
    }));
  }, [snapshot]);

  const onVerdict = async (
    sceneId: string,
    assetId: string,
    accept: boolean,
  ) => {
    setBusy(`${sceneId}:${assetId}`);
    try {
      await window.vibe.setAssetVerdict(
        snapshot.info.slug,
        sceneId,
        assetId,
        accept,
      );
      await onRefresh();
    } finally {
      setBusy(null);
    }
  };

  const onReplace = async (sceneId: string) => {
    const picked = await window.vibe.pickFile(
      `Replacement asset for ${sceneId}`,
      [
        {
          name: "Image or clip",
          extensions: ["jpg", "jpeg", "png", "webp", "mp4", "mov", "webm"],
        },
      ],
    );
    if (picked.cancelled || !picked.path) return;
    setBusy(`replace:${sceneId}`);
    try {
      await window.vibe.replaceAsset({
        projectSlug: snapshot.info.slug,
        sceneId,
        sourcePath: picked.path,
        markAccepted: true,
      });
      await onRefresh();
    } finally {
      setBusy(null);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        No scene plan yet. Run Phase 2 first.
      </div>
    );
  }

  return (
    <div className="scene-list">
      {rows.map(({ beat, candidates, entries, bestAssetId }) => {
        const entryById = new Map(entries.map((e) => [e.asset_id, e]));
        return (
          <div key={beat.scene_id} className="scene-card">
            <header>
              <strong>
                {beat.scene_id} · {beat.script_function} ·{" "}
                {beat.emotional_tone}
              </strong>
              <span className="meta">
                {beat.start_time.toFixed(2)}–{beat.end_time.toFixed(2)}s ·{" "}
                {beat.duration.toFixed(2)}s · asset:{" "}
                {beat.asset_type_needed}
              </span>
            </header>
            <div className="narration">"{beat.narration_text}"</div>
            <div className="meta">
              <strong>visual goal:</strong> {beat.visual_goal}
            </div>
            <div className="meta">
              <strong>style rule:</strong> {beat.style_library_rule_used}
            </div>

            {candidates.length === 0 ? (
              <div className="meta" style={{ marginTop: 10 }}>
                no candidates yet — run Phase 3 (Source).
              </div>
            ) : (
              <div className="thumbs">
                {candidates.map((c) => {
                  const entry = entryById.get(c.asset_id);
                  const verdict = entry?.accept_or_reject;
                  const isBest = c.asset_id === bestAssetId;
                  const cls = `thumb ${
                    verdict === "accept" ? "accepted" : verdict === "reject" ? "rejected" : ""
                  }`;
                  const url = window.vibe.toFileUrl(c.local_path);
                  return (
                    <div className={cls} key={c.asset_id}>
                      {c.kind === "image" ? (
                        <img src={url} alt={c.title ?? c.asset_id} />
                      ) : (
                        <video src={url} muted preload="metadata" />
                      )}
                      <span className="badge">
                        {isBest ? "★ " : ""}
                        {c.kind} · {c.source}
                      </span>
                      <div className="actions">
                        <button
                          className="accept"
                          disabled={busy !== null}
                          onClick={() =>
                            void onVerdict(beat.scene_id, c.asset_id, true)
                          }
                          title={entry?.reason ?? ""}
                        >
                          ✓
                        </button>
                        <button
                          className="reject"
                          disabled={busy !== null}
                          onClick={() =>
                            void onVerdict(beat.scene_id, c.asset_id, false)
                          }
                        >
                          ✗
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button
                disabled={busy !== null}
                onClick={() => void onReplace(beat.scene_id)}
              >
                Replace…
              </button>
              {beat.image_search_queries.length > 0 ? (
                <span className="meta" style={{ alignSelf: "center" }}>
                  queries: {beat.image_search_queries.join(" · ").slice(0, 100)}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};
