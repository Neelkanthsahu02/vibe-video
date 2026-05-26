import { execa } from "execa";
import path from "node:path";
import { config } from "../config.js";
import { createLogger } from "./logger.js";

const log = createLogger("python");

export async function runPython<T = unknown>(
  scriptName: string,
  args: string[],
): Promise<T> {
  const scriptPath = path.join(config.pythonDir, scriptName);
  log.debug(`run ${scriptName}`, args);
  const { stdout, stderr } = await execa(
    config.bins.python,
    [scriptPath, ...args],
    { maxBuffer: 1024 * 1024 * 256 },
  );
  if (stderr) log.debug(`${scriptName} stderr`, stderr.slice(0, 2000));
  try {
    return JSON.parse(stdout) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from ${scriptName}: ${(e as Error).message}\n--- stdout head ---\n${stdout.slice(0, 500)}`,
    );
  }
}
