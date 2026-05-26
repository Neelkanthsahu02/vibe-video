import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { ensureDir, slugify, fileExists } from "../utils/paths.js";
import type { ChannelStyleProfile } from "../schemas/channelStyleProfile.js";

export interface ProjectPaths {
  projectName: string;
  projectSlug: string;
  projectDir: string;
  inputDir: string;
  scriptPath: string;
  voiceoverPath: string;
  planDir: string;
  scenePlanJson: string;
  transcriptJson: string;
  alignmentJson: string;
  assetsDir: string;
  candidatesImagesDir: string;
  candidatesClipsDir: string;
  approvedImagesDir: string;
  approvedClipsDir: string;
  rejectedDir: string;
  renderDir: string;
  exportsDir: string;
  cacheDir: string;
}

export async function resolveProjectPaths(
  projectName: string,
  overrides: { scriptPath?: string; voiceoverPath?: string } = {},
): Promise<ProjectPaths> {
  const projectSlug = slugify(projectName);
  const projectDir = path.join(config.projectsDir, projectSlug);
  const inputDir = path.join(projectDir, "input");
  const planDir = path.join(projectDir, "plan");
  const assetsDir = path.join(projectDir, "assets");
  const candidatesDir = path.join(assetsDir, "candidates");
  const approvedDir = path.join(assetsDir, "approved");
  const cacheDir = path.join(projectDir, "cache");

  await Promise.all([
    ensureDir(projectDir),
    ensureDir(inputDir),
    ensureDir(planDir),
    ensureDir(path.join(candidatesDir, "images")),
    ensureDir(path.join(candidatesDir, "clips")),
    ensureDir(path.join(approvedDir, "images")),
    ensureDir(path.join(approvedDir, "clips")),
    ensureDir(path.join(assetsDir, "rejected")),
    ensureDir(path.join(projectDir, "render")),
    ensureDir(path.join(projectDir, "exports")),
    ensureDir(cacheDir),
  ]);

  const scriptPath = overrides.scriptPath
    ? path.resolve(overrides.scriptPath)
    : path.join(inputDir, "script.txt");
  const voiceoverPath = overrides.voiceoverPath
    ? path.resolve(overrides.voiceoverPath)
    : await findVoiceover(inputDir);

  return {
    projectName,
    projectSlug,
    projectDir,
    inputDir,
    scriptPath,
    voiceoverPath,
    planDir,
    scenePlanJson: path.join(planDir, "scene_plan.json"),
    transcriptJson: path.join(planDir, "transcript.json"),
    alignmentJson: path.join(planDir, "script_alignment.json"),
    assetsDir,
    candidatesImagesDir: path.join(candidatesDir, "images"),
    candidatesClipsDir: path.join(candidatesDir, "clips"),
    approvedImagesDir: path.join(approvedDir, "images"),
    approvedClipsDir: path.join(approvedDir, "clips"),
    rejectedDir: path.join(assetsDir, "rejected"),
    renderDir: path.join(projectDir, "render"),
    exportsDir: path.join(projectDir, "exports"),
    cacheDir,
  };
}

async function findVoiceover(inputDir: string): Promise<string> {
  const exts = ["voiceover.wav", "voiceover.mp3", "voiceover.m4a", "voiceover.flac"];
  for (const f of exts) {
    const p = path.join(inputDir, f);
    if (await fileExists(p)) return p;
  }
  return path.join(inputDir, "voiceover.wav");
}

export async function loadStyleProfile(
  channelSlug: string,
): Promise<{ profilePath: string; profile: ChannelStyleProfile }> {
  const profilePath = path.join(
    config.styleLibraryDir,
    channelSlug,
    "channel_style_profile.json",
  );
  if (!(await fileExists(profilePath))) {
    throw new Error(
      `channel_style_profile.json not found at ${profilePath}. Run \`vibe build-profile -c <channel>\` first.`,
    );
  }
  const raw = await fs.readFile(profilePath, "utf-8");
  return {
    profilePath,
    profile: JSON.parse(raw) as ChannelStyleProfile,
  };
}

export async function readScript(scriptPath: string): Promise<string> {
  if (!(await fileExists(scriptPath))) {
    throw new Error(`script not found at ${scriptPath}`);
  }
  const raw = await fs.readFile(scriptPath, "utf-8");
  return raw.trim();
}
