type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const envLevel = (process.env.LOG_LEVEL ?? "info") as Level;
const threshold = RANK[envLevel] ?? RANK.info;

function emit(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (RANK[level] < threshold) return;
  const ts = new Date().toISOString();
  const head = `[${ts}] [${level.toUpperCase()}] [${scope}]`;
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console.error(`${head} ${msg}`, extra);
  } else {
    // eslint-disable-next-line no-console
    console.error(`${head} ${msg}`);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => emit("debug", scope, msg, extra),
    info: (msg: string, extra?: unknown) => emit("info", scope, msg, extra),
    warn: (msg: string, extra?: unknown) => emit("warn", scope, msg, extra),
    error: (msg: string, extra?: unknown) => emit("error", scope, msg, extra),
  };
}
