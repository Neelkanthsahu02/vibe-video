import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("brave");

export interface BraveImageResult {
  title: string;
  url: string; // page URL
  source: string; // publisher
  thumbnailUrl: string;
  imageUrl: string;
  width: number | null;
  height: number | null;
}

export interface BraveVideoResult {
  title: string;
  url: string;
  description: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  publisher: string | null;
}

export interface BraveClientOptions {
  apiKey?: string;
  retries?: number;
  /** Polite delay between requests (ms). Brave Pro plans allow more, free is ~1/sec. */
  minIntervalMs?: number;
}

/** Brave Search API client with crude inter-request throttling. */
export class BraveClient {
  private apiKey: string;
  private retries: number;
  private minInterval: number;
  private lastRequestAt = 0;

  constructor(opts: BraveClientOptions = {}) {
    this.apiKey = opts.apiKey ?? config.brave.apiKey;
    this.retries = opts.retries ?? 2;
    this.minInterval = opts.minIntervalMs ?? 1100;
  }

  hasKey(): boolean {
    return !!this.apiKey;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.minInterval - (now - this.lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async request<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    if (!this.apiKey) {
      throw new Error(
        "BRAVE_SEARCH_API_KEY is not set. Get one at https://brave.com/search/api/",
      );
    }
    const url = new URL(`https://api.search.brave.com/res/v1/${endpoint}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this.throttle();
      try {
        const res = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": this.apiKey,
          },
        });
        if (!res.ok) {
          const body = await res.text();
          if (res.status === 429 || res.status >= 500) {
            throw new Error(`Brave ${res.status}: ${body.slice(0, 200)}`);
          }
          throw new Error(`Brave ${res.status}: ${body.slice(0, 400)}`);
        }
        return (await res.json()) as T;
      } catch (e) {
        lastErr = e;
        if (attempt === this.retries) break;
        const delay = 1000 * Math.pow(2, attempt);
        log.warn(`Brave retry ${attempt + 1}/${this.retries} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async searchImages(query: string, count = 10): Promise<BraveImageResult[]> {
    const json = await this.request<{
      results?: Array<{
        title?: string;
        url?: string;
        source?: string;
        thumbnail?: { src?: string };
        properties?: { url?: string };
        meta_url?: { netloc?: string };
        width?: number;
        height?: number;
      }>;
    }>("images/search", {
      q: query,
      count: String(Math.min(50, Math.max(1, count))),
      safesearch: "moderate",
      country: "us",
      search_lang: "en",
    });
    return (json.results ?? []).flatMap((r) => {
      const imageUrl = r.properties?.url ?? r.thumbnail?.src;
      if (!imageUrl) return [];
      return [
        {
          title: r.title ?? "",
          url: r.url ?? "",
          source: r.source ?? r.meta_url?.netloc ?? "",
          thumbnailUrl: r.thumbnail?.src ?? "",
          imageUrl,
          width: r.width ?? null,
          height: r.height ?? null,
        },
      ];
    });
  }

  async searchVideos(query: string, count = 10): Promise<BraveVideoResult[]> {
    const json = await this.request<{
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        video?: { duration?: string };
        meta_url?: { netloc?: string };
        thumbnail?: { src?: string };
      }>;
    }>("videos/search", {
      q: query,
      count: String(Math.min(50, Math.max(1, count))),
      safesearch: "moderate",
      country: "us",
      search_lang: "en",
    });
    return (json.results ?? []).flatMap((r) => {
      if (!r.url) return [];
      return [
        {
          title: r.title ?? "",
          url: r.url,
          description: r.description ?? null,
          thumbnailUrl: r.thumbnail?.src ?? null,
          durationSeconds: parseDurationString(r.video?.duration ?? null),
          publisher: r.meta_url?.netloc ?? null,
        },
      ];
    });
  }
}

function parseDurationString(s: string | null): number | null {
  if (!s) return null;
  // Brave returns "MM:SS" or "HH:MM:SS"
  const parts = s.split(":").map((n) => parseInt(n, 10));
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3)
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return null;
}
