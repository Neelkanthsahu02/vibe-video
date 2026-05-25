/* Tiny structured logger. Avoids pulling in another dep. */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const envLevel = (process.env.LOG_LEVEL ?? "info") as Level;
const threshold = LEVEL_RANK[envLevel] ?? LEVEL_RANK.info;

function emit(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (LEVEL_RANK[level] < threshold) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}] [${scope}]`;
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console.error(`${prefix} ${msg}`, extra);
  } else {
    // eslint-disable-next-line no-console
    console.error(`${prefix} ${msg}`);
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
