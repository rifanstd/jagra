// The preload API: the only things the renderer can call (architecture.md section 7, SEC-6).
// Shared by main, preload and renderer, so it holds types and names only.
import type {
  ApkInfo,
  Device,
  JagraError,
  Result,
  FlowResult,
  Run,
  RunStatus,
  Step,
  ToolStatus,
} from "@jagra/core/types";

export type Language = "en" | "id";

export type Platform = "win32" | "darwin" | "linux";

export interface AppInfo {
  version: string;
  platform: Platform;
}

export interface Settings {
  /** The user's choice. Undefined follows the operating system (LNG-1). */
  language?: Language;
  /** The environment check was shown once, on the first launch (ENV-7). */
  environmentSeen?: boolean;
}

/** Everything Jagra keeps in `settings.json`. Only main sets the paths, from system dialogs. */
export interface StoredSettings extends Settings {
  /** ENV-6: paths set by hand, which win over detection. */
  toolPaths?: Partial<Record<ToolStatus["tool"], string>>;
  /** FLOW-5: the program that opens flow files instead of the system's default app. */
  editor?: string;
}

export interface SettingsView {
  settings: StoredSettings;
  /** The language in use: the user's choice, or the one the operating system implies. */
  language: Language;
}

/** One step of install instructions. The renderer turns `id` into text (ENV-4). */
export interface InstallStepView {
  id: string;
  copy?: string;
  url?: string;
}

export interface ToolView {
  status: ToolStatus;
  /** Instructions for this system, for every tool that is not Ready (ENV-4). */
  guide?: { url: string; steps: InstallStepView[] };
}

export interface EnvironmentView {
  tools: ToolView[];
  /** Every required tool can run (ENV-8). */
  ready: boolean;
  tookMs: number;
}

/** The last run of a project, for the project list (PRJ-7). */
export interface LastRun {
  id: string;
  status: RunStatus;
  /** ISO time. */
  startedAt: string;
  passed: number;
  failed: number;
}

/** One row of the project list (PRJ-7, PRJ-8, PRJ-10). */
export type ProjectSummary =
  | {
      id: string;
      folder: string;
      state: "ready";
      name: string;
      lastRun?: LastRun;
    }
  /** The folder was moved or deleted. */
  | { id: string; folder: string; state: "missing" }
  /** `config.yaml` cannot be read. */
  | { id: string; folder: string; state: "broken"; error: JagraError };

/** The APK a project tests (PRJ-4, PRJ-5). */
export interface ApkView {
  fileName: string;
  /** Milliseconds since the epoch, for "built 12 minutes ago". */
  modifiedAt: number;
  handPicked: boolean;
  /** Package and version, or why the file could not be read. */
  info: Result<ApkInfo>;
}

/** A folder picked on the Create project screen, before it becomes a project (PRJ-1). */
export interface FolderPreview {
  folder: string;
  /** `.jagra/config.yaml` already exists. */
  hasConfig: boolean;
  /** From `config.yaml`, or the folder name (PRJ-2). */
  name: string;
  /** Why the existing `config.yaml` cannot be read. The project is then added without changes. */
  configError?: JagraError;
  flows: number;
  helpers: number;
  searchPath: string;
  mockoonFile?: string;
  /** The newest APK under the search path, or APK_NOT_FOUND. */
  apk: Result<ApkView>;
}

export interface NewProject {
  name: string;
  /** The newest APK under the search path, or the file picked with `pickApk`. */
  apk: "search" | "picked";
}

export interface ProjectView {
  id: string;
  folder: string;
  name: string;
  configError?: JagraError;
  /** Everything the project page shows, when `config.yaml` can be read. */
  details?: ProjectDetails;
}

/** A flow in `.jagra/flows` (FLOW-6). */
export interface FlowView {
  /** File name, which is how runs choose flows (RUN-2). */
  file: string;
  name: string;
  /** Why it cannot run. A flow with a problem is left out of runs. */
  problem?: JagraError;
}

/** A helper flow in `.jagra/flows/parts`, never run on its own (FLOW-3). */
export interface HelperView {
  /** Path inside `.jagra/flows`, with `/`. */
  file: string;
  /** How many flows call it. */
  usedBy: number;
  problem?: JagraError;
}

export interface ProjectDetails {
  flows: FlowView[];
  helpers: HelperView[];
  /** File names of the flows chosen for the next run (RUN-2). */
  chosen: string[];
  searchPath: string;
  apk: Result<ApkView>;
  /** File as written in `config.yaml`, and the port. Undefined when the project has no Mockoon. */
  mockoon?: Result<{ file: string; port: number }>;
  /** The device used last (DEV-3). */
  device?: string;
  lastRun?: LastRun;
}

/** The device list (DEV-1). Without adb, nothing can be listed. */
/** A variable of a project's flows (FLOW-7). The value never reaches the page. */
export interface SecretName {
  name: string;
  hasValue: boolean;
  /** Still used by a flow; a stored value for a variable no flow uses can be removed. */
  used: boolean;
}

