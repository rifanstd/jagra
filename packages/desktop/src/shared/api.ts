// The preload API: the only things the renderer can call (architecture.md section 7, SEC-6).
// Shared by main, preload and renderer, so it holds types and names only.
import type { ToolStatus } from "@jagra/core/types";

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
} as const;

/** Channels main sends on, never answers. */
export const EVENTS = {
  environmentProgress: "environment:progress",
} as const;
