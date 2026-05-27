import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function ensureDir(p: string): Promise<string> {
  await fs.mkdir(p, { recursive: true });
  return p;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function readJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw) as T;
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

export async function writeText(file: string, text: string): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, text, "utf-8");
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function shortHash(input: string, len = 12): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, len);
}

/** Format seconds into "HH:MM:SS.mmm" used by the new analysis schemas. */
export function fmtTimestamp(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const s = Math.abs(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  const secStr = sec.toFixed(3).padStart(6, "0");
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${secStr}`;
}

/** Parse "HH:MM:SS.mmm" or "MM:SS" or a number-as-string back to seconds. */
export function parseTimestamp(s: string): number {
  if (!s) return 0;
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(":").map((p) => parseFloat(p));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  if (parts.length === 3) {
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  if (parts.length === 2) {
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  return parts[0] ?? 0;
}
