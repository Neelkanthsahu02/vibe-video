import React from "react";

interface Props {
  hasChannels: boolean;
  hasProjects: boolean;
  onNewProject: () => void;
}

export const EmptyState: React.FC<Props> = ({
  hasChannels,
  hasProjects,
  onNewProject,
}) => {
  return (
    <main className="workspace">
      <div className="workspace-body">
        <div className="empty-state">
          <h2>Welcome to vibe-video</h2>
          {!hasChannels ? (
            <p style={{ maxWidth: 520, margin: "12px auto" }}>
              Phase 1 first. From a terminal, run{" "}
              <code>vibe analyze-dir -c "SpillRumors" -i ./downloads/spillrumors --recursive</code>{" "}
              and then{" "}
              <code>vibe build-profile -c "SpillRumors"</code> to create a
              channel Style Library. Once it shows up in the sidebar, you can
              create a project here.
            </p>
          ) : !hasProjects ? (
            <>
              <p style={{ maxWidth: 520, margin: "12px auto" }}>
                Style Library is ready. Create a project to feed it a script
                and voiceover, then drive Phases 2–6 from this window.
              </p>
              <button className="primary" onClick={onNewProject}>
                Create project
              </button>
            </>
          ) : (
            <p>Pick a project from the sidebar.</p>
          )}
        </div>
      </div>
    </main>
  );
};
