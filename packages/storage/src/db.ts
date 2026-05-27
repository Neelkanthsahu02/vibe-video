/* Minimal SQLite store using node:sqlite (available in Node 22 LTS).
 * Stores: presets index, projects index, run history.
 * All heavy artifacts stay on disk as JSON; this is purely an index. */
import path from "node:path";
import { ensureDir } from "../../utils/src/paths.js";
import { config } from "../../core/src/config.js";

// node:sqlite is an experimental built-in in Node 22 and stable in 24.
// We require it lazily so older Node versions can still import the package
// without crashing — surface a clear error only when something actually
// touches the DB.
type SqliteDB = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get<T = unknown>(...args: unknown[]): T | undefined;
    all<T = unknown>(...args: unknown[]): T[];
  };
};

let cachedDb: SqliteDB | null = null;

async function getDb(): Promise<SqliteDB> {
  if (cachedDb) return cachedDb;
  await ensureDir(config.dirs.cache);
  const dbPath = path.join(config.dirs.cache, "vibe.sqlite");
  try {
    // dynamic import keeps this optional until called
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("node:sqlite");
    const ctor = mod.DatabaseSync ?? mod.default?.DatabaseSync;
    if (!ctor) throw new Error("DatabaseSync not exported by node:sqlite");
    cachedDb = new ctor(dbPath) as SqliteDB;
  } catch (e) {
    throw new Error(
      `node:sqlite not available (${(e as Error).message}). Use Node 22+ ` +
        "or install better-sqlite3 and swap the adapter.",
    );
  }
  cachedDb.exec(`
    CREATE TABLE IF NOT EXISTS presets (
      preset_id TEXT PRIMARY KEY,
      preset_name TEXT NOT NULL,
      channel_name TEXT,
      channel_url TEXT,
      niche TEXT,
      version INTEGER DEFAULT 1,
      total_videos INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      file_path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      preset_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      dir_path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analyses (
      video_id TEXT PRIMARY KEY,
      preset_id TEXT,
      source_url TEXT,
      title TEXT,
      duration_seconds REAL,
      analyzed_at TEXT NOT NULL,
      file_path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,         -- analyze_channel | analyze_video | preset_generate | plan | source | review | timeline | render
      target TEXT NOT NULL,       -- channel slug, project id, etc.
      ok INTEGER NOT NULL,        -- 0/1
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      message TEXT,
      output_path TEXT
    );
  `);
  return cachedDb;
}

export interface PresetRow {
  preset_id: string;
  preset_name: string;
  channel_name: string | null;
  channel_url: string | null;
  niche: string | null;
  version: number;
  total_videos: number;
  created_at: string;
  updated_at: string;
  file_path: string;
}

export interface AnalysisRow {
  video_id: string;
  preset_id: string | null;
  source_url: string | null;
  title: string | null;
  duration_seconds: number | null;
  analyzed_at: string;
  file_path: string;
}

export interface RunRow {
  run_id: string;
  kind: string;
  target: string;
  ok: number;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  message: string | null;
  output_path: string | null;
}

export const db = {
  async upsertPreset(row: PresetRow): Promise<void> {
    const d = await getDb();
    d.prepare(
      `INSERT INTO presets (preset_id, preset_name, channel_name, channel_url, niche, version,
                            total_videos, created_at, updated_at, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(preset_id) DO UPDATE SET
         preset_name=excluded.preset_name,
         channel_name=excluded.channel_name,
         channel_url=excluded.channel_url,
         niche=excluded.niche,
         version=excluded.version,
         total_videos=excluded.total_videos,
         updated_at=excluded.updated_at,
         file_path=excluded.file_path`,
    ).run(
      row.preset_id,
      row.preset_name,
      row.channel_name,
      row.channel_url,
      row.niche,
      row.version,
      row.total_videos,
      row.created_at,
      row.updated_at,
      row.file_path,
    );
  },

  async listPresets(): Promise<PresetRow[]> {
    const d = await getDb();
    return d.prepare("SELECT * FROM presets ORDER BY updated_at DESC").all<PresetRow>();
  },

  async upsertAnalysis(row: AnalysisRow): Promise<void> {
    const d = await getDb();
    d.prepare(
      `INSERT INTO analyses (video_id, preset_id, source_url, title, duration_seconds, analyzed_at, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET
         preset_id=excluded.preset_id,
         source_url=excluded.source_url,
         title=excluded.title,
         duration_seconds=excluded.duration_seconds,
         analyzed_at=excluded.analyzed_at,
         file_path=excluded.file_path`,
    ).run(
      row.video_id,
      row.preset_id,
      row.source_url,
      row.title,
      row.duration_seconds,
      row.analyzed_at,
      row.file_path,
    );
  },

  async recordRun(row: RunRow): Promise<void> {
    const d = await getDb();
    d.prepare(
      `INSERT INTO runs (run_id, kind, target, ok, started_at, finished_at, duration_ms, message, output_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.run_id,
      row.kind,
      row.target,
      row.ok,
      row.started_at,
      row.finished_at,
      row.duration_ms,
      row.message,
      row.output_path,
    );
  },
};
