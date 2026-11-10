import type { BrowserWindowConstructorOptions, WebPreferences } from "electron";

/**
 * Settings every Jagra window gets. Never turn any of them off, not even for a moment (SEC-6, D-19).
 * `window.test.ts` fails if one changes.
 */
export const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  navigateOnDragDrop: false,
  spellcheck: false,
} as const satisfies WebPreferences;

export function windowOptions(
  preload: string,
): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Jagra",
    webPreferences: { ...SECURE_WEB_PREFERENCES, preload },
  };
}
