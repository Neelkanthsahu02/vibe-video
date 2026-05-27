/* Types shared between the Electron main process and the renderer. */
import type { ScenePlan } from "../schemas/scenePlan.js";
import type { CandidateManifest } from "../schemas/assetCandidates.js";
import type { AssetReview } from "../schemas/assetReview.js";
import type { Timeline } from "../schemas/timeline.js";
import type { ChannelStyleProfile } from "../schemas/channelStyleProfile.js";

export interface ChannelInfo {
  slug: string;
  name: string;
  hasProfile: boolean;
  videoCount: number;
  profilePath: string | null;
}

export interface ProjectInfo {
  slug: string;
  name: string;
  channelSlug: string | null;
  hasScript: boolean;
  hasVoiceover: boolean;
  scriptPath: string | null;
  voiceoverPath: string | null;
  hasScenePlan: boolean;
  hasCandidates: boolean;
  hasReview: boolean;
  hasTimeline: boolean;
  exportsDir: string;
  /** Absolute paths to rendered MP4s under exportsDir. */
  exports: string[];
  createdAtIso: string | null;
}

export type Phase =
  | "plan"
  | "source"
  | "review"
  | "build-timeline"
  | "render";

export interface PhaseRunOptions {
  /** For "render" only: optional [startSec, endSec] preview window. */
  rangeSeconds?: { start: number; end: number };
  /** For "render" only: overwrite existing output. */
  overwrite?: boolean;
  /** For "review" only: re-review just these scenes. */
  sceneIds?: string[];
  /** For most phases: regenerate even if cached. */
  force?: boolean;
}

export interface PhaseRunResult {
  ok: boolean;
  phase: Phase;
  message: string;
  outputPath?: string;
  warnings?: string[];
  durationMs: number;
}

export interface PhaseProgressEvent {
  runId: string;
  phase: Phase;
  projectSlug: string;
  level: "info" | "warn" | "error";
  text: string;
  at: string;
}

export interface ManualReplaceArgs {
  projectSlug: string;
  sceneId: string;
  /** Path on disk the user dropped/picked. We'll copy it into the project. */
  sourcePath: string;
  /** If true, also write an asset_review override marking this asset accepted. */
  markAccepted: boolean;
}

export interface ManualReplaceResult {
  newAssetId: string;
  newLocalPath: string;
  scenePlanUpdated: boolean;
  reviewUpdated: boolean;
  candidatesUpdated: boolean;
}

export interface CreateProjectArgs {
  name: string;
  channelSlug: string;
  scriptSource:
    | { kind: "path"; path: string }
    | { kind: "text"; text: string };
  voiceoverSource: { kind: "path"; path: string };
}

export interface OpenDialogResult {
  cancelled: boolean;
  path: string | null;
}

/** Snapshot of every JSON that the renderer needs to show a project. */
export interface ProjectSnapshot {
  info: ProjectInfo;
  scenePlan: ScenePlan | null;
  candidates: CandidateManifest | null;
  review: AssetReview | null;
  timeline: Timeline | null;
  channelProfile: ChannelStyleProfile | null;
}

export interface VibeApi {
  listChannels(): Promise<ChannelInfo[]>;
  listProjects(): Promise<ProjectInfo[]>;
  createProject(args: CreateProjectArgs): Promise<ProjectInfo>;
  loadProject(projectSlug: string): Promise<ProjectSnapshot>;
  runPhase(
    projectSlug: string,
    phase: Phase,
    options?: PhaseRunOptions,
  ): Promise<PhaseRunResult>;
  replaceAsset(args: ManualReplaceArgs): Promise<ManualReplaceResult>;
  setAssetVerdict(
    projectSlug: string,
    sceneId: string,
    assetId: string,
    accept: boolean,
  ): Promise<void>;
  pickFile(
    title: string,
    filters?: { name: string; extensions: string[] }[],
  ): Promise<OpenDialogResult>;
  openExport(projectSlug: string, filename: string): Promise<void>;
  revealInFolder(absolutePath: string): Promise<void>;
  /** Subscribe to progress events for the given project. Returns an
   *  unsubscribe function. */
  onPhaseProgress(
    cb: (event: PhaseProgressEvent) => void,
  ): () => void;
  /** Returns a file:// URL the renderer can plug into <img> / <video>. */
  toFileUrl(absolutePath: string): string;
}

declare global {
  interface Window {
    vibe: VibeApi;
  }
}
