// The preload API: the only things the renderer can call (architecture.md section 7, SEC-6).
// Shared by main, preload and renderer, so it holds types and names only.

export type Language = "en" | "id";

export interface AppInfo {
  version: string;
  platform: "win32" | "darwin" | "linux";
}

export interface Settings {
  /** The user's choice. Undefined follows the operating system (LNG-1). */
  language?: Language;
}

export interface SettingsView {
  settings: Settings;
  /** The language in use: the user's choice, or the one the operating system implies. */
  language: Language;
}

export interface JagraApi {
  app: {
    info(): Promise<AppInfo>;
  };
  settings: {
    get(): Promise<SettingsView>;
    set(change: Settings): Promise<SettingsView>;
  };
}

/** IPC channel names. main checks every message on them (SEC-6). */
export const CHANNELS = {
  appInfo: "app:info",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
} as const;