export interface DevicesView {
  adb: boolean;
  devices: Device[];
}

/** Why Run did not start, when the user can do something about it (spec section 7, step 1). */
export type StartAnswer =
  | { started: true }
  /** ENV-8: required tools that are missing, too old or cannot start. */
  | { tools: ToolStatus[] }
  /** RUN-10: variables without a value. */
  | { secrets: string[] }
  /** PRJ-6: the APK's package is not `appId`. Start again with `acceptPackage` to go on. */
  | { packageDiffers: { appId: string; packageName: string } }
  | { error: JagraError };

export interface StartRun {
  projectId: string;
  deviceId: string;
  acceptPackage?: boolean;
}

/** The parts of a run before the flows (RUN-8, DEV-4, MCK-2). */
export type PrepStep = "waiting" | "working" | "done" | "skipped";

/** The run in progress, or the one that just ended, as the Running screen shows it. */
export interface LiveRun {
  projectId: string;
  projectName: string;
  run: Run;
  device: PrepStep;
  /** The emulator is starting (DEV-4). */
  startingEmulator: boolean;
  install: PrepStep;
  mockoon: PrepStep;
  mockoonPort?: number;
  /** DEV-7: the device's Android is older than Maestro supports. */
  oldAndroid?: string;
  /** The latest step of the running flow, masked (RUN-8). */
  step?: string;
  /** RUN-3: the installed app was signed with another key. */
  askUninstall: boolean;
  cancelling: boolean;
  finished: boolean;
  /** Why the run could not start or be saved, after the checks passed. */
  error?: JagraError;
}

/** A step of a flow as written, with the steps of a helper flow it runs (RES-4). */
export interface StepView extends Omit<Step, "steps"> {
  /** For a `runFlow` of a file: its path inside `.jagra/flows`, and its name. */
  helper?: { file: string; name: string };
  steps?: StepView[];
}

/** One flow of a saved run, for the Flow detail screen (RES-4, RES-5). */
export interface FlowDetail {
  projectName: string;
  run: Pick<Run, "id" | "status" | "startedAt">;
  flow: FlowResult;
  /** File name, to open it in the editor. */
  file: string;
  /** The flow's steps as the file reads now, or undefined when it is gone. */
  steps?: StepView[];
  /** The file changed after the run, so its steps may not match the marks. */
  changed: boolean;
  /** The failure screenshot as a data URL. */
  screenshot?: string;
  /** The crash or ANR report, masked. */
  crashReport?: string;
}

/** One run in History (RES-9). */
export interface RunSummary {
  id: string;
  status: RunStatus;
  startedAt: string;
  passed: number;
  failed: number;
  cancelled: number;
  notRun: number;
  total: number;
  apkVersion: string;
  apkCode: number;
  device: string;
}

/** One saved run, for the Results screen (RES-2, RES-3). */
export interface RunResult {
  projectName: string;
  run: Run;
  /** The project used Mockoon for this run. */
  mockoon: boolean;
}

