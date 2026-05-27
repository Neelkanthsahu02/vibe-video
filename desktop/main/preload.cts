// CommonJS preload — runs before the renderer page loads. Exposes a
// narrow IPC bridge under window.vibe and nothing else.
/* eslint-disable @typescript-eslint/no-require-imports */
import type {
  CreateProjectArgs,
  ManualReplaceArgs,
  Phase,
  PhaseProgressEvent,
  PhaseRunOptions,
  VibeApi,
} from "../../src/desktop/api-types.js";

// `require` is OK in a .cts file — we set "type": "module" at the package
// level but Electron's preload loads CJS by default for contextIsolation.
const electron = require("electron") as {
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => void;
  };
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (
      channel: string,
      cb: (event: unknown, payload: unknown) => void,
    ) => void;
    removeListener: (
      channel: string,
      cb: (event: unknown, payload: unknown) => void,
    ) => void;
  };
};

const { contextBridge, ipcRenderer } = electron;

const api: VibeApi = {
  listChannels: () =>
    ipcRenderer.invoke("vibe:list-channels") as ReturnType<VibeApi["listChannels"]>,
  listProjects: () =>
    ipcRenderer.invoke("vibe:list-projects") as ReturnType<VibeApi["listProjects"]>,
  loadProject: (slug: string) =>
    ipcRenderer.invoke("vibe:load-project", slug) as ReturnType<VibeApi["loadProject"]>,
  createProject: (args: CreateProjectArgs) =>
    ipcRenderer.invoke("vibe:create-project", args) as ReturnType<VibeApi["createProject"]>,
  runPhase: (
    projectSlug: string,
    phase: Phase,
    options?: PhaseRunOptions,
  ) =>
    ipcRenderer.invoke(
      "vibe:run-phase",
      projectSlug,
      phase,
      options,
    ) as ReturnType<VibeApi["runPhase"]>,
  replaceAsset: (args: ManualReplaceArgs) =>
    ipcRenderer.invoke("vibe:replace-asset", args) as ReturnType<VibeApi["replaceAsset"]>,
  setAssetVerdict: (
    projectSlug: string,
    sceneId: string,
    assetId: string,
    accept: boolean,
  ) =>
    ipcRenderer.invoke(
      "vibe:set-verdict",
      projectSlug,
      sceneId,
      assetId,
      accept,
    ) as ReturnType<VibeApi["setAssetVerdict"]>,
  pickFile: (
    title: string,
    filters?: { name: string; extensions: string[] }[],
  ) =>
    ipcRenderer.invoke("vibe:pick-file", title, filters) as ReturnType<VibeApi["pickFile"]>,
  openExport: (_projectSlug: string, filename: string) =>
    ipcRenderer.invoke("vibe:open-path", filename) as ReturnType<VibeApi["openExport"]>,
  revealInFolder: (absolutePath: string) =>
    ipcRenderer.invoke("vibe:reveal", absolutePath) as ReturnType<VibeApi["revealInFolder"]>,
  toFileUrl: (absolutePath: string): string => {
    // Computed in-process so React renders can resolve URLs synchronously.
    return `file://${absolutePath.replace(/\\/g, "/").replace(/ /g, "%20")}`;
  },
  onPhaseProgress: (cb: (event: PhaseProgressEvent) => void) => {
    const handler = (_event: unknown, payload: unknown) =>
      cb(payload as PhaseProgressEvent);
    ipcRenderer.on("vibe:phase-progress", handler);
    return () => ipcRenderer.removeListener("vibe:phase-progress", handler);
  },
};

contextBridge.exposeInMainWorld("vibe", api);
