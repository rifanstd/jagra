import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

/** Writes `projects.json` next to itself first, so a crash never leaves half a list. */
async function saveProjects(
  appData: string,
  projects: KnownProject[],
): Promise<void> {
  await mkdir(appData, { recursive: true });
  const temporary = join(appData, ".projects.json.tmp");
  await writeFile(
    temporary,
    JSON.stringify({ projects }, null, 2) + "\n",
    "utf8",
  );
  await rename(temporary, projectsFile(appData));
}

/**
 * Adds a folder to the desktop app's list with a new random id (architecture.md section 4). A
 * folder already in the list keeps its entry, so a project never appears twice.
 */
export async function addProject(
  appData: string,
  folder: string,
  newId: () => string = randomUUID,
): Promise<KnownProject> {
  const projects = await knownProjects(appData);
  const known = projects.find((p) => normalise(p.folder) === normalise(folder));
  if (known) return known;
  const project = { id: newId(), folder: resolve(folder) };
  await saveProjects(appData, [...projects, project]);
  return project;
}

/** PRJ-7: takes a project off the list. No file is deleted, and its run history stays. */
export async function removeProject(
  appData: string,
  id: string,
): Promise<void> {
  const projects = await knownProjects(appData);
  await saveProjects(
    appData,
    projects.filter((p) => p.id !== id),
  );
}

/** PRJ-8: points a project at its new folder. It keeps its id, so it keeps its run history. */
export async function moveProject(
  appData: string,
  id: string,
  folder: string,
): Promise<KnownProject | undefined> {
  const projects = await knownProjects(appData);
  const project = projects.find((p) => p.id === id);
  if (!project) return undefined;
  project.folder = resolve(folder);
  await saveProjects(appData, projects);
  return project;
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
