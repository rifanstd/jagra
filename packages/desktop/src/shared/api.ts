// The preload API: the only things the renderer can call (architecture.md section 7, SEC-6).
// Shared by main, preload and renderer, so it holds types and names only.
import type {
  ApkInfo,
  Device,
  JagraError,
  Result,
  RunStatus,
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

export interface SettingsView {
  settings: Settings;
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
export interface DevicesView {
  adb: boolean;
  devices: Device[];
}

export interface JagraApi {
  app: {
    info(): Promise<AppInfo>;
    /** Opens one of Jagra's known links, such as an install page, in the browser. */
    openLink(url: string): Promise<void>;
    copyText(text: string): Promise<void>;
  };
  settings: {
    get(): Promise<SettingsView>;
    set(change: Settings): Promise<SettingsView>;
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
  environment: {
    check(): Promise<EnvironmentView>;
    /** Each tool's state as soon as it is known. Returns a function that stops listening. */
    onProgress(listener: (status: ToolStatus) => void): () => void;
  };
}

/** IPC channel names. main checks every message on them (SEC-6). */
export const CHANNELS = {
  appInfo: "app:info",
  appOpenLink: "app:open-link",
  appCopyText: "app:copy-text",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
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
} as const;

/** Channels main sends on, never answers. */
export const EVENTS = {
  environmentProgress: "environment:progress",
  devicesChange: "devices:change",
} as const;
