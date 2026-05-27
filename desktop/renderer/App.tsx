import React, { useCallback, useEffect, useState } from "react";
import type {
  ChannelInfo,
  PhaseProgressEvent,
  ProjectInfo,
  ProjectSnapshot,
} from "../../src/desktop/api-types.js";
import { Sidebar } from "./components/Sidebar.js";
import { CreateProjectModal } from "./components/CreateProjectModal.js";
import { ProjectWorkspace } from "./components/ProjectWorkspace.js";
import { EmptyState } from "./components/EmptyState.js";

export const App: React.FC = () => {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [progressLog, setProgressLog] = useState<PhaseProgressEvent[]>([]);
  const [loadingProject, setLoadingProject] = useState(false);

  const refreshSidebar = useCallback(async () => {
    const [ch, pj] = await Promise.all([
      window.vibe.listChannels(),
      window.vibe.listProjects(),
    ]);
    setChannels(ch);
    setProjects(pj);
    return { channels: ch, projects: pj };
  }, []);

  const refreshActiveProject = useCallback(async () => {
    if (!activeSlug) {
      setSnapshot(null);
      return;
    }
    setLoadingProject(true);
    try {
      const snap = await window.vibe.loadProject(activeSlug);
      setSnapshot(snap);
    } catch (e) {
      console.error(e);
      setSnapshot(null);
    } finally {
      setLoadingProject(false);
    }
  }, [activeSlug]);

  useEffect(() => {
    void refreshSidebar();
  }, [refreshSidebar]);

  useEffect(() => {
    void refreshActiveProject();
  }, [refreshActiveProject]);

  useEffect(() => {
    const unsub = window.vibe.onPhaseProgress((event) => {
      setProgressLog((prev) => [...prev.slice(-300), event]);
    });
    return unsub;
  }, []);

  return (
    <div className="app">
      <Sidebar
        channels={channels}
        projects={projects}
        activeSlug={activeSlug}
        onSelect={setActiveSlug}
        onNewProject={() => setCreateOpen(true)}
      />

      {snapshot ? (
        <ProjectWorkspace
          snapshot={snapshot}
          progressLog={progressLog.filter(
            (e) => e.projectSlug === snapshot.info.slug,
          )}
          loading={loadingProject}
          onRefresh={async () => {
            await refreshSidebar();
            await refreshActiveProject();
          }}
        />
      ) : (
        <EmptyState
          hasChannels={channels.length > 0}
          hasProjects={projects.length > 0}
          onNewProject={() => setCreateOpen(true)}
        />
      )}

      {createOpen ? (
        <CreateProjectModal
          channels={channels.filter((c) => c.hasProfile)}
          onClose={() => setCreateOpen(false)}
          onCreated={async (info) => {
            setCreateOpen(false);
            const { projects: next } = await refreshSidebar();
            const created = next.find((p) => p.slug === info.slug);
            setActiveSlug(created?.slug ?? null);
          }}
        />
      ) : null}
    </div>
  );
};
