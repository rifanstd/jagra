import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ActiveProcessFile,
  activeProcessesFile,
  AdbDeviceBridge,
  AdbkitApkReader,
  appDataFolder,
  cleanUpLeftovers,
  Logger,
  logsFolder,
  Masker,
  NodeProcessControl,
  NodeProcessRunner,
  NodeToolProbe,
  RotatingFileSink,
  SystemClock,
  type ToolProbe,
  type ToolStatus,
} from "@jagra/core";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  session,
  shell,
} from "electron";
import { checkTools, knownLinks } from "./environment.js";
import { registerIpc } from "./ipc.js";
import { Projects } from "./projects.js";
import { lockDownContents, lockDownSession } from "./security.js";
import { SettingsFile } from "./settings.js";
import { isTestMode, testToolProbe } from "./test-mode.js";
import { TrackingProcessRunner } from "./tracking-runner.js";
import { windowOptions } from "./window.js";

// The Vite dev server's address while developing; undefined in a built app.
const devServer = process.env.ELECTRON_RENDERER_URL;
const rendererIndex = join(import.meta.dirname, "../renderer/index.html");
const testMode = isTestMode(process.env, app.isPackaged);
const appData = appDataFolder();
const clock = new SystemClock();
const masker = new Masker();
const logger = new Logger(
  new RotatingFileSink(logsFolder(appData)),
  masker,
  clock,
);
const state = new ActiveProcessFile(activeProcessesFile(appData));
const runner = new TrackingProcessRunner(
  new NodeProcessRunner({ store: state }),
);
const probe: ToolProbe = testMode
  ? testToolProbe(process.env)
  : new NodeToolProbe({ runner });
const settings = new SettingsFile(appData, () =>
  app.getPreferredSystemLanguages(),
);
const links = knownLinks();

/** The system dialogs, attached to the window that asked. */
const pick = async (
  options: Electron.OpenDialogOptions,
): Promise<string | undefined> => {
  const window = BrowserWindow.getFocusedWindow();
  const answer = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return answer.canceled ? undefined : answer.filePaths[0];
};

const projects = new Projects({
  appData,
  // Test mode keeps the sample copy away from the real Documents folder (D-87).
  documents: testMode ? join(appData, "documents") : app.getPath("documents"),
  sample: join(import.meta.dirname, "../sample"),
  apkReader: new AdbkitApkReader(),
  dialogs: {
    pickFolder: () =>
      pick({ properties: ["openDirectory", "createDirectory"] }),
    pickApk: (defaultPath) =>
      pick({
        defaultPath,
        properties: ["openFile"],
        filters: [{ name: "APK", extensions: ["apk"] }],
      }),
    pickJson: (defaultPath) =>
      pick({
        defaultPath,
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      }),
  },
  openPath: async (path) => {
    const problem = await shell.openPath(path);
    if (problem) await log("warn", "open-path-failed", { path, problem });
  },
});

/** A log line that never stops the app: a full disk must not break a check or the start. */
function log(
  level: "info" | "warn" | "error",
  event: string,
  fields?: Record<string, unknown>,
): Promise<void> {
  return logger[level](event, fields).catch(() => undefined);
}

// SET-2: dark mode follows the operating system.
nativeTheme.themeSource = "system";

app.on("web-contents-created", (_event, contents) =>
  lockDownContents(contents),
);

/**
 * REL-2: after the first environment check, which knows where adb is, stop the Mockoon and
 * remove the reverse rules a Jagra that crashed left behind.
 */
let cleanedUp = false;
async function cleanUpOnce(statuses: ToolStatus[]): Promise<void> {
  if (cleanedUp || testMode) return;
  cleanedUp = true;
  const adb = statuses.find((s) => s.tool === "adb")?.path;
  const left = await cleanUpLeftovers({
    store: state,
    control: new NodeProcessControl({ runner }),
    bridge: adb ? new AdbDeviceBridge({ runner, clock, adb }) : undefined,
  });
  if (left.stopped.length > 0 || left.reverse.length > 0) {
    await log("info", "leftovers-cleaned", { ...left });
  }
}

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
  await log("info", "app-started", {
    version: app.getVersion(),
    platform: process.platform,
    testMode,
  });
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
      isKnownLink: (url) => links.has(url),
      openLink: (url) => shell.openExternal(url),
      copyText: (text) => clipboard.writeText(text),
      settings,
      projects,
      checkEnvironment: async (onProgress) => {
        const view = await checkTools({
          probe,
          paths: {},
          platform: process.platform,
          now: () => clock.now(),
          onProgress,
        });
        const statuses = view.tools.map((t) => t.status);
        await log("info", "environment-checked", {
          tools: statuses,
          tookMs: view.tookMs,
        });
        void cleanUpOnce(statuses).catch((error: unknown) =>
          log("error", "leftovers-cleanup-failed", { error: String(error) }),
        );
        return view;
      },
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

// REL-3: every program Jagra started stops when it quits. Emulators keep running (DEV-5).
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting || runner.count === 0) return;
  event.preventDefault();
  quitting = true;
  void runner.stopAll().finally(() => app.quit());
});
