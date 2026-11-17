import type { ToolStatus } from "@jagra/core";
import { z } from "zod";
import {
  CHANNELS,
  EVENTS,
  type AppInfo,
  type EnvironmentView,
  type SettingsView,
  type SecretName,
} from "../shared/api.js";
import type { SecretStore } from "@jagra/core";
import type { Agents } from "./agents.js";
import type { Ai } from "./ai.js";
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
  agents: Agents;
  ai: Ai;
  checkEnvironment(
    onProgress: (status: ToolStatus) => void,
  ): Promise<EnvironmentView>;
  /** ENV-6, FLOW-5: paths come only from system dialogs that main opens. */
  pickToolPath(tool: ToolStatus["tool"]): Promise<SettingsView | undefined>;
  resetToolPath(tool: ToolStatus["tool"]): Promise<SettingsView>;
  pickEditor(): Promise<SettingsView | undefined>;
  resetEditor(): Promise<SettingsView>;
  /** REL-7 */
  copyBugInfo(): Promise<void>;
  /** FLOW-8: tells every window that a project's flows changed. */
  flowsChanged(projectId: string): void;
  /** FLOW-7 */
  secretNames(projectId: string): Promise<SecretName[] | undefined>;
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
  on(
    CHANNELS.projectsNewFlow,
    z.tuple([z.string().min(1).max(100), z.string().trim().min(1).max(100)]),
    ([projectId, name]) => projects.newFlow(projectId, name),
  );
  on(CHANNELS.projectsWatchFlows, id, ([projectId]) =>
    projects.watchFlows(projectId, () => handlers.flowsChanged(projectId)),
  );
  on(CHANNELS.projectsUnwatchFlows, z.tuple([]), () => projects.unwatchFlows());
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
        flows: z
          .array(z.string().regex(/^[^\\/]{1,255}\.ya?ml$/i))
          .min(1)
          .max(100)
          .optional(),
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
  on(
    CHANNELS.runsFlowDetail,
    z.tuple([
      z.string().min(1).max(100),
      z.string().regex(RUN_ID),
      z.int().min(0).max(10_000),
    ]),
    ([projectId, runId, index]) => runs.flowDetail(projectId, runId, index),
  );
  on(
    CHANNELS.runsHistory,
    z.tuple([z.string().min(1).max(100)]),
    ([projectId]) => runs.history(projectId),
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
  on(
    CHANNELS.secretsList,
    z.tuple([z.string().min(1).max(100)]),
    ([projectId]) => handlers.secretNames(projectId),
  );
  on(
    CHANNELS.secretsRemove,
    z.tuple([
      z.string().min(1).max(100),
      z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/),
    ]),
    async ([projectId, name]) => {
      if (!(await projects.exists(projectId)))
        throw new RejectedCallError("unknown project");
      await handlers.secrets.remove(projectId, name);
    },
  );

  // Create flow with AI (spec section 10). Paths come only from main's own lists (AGT-19, AGT-20).
  const { ai } = handlers;
  const relativePath = z
    .string()
    .min(1)
    .max(1000)
    .refine((path) => !path.split(/[\\/]/).includes(".."));
  on(CHANNELS.aiNotice, id, ([projectId]) => ai.notice(projectId));
  on(CHANNELS.aiAcceptNotice, id, ([projectId]) => ai.acceptNotice(projectId));
  on(
    CHANNELS.aiStart,
    z.tuple([
      z.strictObject({
        projectId: z.string().min(1).max(100),
        scenario: z.string().trim().min(1).max(10_000),
        flowName: z.string().trim().max(100).optional(),
      }),
    ]),
    ([request]) => ai.start(request),
  );
  on(CHANNELS.aiCancel, z.tuple([]), () => ai.cancel());
  on(CHANNELS.aiLive, z.tuple([]), () => ai.state());
  on(CHANNELS.aiRestore, z.tuple([]), () => ai.restore());
  on(CHANNELS.aiKeep, z.tuple([]), () => ai.keep());
  on(
    CHANNELS.aiViewChange,
    z.tuple([z.enum(["outside", "flow"]), relativePath]),
    ([kind, path]) => ai.viewChange(kind, path),
  );
  on(CHANNELS.aiUndoFlow, z.tuple([relativePath]), ([path]) =>
    ai.undoFlow(path),
  );
  on(CHANNELS.aiReview, z.tuple([z.string().regex(RUN_ID)]), ([runId]) =>
    ai.review(runId),
  );
  on(
    CHANNELS.aiFix,
    z.tuple([
      z.strictObject({
        note: z.string().max(10_000),
        runId: z.string().regex(RUN_ID).optional(),
      }),
    ]),
    ([request]) => ai.fix(request),
  );
  on(CHANNELS.aiSave, z.tuple([]), () => ai.save());
  on(CHANNELS.aiDiscard, z.tuple([]), () => ai.discard());

  // AGT-1 to AGT-3. A command is only text here; main splits it and the user confirms it (D-109).
  const { agents } = handlers;
  const name = z.string().trim().min(1).max(60);
  const command = z.string().trim().min(1).max(2000);
  on(CHANNELS.agentsView, z.tuple([]), () => agents.view());
  on(CHANNELS.agentsChoose, id, ([agent]) => agents.choose(agent));
  on(
    CHANNELS.agentsAddCustom,
    z.tuple([
      z.discriminatedUnion("protocol", [
        z.strictObject({ name, protocol: z.literal("acp"), command }),
        z.strictObject({
          name,
          protocol: z.literal("cli"),
          start: command,
          continue: z.string().trim().max(2000).optional(),
        }),
      ]),
    ]),
    ([input]) => agents.addCustom(input),
  );
  on(CHANNELS.agentsRemoveCustom, id, ([agent]) => agents.removeCustom(agent));

  const tool = z.tuple([
    z.enum(["java", "adb", "maestro", "emulator", "mockoon"]),
  ]);
  on(CHANNELS.settingsPickToolPath, tool, ([name]) =>
    handlers.pickToolPath(name),
  );
  on(CHANNELS.settingsResetToolPath, tool, ([name]) =>
    handlers.resetToolPath(name),
  );
  on(CHANNELS.settingsPickEditor, z.tuple([]), () => handlers.pickEditor());
  on(CHANNELS.settingsResetEditor, z.tuple([]), () => handlers.resetEditor());
  on(CHANNELS.appCopyBugInfo, z.tuple([]), () => handlers.copyBugInfo());
}
