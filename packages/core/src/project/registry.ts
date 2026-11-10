import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface KnownProject {
  id: string;
  folder: string;
}

export function projectsFile(appData: string): string {
  return join(appData, "projects.json");
}

/** `projects.json`: the projects the desktop app knows (architecture.md section 4). */
export async function knownProjects(appData: string): Promise<KnownProject[]> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(projectsFile(appData), "utf8"),
    );
    const list = (parsed as { projects?: unknown } | null)?.projects;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (p): p is KnownProject =>
        typeof (p as KnownProject | null)?.id === "string" &&
        typeof (p as KnownProject | null)?.folder === "string",
    );
  } catch {
    return [];
  }
}

/**
 * The project id the CLI saves runs under (D-56). A folder the desktop app knows keeps its id, so
 * both share one history. Any other folder gets an id made from its path, and is not added to the
 * app's project list.
 */
export async function cliProjectId(
  appData: string,
  projectFolder: string,
): Promise<string> {
  const folder = normalise(projectFolder);
  const known = (await knownProjects(appData)).find(
    (p) => normalise(p.folder) === folder,
  );
  if (known) return known.id;
  return `cli-${createHash("sha256").update(folder).digest("hex").slice(0, 16)}`;
}

/** Windows and macOS folders are case-insensitive by default. */
function normalise(folder: string): string {
  return resolve(folder)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}
