import React from "react";
import type { ChannelInfo, ProjectInfo } from "../../../src/desktop/api-types.js";

interface Props {
  channels: ChannelInfo[];
  projects: ProjectInfo[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  onNewProject: () => void;
}

export const Sidebar: React.FC<Props> = ({
  channels,
  projects,
  activeSlug,
  onSelect,
  onNewProject,
}) => {
  return (
    <aside className="sidebar">
      <header>
        <h1>vibe-video</h1>
        <span className="tag">phase 1–7</span>
      </header>

      <div className="section-title">
        <span>Channels</span>
        <span>{channels.length}</span>
      </div>
      {channels.length === 0 ? (
        <div className="empty">
          Run <code>vibe build-profile</code> to create one.
        </div>
      ) : (
        channels.map((c) => (
          <div key={c.slug} className="item">
            <div>{c.name}</div>
            <div className="sub">
              {c.videoCount} videos · {c.hasProfile ? "profile ready" : "no profile"}
            </div>
          </div>
        ))
      )}

      <div className="section-title">
        <span>Projects</span>
        <button
          style={{
            background: "transparent",
            border: "none",
            color: "var(--accent)",
            padding: 0,
          }}
          onClick={onNewProject}
        >
          + new
        </button>
      </div>
      {projects.length === 0 ? (
        <div className="empty">No projects yet. Create one to begin.</div>
      ) : (
        projects.map((p) => (
          <div
            key={p.slug}
            className={`item ${activeSlug === p.slug ? "active" : ""}`}
            onClick={() => onSelect(p.slug)}
          >
            <div>{p.name}</div>
            <div className="sub">
              {p.channelSlug ?? "no channel"} ·{" "}
              {p.exports.length > 0
                ? `${p.exports.length} export${p.exports.length === 1 ? "" : "s"}`
                : "no exports"}
            </div>
          </div>
        ))
      )}
    </aside>
  );
};
