import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Run } from "../types/index.js";

/** RES-8: runs kept per project. */
export const RUNS_KEPT = 20;

export function projectDataFolder(appData: string, projectId: string): string {
  return join(appData, "projects", projectId);
}

export function runsFolder(appData: string, projectId: string): string {
  return join(projectDataFolder(appData, projectId), "runs");
}

/**
 * A run id that sorts by start time, so the newest and oldest runs are found by name:
 * `20261110-183000-123-ab12`.
 */
export function newRunId(
  now: number,
  random: () => number = Math.random,
): string {
  const d = new Date(now);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const suffix = Math.floor(random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
  return `${date}-${time}-${pad(d.getUTCMilliseconds(), 3)}-${suffix}`;
}

export function runFile(runFolder: string): string {
  return join(runFolder, "run.json");
}

/** Writes `run.json`, then renames it into place, so a crash never leaves half a file (REL-1). */
export async function saveRun(runFolder: string, run: Run): Promise<void> {
  await mkdir(runFolder, { recursive: true });
  const temp = join(runFolder, ".run.json.tmp");
  await writeFile(temp, JSON.stringify(run, null, 2) + "\n", "utf8");
  await rename(temp, runFile(runFolder));
}

export async function loadRun(runFolder: string): Promise<Run | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(runFile(runFolder), "utf8"),
    );
    return isRun(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** A project's runs, newest first (RES-9). Folders without a readable `run.json` are skipped. */
export async function listRuns(folder: string): Promise<Run[]> {
  const runs: Run[] = [];
  for (const id of (await runIds(folder)).reverse()) {
    const run = await loadRun(join(folder, id));
    if (run) runs.push(run);
  }
  return runs;
}

/** Deletes the oldest runs beyond `keep`, with all their files (RES-8). */
export async function applyRetention(
  folder: string,
  keep = RUNS_KEPT,
): Promise<string[]> {
  const ids = await runIds(folder);
  const old = ids.slice(0, Math.max(0, ids.length - keep));
  for (const id of old)
    await rm(join(folder, id), { recursive: true, force: true });
  return old;
}

/**
 * Marks runs left `running` by a Jagra process that is gone as Interrupted (REL-2). Flows that were
 * waiting or running become `not-run`; finished flows keep their results.
 */
export async function markInterruptedRuns(
  folder: string,
  isAlive: (pid: number) => boolean,
  now: number,
): Promise<string[]> {
  const marked: string[] = [];
  for (const id of await runIds(folder)) {
    const runFolder = join(folder, id);
    const run = await loadRun(runFolder);
    if (run?.status !== "running" || isAlive(run.pid)) continue;
    await saveRun(runFolder, {
      ...run,
      status: "interrupted",
      endedAt: new Date(now).toISOString(),
      flows: run.flows.map((f) =>
        f.status === "waiting" || f.status === "running"
          ? { ...f, status: "not-run" }
          : f,
      ),
    });
    marked.push(id);
  }
  return marked;
}

/** Whether a process is alive. `process.kill(pid, 0)` checks without sending a signal. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function runIds(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter(
      (e) => e.isDirectory() && /^\d{8}-\d{6}-\d{3}-[0-9a-f]{4}$/.test(e.name),
    )
    .map((e) => e.name)
    .sort();
}

function isRun(value: unknown): value is Run {
  if (value === null || typeof value !== "object") return false;
  const run = value as Partial<Run>;
  return (
    typeof run.id === "string" &&
    typeof run.status === "string" &&
    Array.isArray(run.flows)
  );
}
