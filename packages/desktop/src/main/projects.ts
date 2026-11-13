import { cp, mkdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  addProject,
  configFile,
  fail,
  findApk,
  inspectFolder,
  knownProjects,
  listRuns,
  loadConfig,
  moveProject,
  ok,
  projectRelative,
  removeProject,
  runsFolder,
  setUpProject,
  updateLocal,
  type ApkReader,
  type KnownProject,
  type ProjectConfig,
  type Result,
  type Run,
} from "@jagra/core";
import type {
  ApkView,
  FolderPreview,
  LastRun,
  NewProject,
  ProjectSummary,
  ProjectView,
} from "../shared/api.js";

/** The system dialogs. Every path main works with comes from one of them, never from the renderer. */
export interface Dialogs {
  pickFolder(): Promise<string | undefined>;
  pickApk(defaultPath: string): Promise<string | undefined>;
  pickJson(defaultPath: string): Promise<string | undefined>;
}

export interface ProjectsOptions {
  appData: string;
  /** The user's Documents folder, where Try the sample app puts its copy (SMP-6). */
  documents: string;
  /** The sample project bundled with the app (SMP-5). */
  sample: string;
  apkReader: ApkReader;
  dialogs: Dialogs;
  /** Opens a file with the system's default app (FLOW-5). */
  openPath(path: string): Promise<void>;
  newId?: () => string;
}

/** What the Create project screen has picked so far. */
interface Pending {
  folder: string;
  apk?: string;
  mockoon?: string;
}

