import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { projectDataFolder } from "../results/run-store.js";

/**
 * A project's local data, kept on this machine and never in git (spec section 4): the APK chosen
 * by hand (PRJ-4), the last device (DEV-3), the chosen flows and whether the AI notice was accepted.
 */
const localSchema = z.looseObject({
  apk: z.string().min(1).optional(),
  device: z.string().min(1).optional(),
  flows: z.array(z.string()).optional(),
  aiNoticeAccepted: z.boolean().optional(),
});

export type ProjectLocal = z.infer<typeof localSchema>;

export function localFile(appData: string, projectId: string): string {
  return join(projectDataFolder(appData, projectId), "local.json");
}

/** A missing or unreadable file reads as empty: local data is a convenience, never required. */
export async function loadLocal(
  appData: string,
  projectId: string,
): Promise<ProjectLocal> {
  try {
    const parsed = localSchema.safeParse(
      JSON.parse(await readFile(localFile(appData, projectId), "utf8")),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Merges `change` into the local data. A field set to undefined is removed. */
export async function updateLocal(
  appData: string,
  projectId: string,
  change: Partial<ProjectLocal>,
): Promise<ProjectLocal> {
  const merged: Record<string, unknown> = {
    ...(await loadLocal(appData, projectId)),
    ...change,
  };
  for (const key of Object.keys(merged))
    if (merged[key] === undefined) delete merged[key];
  const folder = projectDataFolder(appData, projectId);
  await mkdir(folder, { recursive: true });
  const temporary = join(folder, ".local.json.tmp");
  await writeFile(temporary, JSON.stringify(merged, null, 2) + "\n", "utf8");
  await rename(temporary, localFile(appData, projectId));
  return merged;
}
