import type { ToolStatus } from "@jagra/core";
import { z } from "zod";
import {
  CHANNELS,
  EVENTS,
  type AppInfo,
  type EnvironmentView,
  type SettingsView,
} from "../shared/api.js";
import type { SecretStore } from "@jagra/core";
import type { Devices } from "./devices.js";
import { RUN_ID, type Runs } from "./runs.js";
import type { Projects } from "./projects.js";
import { settingsSchema, type SettingsFile } from "./settings.js";

/** What main does for each preload function. */
export interface Handlers {
  appInfo(): AppInfo;
  /** Opens a link only when `isKnownLink` allows it. */
  openLink(url: string): Promise<void>;
  isKnownLink(url: string): boolean;
  copyText(text: string): Promise<void>;
  settings: SettingsFile;
  projects: Projects;
  devices: Devices;
  runs: Runs;
  secrets: SecretStore;
  checkEnvironment(
    onProgress: (status: ToolStatus) => void,
  ): Promise<EnvironmentView>;
}

/** The part of an IPC event the handlers use. */
export interface CallEvent {
  senderFrame: { url: string } | null;
  sender: { send(channel: string, ...args: unknown[]): void };
}

/** The part of `ipcMain` the handlers need, so tests can pass a fake. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: CallEvent, ...args: unknown[]) => unknown,
  ): void;
}

/** Raised for a call main refuses. The renderer sees only that it failed (SEC-6). */
export class RejectedCallError extends Error {}

/**
 * Registers every channel of the preload API. Each call is checked twice: it must come from the
 * app's own page, and its arguments must match the schema (SEC-6).
 */
export function registerIpc(
  ipc: IpcMainLike,
  handlers: Handlers,
  isOwnPage: (url: string) => boolean,
): void {
  const on = <T extends z.ZodType>(
    channel: string,
    schema: T,
    run: (args: z.infer<T>, event: CallEvent) => unknown,
  ) => {
    ipc.handle(channel, (event, ...args) => {
      if (!event.senderFrame || !isOwnPage(event.senderFrame.url)) {
        throw new RejectedCallError(`${channel}: not from the app's own page`);
      }
      const parsed = schema.safeParse(args);
      if (!parsed.success)
        throw new RejectedCallError(`${channel}: invalid arguments`);
      return run(parsed.data, event);
    });
  };

  on(CHANNELS.appInfo, z.tuple([]), () => handlers.appInfo());
  on(CHANNELS.appOpenLink, z.tuple([z.string().max(2048)]), ([url]) => {
    if (!handlers.isKnownLink(url))
      throw new RejectedCallError(`${CHANNELS.appOpenLink}: unknown link`);
    return handlers.openLink(url);
  });
  on(CHANNELS.appCopyText, z.tuple([z.string().max(100_000)]), ([text]) =>
    handlers.copyText(text),
  );
  on(CHANNELS.settingsGet, z.tuple([]), (): Promise<SettingsView> =>
    handlers.settings.view(),
  );
  on(CHANNELS.settingsSet, z.tuple([settingsSchema]), ([change]) =>
    handlers.settings.update(change),
  );
  on(CHANNELS.environmentCheck, z.tuple([]), (_args, event) =>
    handlers.checkEnvironment((status) =>
      event.sender.send(EVENTS.environmentProgress, status),
    ),
  );

  const id = z.tuple([z.string().min(1).max(100)]);
  const { projects } = handlers;
  on(CHANNELS.projectsList, z.tuple([]), () => projects.list());
  on(CHANNELS.projectsGet, id, ([projectId]) => projects.get(projectId));
  on(CHANNELS.projectsPickFolder, z.tuple([]), () => projects.pickFolder());
  on(CHANNELS.projectsPickApk, z.tuple([]), () => projects.pickApk());
  on(CHANNELS.projectsPickMockoon, z.tuple([]), () => projects.pickMockoon());
  on(
    CHANNELS.projectsCreate,
    z.tuple([
      z.strictObject({
        name: z.string().trim().min(1).max(100),
        apk: z.enum(["search", "picked"]),
      }),
    ]),
    ([project]) => projects.create(project),
  );
  on(CHANNELS.projectsRemove, id, ([projectId]) => projects.remove(projectId));
  on(CHANNELS.projectsLocate, id, ([projectId]) => projects.locate(projectId));
  on(CHANNELS.projectsOpenConfig, id, ([projectId]) =>
    projects.openConfig(projectId),
  );
  on(CHANNELS.projectsSampleFolder, z.tuple([]), () => projects.sampleFolder());
  on(CHANNELS.projectsTrySample, z.tuple([]), () => projects.trySample());
  on(CHANNELS.projectsApk, id, ([projectId]) => projects.apkOf(projectId));
  on(
    CHANNELS.projectsChooseFlows,
    z.tuple([
      z.string().min(1).max(100),
      z.array(z.string().min(1).max(255)).max(1000),
    ]),
    ([projectId, files]) => projects.chooseFlows(projectId, files),
  );
  on(
    CHANNELS.projectsChooseDevice,
    z.tuple([z.string().min(1).max(100), z.string().min(1).max(255)]),
    ([projectId, deviceId]) => projects.chooseDevice(projectId, deviceId),
  );
  on(
    CHANNELS.projectsChangeApk,
    z.tuple([z.string().min(1).max(100), z.enum(["file", "newest"])]),
    ([projectId, to]) => projects.changeApk(projectId, to),
  );
  on(
    CHANNELS.projectsOpenFlow,
    z.tuple([z.string().min(1).max(100), z.string().min(1).max(1024)]),
    ([projectId, file]) => projects.openFlow(projectId, file),
  );
  on(CHANNELS.devicesWatch, z.tuple([]), () => handlers.devices.watch());
  on(CHANNELS.devicesRefresh, z.tuple([]), () => handlers.devices.refresh());

  const { runs } = handlers;
  on(
    CHANNELS.runsStart,
    z.tuple([
      z.strictObject({
        projectId: z.string().min(1).max(100),
        deviceId: z.string().min(1).max(255),
        acceptPackage: z.boolean().optional(),
      }),
    ]),
    ([request]) => runs.start(request),
  );
  on(CHANNELS.runsCancel, z.tuple([]), () => runs.cancel());
  on(CHANNELS.runsAnswerUninstall, z.tuple([z.boolean()]), ([uninstall]) =>
    runs.answerUninstall(uninstall),
  );
  on(CHANNELS.runsLive, z.tuple([]), () => runs.current());
  const runRef = z.tuple([
    z.string().min(1).max(100),
    z.string().regex(RUN_ID),
  ]);
  on(CHANNELS.runsResult, runRef, ([projectId, runId]) =>
    runs.result(projectId, runId),
  );
  on(CHANNELS.runsOpenReport, runRef, ([projectId, runId]) =>
    runs.openReport(projectId, runId),
  );
  // RUN-10: the value goes straight to the SecretStore and is never sent back (SEC-3).
  on(
    CHANNELS.secretsSet,
    z.tuple([
      z.string().min(1).max(100),
      z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/),
      z.string().max(10_000),
    ]),
    async ([projectId, name, value]) => {
      if (!(await projects.exists(projectId)))
        throw new RejectedCallError("unknown project");
      await handlers.secrets.set(projectId, name, value);
    },
  );
}
