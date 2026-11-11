import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { fail, ok, type JagraError, type Result } from "../errors/index.js";
import { configFile, loadConfig, type ProjectConfig } from "./config.js";
import { discoverFlows } from "./flows.js";

/** What a folder holds before it becomes a project, for the Create project screen (PRJ-1). */
export interface FolderLook {
  folder: string;
  /** `.jagra/config.yaml` exists. */
  hasConfig: boolean;
  /** The project's settings, or why `config.yaml` cannot be read (PRJ-9, PRJ-10). */
  config: Result<ProjectConfig>;
  flows: number;
  helpers: number;
}

export async function inspectFolder(
  folder: string,
): Promise<Result<FolderLook>> {
  if (!(await isFolder(folder)))
    return fail({ code: "FILE_NOT_FOUND", file: folder });
  const config = await loadConfig(folder);
  const hasConfig = config.ok || config.error.code !== "FILE_NOT_FOUND";
  if (!hasConfig) {
    return ok({
      folder,
      hasConfig,
      config: ok(starterConfig(basename(folder))),
      flows: 0,
      helpers: 0,
    });
  }
  const list = await discoverFlows(folder);
  return ok({
    folder,
    hasConfig,
    config,
    flows: list.flows.length,
    helpers: list.helpers.length,
  });
}

export interface ProjectSetup {
  /** PRJ-2: kept in `config.yaml`, so the team sees the same name. */
  name: string;
  /** Relative to the project folder, with `/`. Left out keeps what `config.yaml` has. */
  mockoonFile?: string;
}

const STARTER = `# Jagra project settings, shared with the team through git.
format: 1
name: project
# The package name of the app under test. Jagra fills it from the first APK when it is empty.
appId: ""
apk:
  # The newest APK in this folder is tested. Relative to the project folder.
  searchPath: app/build/outputs/apk/debug
run:
  # Time limit for each flow.
  flowTimeoutMinutes: 5
`;

function starterConfig(name: string): ProjectConfig {
  return {
    format: 1,
    name,
    appId: "",
    apk: { searchPath: "app/build/outputs/apk/debug" },
    mockoon: undefined,
    run: { flowTimeoutMinutes: 5 },
  };
}

/**
 * PRJ-1, PRJ-2: creates the `.jagra` folder with its starter files, or updates the name and the
 * Mockoon file of an existing `config.yaml`, keeping its comments and other fields. It writes
 * nothing outside `.jagra` (PRJ-11), never replaces an existing file other than `config.yaml`,
 * and never touches a `config.yaml` it cannot read (PRJ-9, PRJ-10).
 */
export async function setUpProject(
  folder: string,
  setup: ProjectSetup,
): Promise<Result<void>> {
  // Checked first: reading inside a file fails differently on Windows and macOS.
  if (!(await isFolder(folder))) {
    return fail({
      code: "PROJECT_SETUP_FAILED",
      folder,
      detail: "not a folder",
    });
  }
  const file = configFile(folder);
  const current = await loadConfig(folder);
  const exists = current.ok || current.error.code !== "FILE_NOT_FOUND";
  if (!current.ok && exists) return current;

  try {
    await mkdir(join(folder, ".jagra", "flows", "parts"), { recursive: true });
    await writeNew(join(folder, ".jagra", "agent-rules.md"), "");
    const text = exists ? await readFile(file, "utf8") : STARTER;
    const doc = parseDocument(text);
    // Past the check above, an existing config.yaml was read.
    const config = current.ok ? current.value : undefined;
    let changed = !exists;
    if (config?.name !== setup.name) {
      doc.set("name", setup.name);
      changed = true;
    }
    if (
      setup.mockoonFile !== undefined &&
      config?.mockoon?.file !== setup.mockoonFile
    ) {
      doc.setIn(["mockoon", "file"], setup.mockoonFile);
      changed = true;
    }
    if (!changed) return ok(undefined);
    // Write next to it first, so a crash never leaves a half-written config.yaml.
    const temporary = join(folder, ".jagra", ".config.yaml.tmp");
    await writeFile(temporary, doc.toString(), "utf8");
    await rename(temporary, file);
  } catch (e) {
    return fail({
      code: "PROJECT_SETUP_FAILED",
      folder,
      detail: (e as Error).message,
    });
  }
  return ok(undefined);
}

/** A file's path relative to the project folder, with `/`, for `config.yaml` (spec section 4). */
export function projectRelative(
  folder: string,
  file: string,
): Result<string, JagraError> {
  const path = relative(resolve(folder), resolve(file));
  if (path === "" || path.startsWith("..") || isAbsolute(path)) {
    return fail({ code: "MOCKOON_FILE_OUTSIDE_PROJECT", file });
  }
  return ok(path.split(sep).join("/"));
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Creates a file only when it does not exist yet. */
async function writeNew(path: string, text: string): Promise<void> {
  try {
    await writeFile(path, text, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}
