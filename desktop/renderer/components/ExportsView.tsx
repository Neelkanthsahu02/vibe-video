import React from "react";
import type { ProjectSnapshot } from "../../../src/desktop/api-types.js";

interface Props {
  snapshot: ProjectSnapshot;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export const ExportsView: React.FC<Props> = ({ snapshot }) => {
  const exports = snapshot.info.exports;
  if (exports.length === 0) {
    return (
      <div className="empty-state">
        No renders yet. Run Phase 6 from the Pipeline tab.
      </div>
    );
  }
  return (
    <div className="exports-list">
      {exports.map((absolute) => (
        <div className="item" key={absolute}>
          <div>
            <div>{basename(absolute)}</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{absolute}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => void window.vibe.revealInFolder(absolute)}>
              Reveal
            </button>
            <button
              className="primary"
              onClick={() => {
                const w = window.open(window.vibe.toFileUrl(absolute), "_blank");
                if (!w) void window.vibe.revealInFolder(absolute);
              }}
            >
              Open
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
