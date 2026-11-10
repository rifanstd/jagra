import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { appDataFolder } from "@jagra/core";
import { app, BrowserWindow, ipcMain, nativeTheme, session } from "electron";
import { registerIpc } from "./ipc.js";
import { lockDownContents, lockDownSession } from "./security.js";
import { SettingsFile } from "./settings.js";
import { windowOptions } from "./window.js";

// The Vite dev server's address while developing; undefined in a built app.
const devServer = process.env.ELECTRON_RENDERER_URL;
const rendererIndex = join(import.meta.dirname, "../renderer/index.html");
const appData = appDataFolder();
const settings = new SettingsFile(appData, () =>
  app.getPreferredSystemLanguages(),
);

// SET-2: dark mode follows the operating system.
nativeTheme.themeSource = "system";

app.on("web-contents-created", (_event, contents) =>
  lockDownContents(contents),
);

async function createWindow(): Promise<void> {
  const window = new BrowserWindow(
    windowOptions(join(import.meta.dirname, "../preload/index.cjs")),
  );
  window.once("ready-to-show", () => window.show());
  if (devServer) {
    await window.loadURL(devServer);
  } else {
    await window.loadFile(rendererIndex);
  }
}

void app.whenReady().then(async () => {
  lockDownSession(session.defaultSession, devServer);
  registerIpc(
    ipcMain,
    {
      appInfo: () => ({
        version: app.getVersion(),
        platform:
          process.platform === "darwin" || process.platform === "win32"
            ? process.platform
            : "linux",
      }),
      settings,
    },
    // Only the app's own page may call main (SEC-6).
    (url) => url.startsWith(devServer ?? pathToFileURL(rendererIndex).href),
  );
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
