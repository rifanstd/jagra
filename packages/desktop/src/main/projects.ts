import { cp, mkdir, rm, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  addProject,
  configFile,
  discoverFlows,
  fail,
  findApk,
  flowsFolder,
  inspectFolder,
  knownProjects,
  listRuns,
  loadConfig,
  loadLocal,
  mockoonSettings,
  moveProject,
  ok,
  projectRelative,
  removeProject,
  runsFolder,
  setUpProject,
  updateLocal,
  type ApkInfo,
  type ApkReader,
  type KnownProject,
  type ProjectConfig,
  type Result,
  type Run,
} from "@jagra/core";
import type {
  ApkView,
  FolderPreview,
  HelperView,
  LastRun,
  NewProject,
  ProjectDetails,
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
  // The APK is read again every few seconds while a project page is open; its contents only
  // change when the file does.
  private readonly apkInfo = new Map<
    string,
    { modifiedAt: number; info: Result<ApkInfo> }
  >();
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
    if (!config.ok) {
      return {
        id,
        folder: project.folder,
        name: basename(project.folder),
        configError: config.error,
      };
    }
    return {
      id,
      folder: project.folder,
      name: config.value.name,
      details: await this.details(id, project.folder, config.value),
    };
  }

  /** PRJ-4: the APK on its own, read again while the project page is open. */
  async apkOf(id: string): Promise<Result<ApkView> | undefined> {
    const project = await this.find(id);
    if (!project) return undefined;
    const config = await loadConfig(project.folder);
    if (!config.ok) return config;
    const local = await loadLocal(this.options.appData, id);
    return this.apk(project.folder, config.value, local.apk);
  }

  async chooseFlows(id: string, files: string[]): Promise<void> {
    if (await this.find(id))
      await updateLocal(this.options.appData, id, { flows: files });
  }

  async chooseDevice(id: string, deviceId: string): Promise<void> {
    if (await this.find(id))
      await updateLocal(this.options.appData, id, { device: deviceId });
  }

  /** PRJ-4: a picked APK wins over the search path until the user goes back to the newest. */
  async changeApk(
    id: string,
    to: "file" | "newest",
  ): Promise<Result<ApkView> | undefined> {
    const project = await this.find(id);
    if (!project) return undefined;
    if (to === "file") {
      const path = await this.options.dialogs.pickApk(project.folder);
      if (path === undefined) return undefined;
      await updateLocal(this.options.appData, id, { apk: path });
    } else {
      await updateLocal(this.options.appData, id, { apk: undefined });
    }
    return this.apkOf(id);
  }

  /** Opens a flow or helper flow of this project, and nothing else (FLOW-5). */
  async openFlow(id: string, file: string): Promise<void> {
    const project = await this.find(id);
    if (!project) return;
    const folder = flowsFolder(project.folder);
    const path = resolve(folder, file);
    const inside = relative(folder, path);
    if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return;
    const list = await discoverFlows(project.folder);
    if (
      [...list.flows, ...list.helpers].some(
        (flow) => resolve(flow.file) === path,
      )
    ) {
      await this.options.openPath(path);
    }
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

  private async details(
    id: string,
    folder: string,
    config: ProjectConfig,
  ): Promise<ProjectDetails> {
    const [list, local, runs, mockoon] = await Promise.all([
      discoverFlows(folder),
      loadLocal(this.options.appData, id),
      listRuns(runsFolder(this.options.appData, id)),
      mockoonSettings(folder, config),
    ]);
    const flows = list.flows.map((flow) => ({
      file: basename(flow.file),
      name: flow.name,
      problem: flow.problems[0],
    }));
    const runnable = flows
      .filter((flow) => !flow.problem)
      .map((flow) => flow.file);
    const parts = flowsFolder(folder);
    const helpers: HelperView[] = list.helpers.map((helper) => ({
      file: relative(parts, helper.file).split(sep).join("/"),
      usedBy: list.flows.filter((flow) =>
        flow.calls.some((call) => resolve(call.file) === resolve(helper.file)),
      ).length,
      problem: helper.problems[0],
    }));
    return {
      flows,
      helpers,
      // RUN-2: every flow until the user chooses, then the choice, without flows that went away.
      chosen: local.flows
        ? local.flows.filter((file) => runnable.includes(file))
        : runnable,
      searchPath: config.apk.searchPath,
      apk: await this.apk(folder, config, local.apk),
      mockoon: !mockoon.ok
        ? mockoon
        : mockoon.value && config.mockoon
          ? ok({ file: config.mockoon.file, port: mockoon.value.port })
          : undefined,
      device: local.device,
      lastRun: runs[0] && lastRun(runs[0]),
    };
  }

  private async apk(
    folder: string,
    config: ProjectConfig,
    handPicked?: string,
  ): Promise<Result<ApkView>> {
    const found = await findApk(folder, config, handPicked);
    if (!found.ok) return found;
    const { path, modifiedAt } = found.value;
    let known = this.apkInfo.get(path);
    if (known?.modifiedAt !== modifiedAt) {
      known = { modifiedAt, info: await this.options.apkReader.read(path) };
      this.apkInfo.set(path, known);
    }
    return ok({
      fileName: basename(path),
      modifiedAt,
      handPicked: found.value.handPicked,
      info: known.info,
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
