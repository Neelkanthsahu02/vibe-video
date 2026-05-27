import React, { useMemo, useState } from "react";
import type {
  PhaseProgressEvent,
  ProjectSnapshot,
} from "../../../src/desktop/api-types.js";
import { PhasePipeline } from "./PhasePipeline.js";
import { ScenesView } from "./ScenesView.js";
import { ExportsView } from "./ExportsView.js";

interface Props {
  snapshot: ProjectSnapshot;
  progressLog: PhaseProgressEvent[];
  loading: boolean;
  onRefresh: () => Promise<void> | void;
}

type Tab = "pipeline" | "scenes" | "exports";

export const ProjectWorkspace: React.FC<Props> = ({
  snapshot,
  progressLog,
  loading,
  onRefresh,
}) => {
  const [tab, setTab] = useState<Tab>("pipeline");
  const info = snapshot.info;

  const tabs: { key: Tab; label: string; disabled?: boolean }[] = useMemo(
    () => [
      { key: "pipeline", label: "Pipeline" },
      { key: "scenes", label: "Scenes & Assets", disabled: !snapshot.scenePlan },
      { key: "exports", label: "Exports" },
    ],
    [snapshot.scenePlan],
  );

  return (
    <main className="workspace">
      <div className="workspace-header">
        <div>
          <h2>{info.name}</h2>
          <div className="channel">
            channel: {info.channelSlug ?? "(none)"} · slug: {info.slug}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void onRefresh()} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="workspace-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            disabled={t.disabled}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="workspace-body">
        {tab === "pipeline" ? (
          <PhasePipeline
            snapshot={snapshot}
            progressLog={progressLog}
            onRefresh={onRefresh}
          />
        ) : null}
        {tab === "scenes" ? (
          <ScenesView snapshot={snapshot} onRefresh={onRefresh} />
        ) : null}
        {tab === "exports" ? <ExportsView snapshot={snapshot} /> : null}
      </div>
    </main>
  );
};
