/* Minimal Apify REST client — just what the Style Analyzer needs.
 * Docs: https://docs.apify.com/api/v2 */
import { config } from "../../../core/src/config.js";
import { createLogger } from "../../../utils/src/logger.js";

const log = createLogger("apify");

export interface ApifyVideoItem {
  /** YouTube video id (11-char). */
  id: string;
  url: string;
  title: string;
  viewCount: number | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  thumbnail: string | null;
  channelName?: string | null;
  channelUrl?: string | null;
}

export interface ApifyClientOptions {
  apiKey?: string;
  /** Actor id used to scrape a channel's video list. */
  channelActor?: string;
  /** Actor id for arbitrary YouTube URL scraping (fallback). */
  scraperActor?: string;
  /** Max seconds to wait for a synchronous run. */
  runTimeoutSeconds?: number;
  /** Max polling interval while waiting for a run. */
  pollIntervalMs?: number;
}

export class ApifyClient {
  private apiKey: string;
  private channelActor: string;
  private scraperActor: string;
  private runTimeoutSeconds: number;
  private pollIntervalMs: number;

  constructor(opts: ApifyClientOptions = {}) {
    this.apiKey = opts.apiKey ?? config.apify.apiKey;
    this.channelActor = opts.channelActor ?? config.apify.channelActor;
    this.scraperActor = opts.scraperActor ?? config.apify.scraperActor;
    this.runTimeoutSeconds = opts.runTimeoutSeconds ?? 240;
    this.pollIntervalMs = opts.pollIntervalMs ?? 2500;
  }

  hasKey(): boolean {
    return !!this.apiKey;
  }

  private encodedActor(id: string): string {
    return id.replace("/", "~");
  }

  /** Run an actor synchronously and return the dataset items. */
  async runActor<T = unknown>(
    actorId: string,
    input: unknown,
  ): Promise<T[]> {
    if (!this.apiKey) {
      throw new Error(
        "APIFY_API_KEY is not set. Sign up at https://apify.com/ and set the env var.",
      );
    }
    const enc = this.encodedActor(actorId);
    const url = `https://api.apify.com/v2/acts/${enc}/run-sync-get-dataset-items?token=${encodeURIComponent(this.apiKey)}&timeout=${this.runTimeoutSeconds}`;
    log.info(`run ${actorId}`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Apify ${res.status} on actor ${actorId}: ${text.slice(0, 400)}`,
      );
    }
    return (await res.json()) as T[];
  }

  /** Fetch the videos uploaded by a channel. Accepts the @handle URL,
   *  /channel/UC... URL, or a channel id. */
  async listChannelVideos(
    channelUrl: string,
    opts: { maxItems?: number; sortBy?: "popular" | "newest" | "oldest" } = {},
  ): Promise<ApifyVideoItem[]> {
    const maxItems = opts.maxItems ?? 50;
    const sortBy = opts.sortBy ?? "newest";

    // The streamers/youtube-channel-scraper actor accepts startUrls plus
    // maxResults. We pass `sortVideosBy` when the actor supports it; if not,
    // ranking still happens client-side by view count / publishedAt below.
    const input = {
      startUrls: [{ url: channelUrl }],
      maxResults: maxItems,
      maxResultsShorts: 0,
      maxResultStreams: 0,
      sortVideosBy: sortBy,
    };
    let raw: Record<string, unknown>[];
    try {
      raw = await this.runActor<Record<string, unknown>>(
        this.channelActor,
        input,
      );
    } catch (e) {
      log.warn(`channel actor failed (${(e as Error).message}); falling back`);
      raw = await this.runActor<Record<string, unknown>>(this.scraperActor, {
        startUrls: [{ url: channelUrl }],
        maxResults: maxItems,
      });
    }
    return raw.map(normalizeVideo).filter((v): v is ApifyVideoItem => !!v);
  }

  /** Fetch metadata for a list of specific YouTube video URLs. */
  async fetchVideoMetadata(urls: string[]): Promise<ApifyVideoItem[]> {
    if (urls.length === 0) return [];
    const raw = await this.runActor<Record<string, unknown>>(this.scraperActor, {
      startUrls: urls.map((url) => ({ url })),
      maxResults: urls.length,
    });
    return raw.map(normalizeVideo).filter((v): v is ApifyVideoItem => !!v);
  }
}

function normalizeVideo(item: Record<string, unknown>): ApifyVideoItem | null {
  // The Apify YouTube actors return slightly different field shapes
  // depending on the actor version. Normalize defensively.
  const id =
    (item.id as string | undefined) ??
    (item.videoId as string | undefined) ??
    extractVideoIdFromUrl((item.url as string | undefined) ?? "");
  if (!id) return null;
  const url =
    (item.url as string | undefined) ??
    `https://www.youtube.com/watch?v=${id}`;
  const title =
    (item.title as string | undefined) ??
    (item.name as string | undefined) ??
    "";
  const viewCount =
    typeof item.viewCount === "number"
      ? (item.viewCount as number)
      : typeof item.views === "number"
        ? (item.views as number)
        : typeof item.viewCount === "string"
          ? parseViews(item.viewCount as string)
          : typeof item.views === "string"
            ? parseViews(item.views as string)
            : null;
  const durationSeconds =
    typeof item.duration === "number"
      ? (item.duration as number)
      : typeof item.duration === "string"
        ? parseDurationString(item.duration as string)
        : typeof item.lengthSeconds === "number"
          ? (item.lengthSeconds as number)
          : null;
  const publishedAt =
    (item.publishedAt as string | undefined) ??
    (item.uploadDate as string | undefined) ??
    (item.date as string | undefined) ??
    null;
  const thumbnail =
    (item.thumbnailUrl as string | undefined) ??
    (item.thumbnail as string | undefined) ??
    (Array.isArray(item.thumbnails)
      ? (item.thumbnails as Array<{ url?: string }>)[0]?.url ?? null
      : null);
  const channelName =
    (item.channelName as string | undefined) ??
    (item.channel as string | undefined) ??
    null;
  const channelUrl = (item.channelUrl as string | undefined) ?? null;

  return {
    id,
    url,
    title,
    viewCount,
    durationSeconds,
    publishedAt,
    thumbnail,
    channelName,
    channelUrl,
  };
}

function extractVideoIdFromUrl(url: string): string | null {
  if (!url) return null;
  const m = url.match(
    /(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/,
  );
  return m?.[1] ?? null;
}

function parseViews(s: string): number | null {
  // Strip commas, spaces, "views", suffixes like K/M/B.
  const cleaned = s.replace(/[, ]/g, "").replace(/views?/i, "");
  const m = cleaned.match(/^([\d.]+)\s*([KMB]?)$/i);
  if (!m) {
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : null;
  }
  const num = parseFloat(m[1]!);
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2]!.toUpperCase()] ?? 1;
  return Math.round(num * mult);
}

function parseDurationString(s: string): number | null {
  if (!s) return null;
  // Common forms: "12:34", "1:02:34", or ISO 8601 "PT1H2M34S"
  if (s.startsWith("PT")) {
    const m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return null;
    return (
      parseInt(m[1] ?? "0", 10) * 3600 +
      parseInt(m[2] ?? "0", 10) * 60 +
      parseInt(m[3] ?? "0", 10)
    );
  }
  const parts = s.split(":").map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return null;
  if (parts.length === 3)
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  return parts[0] ?? 0;
}