export interface JagraApi {
  app: {
    info(): Promise<AppInfo>;
    /** REL-7: copies the version, system, tools and the end of the log. */
    copyBugInfo(): Promise<void>;
    /** Opens one of Jagra's known links, such as an install page, in the browser. */
    openLink(url: string): Promise<void>;
    copyText(text: string): Promise<void>;
  };
  settings: {
    get(): Promise<SettingsView>;
    set(change: Settings): Promise<SettingsView>;
    /** ENV-6: opens the system's file dialog for a tool's program. */
    pickToolPath(tool: ToolStatus["tool"]): Promise<SettingsView | undefined>;
    resetToolPath(tool: ToolStatus["tool"]): Promise<SettingsView>;
    /** FLOW-5: opens the system's file dialog for the editor program. */
    pickEditor(): Promise<SettingsView | undefined>;
    resetEditor(): Promise<SettingsView>;
  };
  projects: {
    list(): Promise<ProjectSummary[]>;
    get(id: string): Promise<ProjectView | undefined>;
    /** Opens the system's folder dialog. Main keeps the folder until the project is created. */
    pickFolder(): Promise<FolderPreview | undefined>;
    pickApk(): Promise<ApkView | undefined>;
    /** A Mockoon file inside the picked folder, as a path relative to it. */
    pickMockoon(): Promise<Result<string> | undefined>;
    create(project: NewProject): Promise<Result<{ id: string }>>;
    /** Takes the project off the list. No file is deleted (PRJ-7). */
    remove(id: string): Promise<void>;
    /** Asks for the new folder of a project that moved (PRJ-8). */
    locate(id: string): Promise<ProjectSummary | undefined>;
    /** Opens `config.yaml` with the system's default app (FLOW-5). */
    openConfig(id: string): Promise<void>;
    /** Where Try the sample app puts its copy. */
    sampleFolder(): Promise<string>;
    /** Copies the sample project to Documents and adds it, or adds the copy already there (SMP-6). */
    trySample(): Promise<Result<{ id: string }>>;
    /** The APK again, so a new build shows without any action (PRJ-4). */
    apk(id: string): Promise<Result<ApkView> | undefined>;
    /** Keeps the chosen flows for next time (RUN-2). */
    chooseFlows(id: string, files: string[]): Promise<void>;
    /** Keeps the device for next time (DEV-3). */
    chooseDevice(id: string, deviceId: string): Promise<void>;
    /** Picks an APK file, or goes back to the newest under the search path (PRJ-4). */
    changeApk(
      id: string,
      to: "file" | "newest",
    ): Promise<Result<ApkView> | undefined>;
    /** Opens a flow or helper flow with the system's default app (FLOW-5). */
    openFlow(id: string, file: string): Promise<void>;
  };
  devices: {
    /** The current list. Changes come through `onChange` from then on (DEV-2). */
    watch(): Promise<DevicesView>;
    refresh(): Promise<DevicesView>;
    onChange(listener: (view: DevicesView) => void): () => void;
  };
  runs: {
    start(request: StartRun): Promise<StartAnswer>;
    /** RUN-9 */
    cancel(): Promise<void>;
    /** RUN-3: the user's answer to uninstalling the app signed with another key. */
    answerUninstall(uninstall: boolean): Promise<void>;
    /** The run in progress or the one that just ended. */
    live(): Promise<LiveRun | undefined>;
    onUpdate(listener: (live: LiveRun) => void): () => void;
    result(projectId: string, runId: string): Promise<RunResult | undefined>;
    /** RES-6: opens the report index in the default browser. */
    openReport(projectId: string, runId: string): Promise<void>;
    /** One flow of a run, by its place in the run. */
    flowDetail(
      projectId: string,
      runId: string,
      index: number,
    ): Promise<FlowDetail | undefined>;
    /** The project's runs, newest first (RES-9). */
    history(projectId: string): Promise<RunSummary[] | undefined>;
  };
  secrets: {
    /** Stores a value through the SecretStore (SEC-3). Values never come back to the page. */
    set(projectId: string, name: string, value: string): Promise<void>;
    /** FLOW-7: every variable the project's flows use, and whether it has a value. */
    list(projectId: string): Promise<SecretName[] | undefined>;
    remove(projectId: string, name: string): Promise<void>;
  };
  environment: {
    check(): Promise<EnvironmentView>;
    /** Each tool's state as soon as it is known. Returns a function that stops listening. */
    onProgress(listener: (status: ToolStatus) => void): () => void;
  };
}

/** The source code (ABT-1, D-27). The only outside link besides the install guides. */
export const REPOSITORY = "https://github.com/rifanstd/jagra";

/** IPC channel names. main checks every message on them (SEC-6). */
export const CHANNELS = {
  appInfo: "app:info",
  appOpenLink: "app:open-link",
  appCopyText: "app:copy-text",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsPickToolPath: "settings:pick-tool-path",
  settingsResetToolPath: "settings:reset-tool-path",
  settingsPickEditor: "settings:pick-editor",
  settingsResetEditor: "settings:reset-editor",
  appCopyBugInfo: "app:copy-bug-info",
  secretsList: "secrets:list",
  secretsRemove: "secrets:remove",
  environmentCheck: "environment:check",
  projectsList: "projects:list",
  projectsGet: "projects:get",
  projectsPickFolder: "projects:pick-folder",
  projectsPickApk: "projects:pick-apk",
  projectsPickMockoon: "projects:pick-mockoon",
  projectsCreate: "projects:create",
  projectsRemove: "projects:remove",
  projectsLocate: "projects:locate",
  projectsOpenConfig: "projects:open-config",
  projectsSampleFolder: "projects:sample-folder",
  projectsTrySample: "projects:try-sample",
  projectsApk: "projects:apk",
  projectsChooseFlows: "projects:choose-flows",
  projectsChooseDevice: "projects:choose-device",
  projectsChangeApk: "projects:change-apk",
  projectsOpenFlow: "projects:open-flow",
  devicesWatch: "devices:watch",
  devicesRefresh: "devices:refresh",
  runsStart: "runs:start",
  runsCancel: "runs:cancel",
  runsAnswerUninstall: "runs:answer-uninstall",
  runsLive: "runs:live",
  runsResult: "runs:result",
  runsOpenReport: "runs:open-report",
  runsFlowDetail: "runs:flow-detail",
  runsHistory: "runs:history",
  secretsSet: "secrets:set",
} as const;

/** Channels main sends on, never answers. */
export const EVENTS = {
  environmentProgress: "environment:progress",
  devicesChange: "devices:change",
  runsUpdate: "runs:update",
} as const;
