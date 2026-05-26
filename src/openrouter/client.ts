import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("openrouter");

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object" | "text";
  retries?: number;
}

export class OpenRouterError extends Error {
  constructor(message: string, public status?: number, public body?: string) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = opts.apiKey ?? config.openrouter.apiKey;
    this.baseUrl = opts.baseUrl ?? config.openrouter.baseUrl;
    if (!this.apiKey) {
      log.warn(
        "OPENROUTER_API_KEY is not set — vision/LLM calls will fail until configured.",
      );
    }
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const model = options.model ?? config.openrouter.reasoningModel;
    const retries = options.retries ?? 2;
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.2,
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }

    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "HTTP-Referer": "https://vibe-video.local",
            "X-Title": "vibe-video",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text();
          if (res.status >= 500 || res.status === 429) {
            throw new OpenRouterError(
              `OpenRouter ${res.status}`,
              res.status,
              text,
            );
          }
          throw new OpenRouterError(
            `OpenRouter ${res.status}: ${text.slice(0, 400)}`,
            res.status,
            text,
          );
        }
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = json.choices?.[0]?.message?.content;
        if (!content) {
          throw new OpenRouterError("Empty completion content");
        }
        return content;
      } catch (e) {
        lastErr = e;
        const isRetryable =
          e instanceof OpenRouterError &&
          (e.status === undefined || e.status >= 500 || e.status === 429);
        if (!isRetryable || attempt === retries) break;
        const delay = 500 * Math.pow(2, attempt);
        log.warn(`chat retry ${attempt + 1}/${retries} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(String(lastErr));
  }

  async chatJson<T>(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<T> {
    const text = await this.chat(messages, {
      ...options,
      responseFormat: "json_object",
    });
    return parseJsonLoose<T>(text);
  }

  async imageToDataUrl(imagePath: string): Promise<string> {
    const buf = await fs.readFile(imagePath);
    const ext = path.extname(imagePath).slice(1).toLowerCase();
    const mime =
      ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }

  async visionJson<T>(
    systemPrompt: string,
    userText: string,
    imagePaths: string[],
    options: ChatOptions = {},
  ): Promise<T> {
    const images = await Promise.all(
      imagePaths.map((p) => this.imageToDataUrl(p)),
    );
    const content: ChatMessage["content"] = [
      { type: "text", text: userText },
      ...images.map((url) => ({
        type: "image_url" as const,
        image_url: { url },
      })),
    ];
    return this.chatJson<T>(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      { model: config.openrouter.visionModel, ...options },
    );
  }
}

/** Tolerant JSON parser — strips ```json fences and trailing commentary. */
export function parseJsonLoose<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : trimmed;
  // Find first { or [ and try to parse from there
  const start = candidate.search(/[\[{]/);
  if (start === -1) {
    throw new Error(`No JSON object found in response: ${text.slice(0, 200)}`);
  }
  const slice = candidate.slice(start);
  // Try progressive truncations from the end to recover malformed tail.
  for (let end = slice.length; end > 0; end -= 32) {
    try {
      return JSON.parse(slice.slice(0, end)) as T;
    } catch {
      /* keep trying */
    }
  }
  throw new Error(`Failed to parse JSON: ${text.slice(0, 300)}`);
}