/** The project list and the Create project screen (PRJ-1 to PRJ-11, SMP-6). */
export class Projects {
  private pending: Pending | undefined;
  // projects.json is read, changed and written whole, so changes to it go one at a time.
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ProjectsOptions) {}

  async list(): Promise<ProjectSummary[]> {
    const known = await knownProjects(this.options.appData);
    return Promise.all(known.map((project) => this.summary(project)));
  }

  async get(id: string): Promise<ProjectView | undefined> {
    const project = await this.find(id);
    if (!project) return undefined;
    const config = await loadConfig(project.folder);
    return {
      id,
      folder: project.folder,
      name: config.ok ? config.value.name : basename(project.folder),
      configError: config.ok ? undefined : config.error,
    };
  }

  async pickFolder(): Promise<FolderPreview | undefined> {
    const folder = await this.options.dialogs.pickFolder();
    if (folder === undefined) return undefined;
    const look = await inspectFolder(folder);
    if (!look.ok) return undefined;
    this.pending = { folder };
    const { config } = look.value;
    return {
      folder,
      hasConfig: look.value.hasConfig,
      name: config.ok ? config.value.name : basename(folder),
      configError: config.ok ? undefined : config.error,
      flows: look.value.flows,
      helpers: look.value.helpers,
      searchPath: config.ok ? config.value.apk.searchPath : "",
      mockoonFile: config.ok ? config.value.mockoon?.file : undefined,
      apk: config.ok
        ? await this.apk(folder, config.value)
        : fail(config.error),
    };
  }

  async pickApk(): Promise<ApkView | undefined> {
    const pending = this.pending;
    if (!pending) return undefined;
    const path = await this.options.dialogs.pickApk(pending.folder);
    if (path === undefined) return undefined;
    let modifiedAt: number;
    try {
      modifiedAt = (await stat(path)).mtimeMs;
    } catch {
      return undefined;
    }
    pending.apk = path;
    return {
      fileName: basename(path),
      modifiedAt,
      handPicked: true,
      info: await this.options.apkReader.read(path),
    };
  }

  async pickMockoon(): Promise<Result<string> | undefined> {
    const pending = this.pending;
    if (!pending) return undefined;
    const path = await this.options.dialogs.pickJson(pending.folder);
    if (path === undefined) return undefined;
    const relative = projectRelative(pending.folder, path);
    if (relative.ok) pending.mockoon = relative.value;
    return relative;
  }

  /**
   * Sets up the `.jagra` folder and adds the project. A folder whose `config.yaml` cannot be read
   * is added untouched, so the list can show the problem (PRJ-9, PRJ-10).
   */
  async create(project: NewProject): Promise<Result<{ id: string }>> {
    const pending = this.pending;
    if (!pending) throw new Error("no folder was picked");
    const look = await inspectFolder(pending.folder);
    if (!look.ok) return look;
    if (look.value.config.ok) {
      const setUp = await setUpProject(pending.folder, {
        name: project.name,
        mockoonFile: pending.mockoon,
      });
      if (!setUp.ok) return setUp;
    }
    const added = await this.change(() =>
      addProject(this.options.appData, pending.folder, this.options.newId),
    );
    if (project.apk === "picked" && pending.apk) {
      await updateLocal(this.options.appData, added.id, { apk: pending.apk });
    }
    this.pending = undefined;
    return ok({ id: added.id });
  }

  async remove(id: string): Promise<void> {
    await this.change(() => removeProject(this.options.appData, id));
  }

  async locate(id: string): Promise<ProjectSummary | undefined> {
    if (!(await this.find(id))) return undefined;
    const folder = await this.options.dialogs.pickFolder();
    if (folder === undefined) return undefined;
    const moved = await this.change(() =>
      moveProject(this.options.appData, id, folder),
    );
    return moved && this.summary(moved);
  }

  async openConfig(id: string): Promise<void> {
    const project = await this.find(id);
    if (project) await this.options.openPath(configFile(project.folder));
  }

  sampleFolder(): string {
    return join(this.options.documents, "Jagra", "sample-app");
  }

  /** SMP-6: an existing copy is opened as it is, never overwritten. */
  async trySample(): Promise<Result<{ id: string }>> {
    const target = this.sampleFolder();
    if (!(await isFolder(target))) {
      if (!(await isFolder(this.options.sample)))
        return fail({ code: "SAMPLE_NOT_BUNDLED" });
      try {
        await mkdir(dirname(target), { recursive: true });
        await cp(this.options.sample, target, {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      } catch (e) {
        // The folder did not exist before, so nothing of the user's is removed.
        await rm(target, { recursive: true, force: true });
        return fail({
          code: "SAMPLE_COPY_FAILED",
          folder: target,
          detail: (e as Error).message,
        });
      }
    }
    const added = await this.change(() =>
      addProject(this.options.appData, target, this.options.newId),
    );
    return ok({ id: added.id });
  }

  private async summary({ id, folder }: KnownProject): Promise<ProjectSummary> {
    if (!(await isFolder(folder))) return { id, folder, state: "missing" };
    const config = await loadConfig(folder);
    if (!config.ok) return { id, folder, state: "broken", error: config.error };
    const [last] = await listRuns(runsFolder(this.options.appData, id));
    return {
      id,
      folder,
      state: "ready",
      name: config.value.name,
      lastRun: last && lastRun(last),
    };
  }

  private async apk(
    folder: string,
    config: ProjectConfig,
  ): Promise<Result<ApkView>> {
    const found = await findApk(folder, config);
    if (!found.ok) return found;
    return ok({
      fileName: basename(found.value.path),
      modifiedAt: found.value.modifiedAt,
      handPicked: false,
      info: await this.options.apkReader.read(found.value.path),
    });
  }

  private async find(id: string): Promise<KnownProject | undefined> {
    return (await knownProjects(this.options.appData)).find((p) => p.id === id);
  }

  private change<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writing.then(work, work);
    this.writing = next.catch(() => undefined);
    return next;
  }
}

function lastRun(run: Run): LastRun {
  return {
    status: run.status,
    startedAt: run.startedAt,
    passed: run.flows.filter((f) => f.status === "passed").length,
    failed: run.flows.filter((f) => f.status === "failed").length,
  };
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
