import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createLogger } from "../utils/logger.js";
import { ensureDir, fileExists } from "../utils/paths.js";

const log = createLogger("image-dl");

export interface DownloadedImage {
  localPath: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
}

export interface DownloadImageOptions {
  /** Reject images smaller than this many pixels on the long edge. */
  minLongEdge?: number;
  /** Hard cap on bytes per download. */
  maxBytes?: number;
  /** Re-encode to JPEG for predictable downstream use. */
  reencodeJpeg?: boolean;
  /** Network timeout in ms. */
  timeoutMs?: number;
}

const DEFAULTS: Required<DownloadImageOptions> = {
  minLongEdge: 480,
  maxBytes: 25 * 1024 * 1024,
  reencodeJpeg: true,
  timeoutMs: 20000,
};

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function downloadImage(
  url: string,
  destDir: string,
  basename: string,
  options: DownloadImageOptions = {},
): Promise<DownloadedImage | null> {
  const opts = { ...DEFAULTS, ...options };
  await ensureDir(destDir);
  const targetExt = opts.reencodeJpeg ? "jpg" : guessExt(url);
  const finalPath = path.join(destDir, `${basename}.${targetExt}`);
  if (await fileExists(finalPath)) {
    const stat = await fs.stat(finalPath);
    try {
      const meta = await sharp(finalPath).metadata();
      return {
        localPath: finalPath,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        bytes: stat.size,
        format: meta.format ?? targetExt,
      };
    } catch {
      // Cached file is corrupt — re-download.
      await fs.unlink(finalPath).catch(() => undefined);
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": BROWSER_UA, Accept: "image/*,*/*;q=0.8" },
    });
  } catch (e) {
    log.warn(`download failed ${url}: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    log.warn(`HTTP ${res.status} for ${url}`);
    return null;
  }
  const lenHeader = res.headers.get("content-length");
  if (lenHeader && parseInt(lenHeader, 10) > opts.maxBytes) {
    log.warn(`skip ${url}: ${lenHeader} bytes exceeds maxBytes`);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > opts.maxBytes) {
    log.warn(`skip ${url}: ${buf.length} bytes exceeds maxBytes`);
    return null;
  }

  try {
    let pipeline = sharp(buf, { failOn: "none" });
    const meta = await pipeline.metadata();
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longEdge < opts.minLongEdge) {
      log.debug(`skip ${url}: long edge ${longEdge}px below ${opts.minLongEdge}`);
      return null;
    }
    let outBuf: Buffer;
    let format = meta.format ?? "jpeg";
    if (opts.reencodeJpeg) {
      outBuf = await pipeline
        .rotate()
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer();
      format = "jpeg";
    } else {
      outBuf = buf;
    }
    await fs.writeFile(finalPath, outBuf);
    return {
      localPath: finalPath,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      bytes: outBuf.length,
      format,
    };
  } catch (e) {
    log.warn(`decode failed ${url}: ${(e as Error).message}`);
    return null;
  }
}

function guessExt(url: string): string {
  const m = url.split("?")[0]?.match(/\.(jpe?g|png|webp|gif|avif)$/i);
  return (m?.[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
}
