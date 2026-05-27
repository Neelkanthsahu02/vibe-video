import crypto from "node:crypto";
import type { IpcMain, BrowserWindow } from "electron";
import {
  createProject,
  listChannels,
  listProjects,
  loadProject,
  replaceAsset,
  runPhase,
  setAssetVerdict,
} from "./api.js";
import type {
  CreateProjectArgs,
  ManualReplaceArgs,
  Phase,
  PhaseProgressEvent,
  PhaseRunOptions,
} from "../../src/desktop/api-types.js";

export function registerIpcHandlers(
  ipc: IpcMain,
  getWindow: () => BrowserWindow | null,
): void {
  ipc.handle("vibe:list-channels", () => listChannels());
  ipc.handle("vibe:list-projects", () => listProjects());
  ipc.handle("vibe:load-project", (_e, slug: string) => loadProject(slug));
  ipc.handle("vibe:create-project", (_e, args: CreateProjectArgs) =>
    createProject(args),
  );
  ipc.handle(
    "vibe:run-phase",
    async (
      _e,
      projectSlug: string,
      phase: Phase,
      options: PhaseRunOptions | undefined,
    ) => {
      const runId = crypto.randomUUID();
      const win = getWindow();
      const emit = (level: PhaseProgressEvent["level"], text: string) => {
        const event: PhaseProgressEvent = {
          runId,
          phase,
          projectSlug,
          level,
          text,
          at: new Date().toISOString(),
        };
        win?.webContents.send("vibe:phase-progress", event);
      };
      return runPhase(projectSlug, phase, options, emit);
    },
  );
  ipc.handle("vibe:replace-asset", (_e, args: ManualReplaceArgs) =>
    replaceAsset(args),
  );
  ipc.handle(
    "vibe:set-verdict",
    (
      _e,
      projectSlug: string,
      sceneId: string,
      assetId: string,
      accept: boolean,
    ) => setAssetVerdict(projectSlug, sceneId, assetId, accept),
  );
}
