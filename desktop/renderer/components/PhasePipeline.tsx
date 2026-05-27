import React, { useState } from "react";
import type {
  Phase,
  PhaseProgressEvent,
  PhaseRunResult,
  ProjectSnapshot,
} from "../../../src/desktop/api-types.js";

interface Props {
  snapshot: ProjectSnapshot;
  progressLog: PhaseProgressEvent[];
  onRefresh: () => Promise<void> | void;
}

interface StageDef {
  phase: Phase;
  label: string;
  status: () => { state: "ok" | "warn" | "missing"; text: string };
  canRun: boolean;
}

export const PhasePipeline: React.FC<Props> = ({
  snapshot,
  progressLog,
  onRefresh,
}) => {
  const [running, setRunning] = useState<Phase | null>(null);
  const [lastResult, setLastResult] = useState<PhaseRunResult | null>(null);
  const info = snapshot.info;

  const stages: StageDef[] = [
    {
      phase: "plan",
      label: "2. Scene Planner",
      status: () =>
        info.hasScenePlan
          ? { state: "ok", text: `${snapshot.scenePlan?.totals.beats ?? 0} beats` }
          : { state: "missing", text: "not yet run" },
      canRun: info.hasScript && info.hasVoiceover,
    },
    {
      phase: "source",
      label: "3. Asset Sourcing",
      status: () =>
        info.hasCandidates
          ? {
              state: "ok",
              text: `${snapshot.candidates?.totals.images ?? 0} images · ${snapshot.candidates?.totals.clips ?? 0} clips`,
            }
          : { state: "missing", text: "not yet run" },
      canRun: info.hasScenePlan,
    },
    {
      phase: "review",
      label: "4. Visual Quality Checker",
      status: () =>
        info.hasReview
          ? {
              state:
                snapshot.review &&
                snapshot.review.totals.scenes_without_accepted > 0
                  ? "warn"
                  : "ok",
              text: `${snapshot.review?.totals.accepted ?? 0}/${snapshot.review?.totals.candidates ?? 0} accepted` +
                (snapshot.review?.totals.scenes_without_accepted
                  ? ` · ${snapshot.review.totals.scenes_without_accepted} need attention`
                  : ""),
            }
          : { state: "missing", text: "not yet run" },
      canRun: info.hasCandidates,
    },
    {
      phase: "build-timeline",
      label: "5. Timeline Builder",
      status: () =>
        info.hasTimeline
          ? {
              state:
                snapshot.timeline && snapshot.timeline.warnings.length > 0
                  ? "warn"
                  : "ok",
              text: `${snapshot.timeline?.visuals.length ?? 0} visuals` +
                (snapshot.timeline?.warnings.length
                  ? ` · ${snapshot.timeline.warnings.length} warnings`
                  : ""),
            }
          : { state: "missing", text: "not yet run" },
      canRun: info.hasReview,
    },
    {
      phase: "render",
      label: "6. Render",
      status: () =>
        info.exports.length > 0
          ? { state: "ok", text: `${info.exports.length} export(s)` }
          : { state: "missing", text: "not yet rendered" },
      canRun: info.hasTimeline,
    },
  ];

  const run = async (phase: Phase) => {
    setRunning(phase);
    setLastResult(null);
    try {
      const res = await window.vibe.runPhase(info.slug, phase);
      setLastResult(res);
    } finally {
      setRunning(null);
      void onRefresh();
    }
  };

  return (
    <>
      <div className="pipeline">
        {!info.hasScript || !info.hasVoiceover ? (
          <div className="warning-banner">
            Missing inputs:
            {!info.hasScript ? " script" : ""}
            {!info.hasScript && !info.hasVoiceover ? "," : ""}
            {!info.hasVoiceover ? " voiceover" : ""}. Re-create the project
            or drop files into <code>{info.slug}/input/</code>.
          </div>
        ) : null}

        {stages.map((s) => {
          const st = s.status();
          const isRunning = running === s.phase;
          const ctaLabel =
            st.state === "ok"
              ? s.phase === "render"
                ? "Re-render"
                : "Re-run"
              : "Run";
          return (
            <div className="stage" key={s.phase}>
              <div>
                <div className="stage-name">{s.label}</div>
                <div
                  className={`stage-status ${
                    st.state === "ok" ? "ok" : st.state === "warn" ? "warn" : ""
                  }`}
                >
                  {st.text}
                </div>
              </div>
              <div />
              <button
                className="run primary"
                disabled={!s.canRun || isRunning || running !== null}
                onClick={() => void run(s.phase)}
              >
                {isRunning ? "Running…" : ctaLabel}
              </button>
            </div>
          );
        })}
      </div>

      {lastResult ? (
        <div
          className={
            "warning-banner " +
            (lastResult.ok ? "" : "")
          }
          style={{
            background: lastResult.ok ? "#102a13" : "#2a1010",
            borderLeftColor: lastResult.ok ? "var(--ok)" : "var(--err)",
            color: lastResult.ok ? "var(--ok)" : "var(--err)",
            marginTop: 12,
          }}
        >
          {lastResult.ok ? "✓" : "✗"} {lastResult.phase}: {lastResult.message}
          {lastResult.outputPath ? (
            <>
              {" — "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  void window.vibe.revealInFolder(lastResult.outputPath!);
                }}
              >
                reveal in folder
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="log">
        {progressLog.length === 0 ? (
          <span style={{ color: "var(--muted)" }}>
            (no progress yet — run a phase)
          </span>
        ) : (
          progressLog.slice(-100).map((e, i) => (
            <div key={i} className={e.level}>
              [{e.phase}] {e.text}
            </div>
          ))
        )}
      </div>
    </>
  );
};
