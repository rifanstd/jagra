import { join } from "node:path";
import {
  applyRetention,
  checkAppId,
  executeRun,
  fillAppId,
  findApk,
  knownProjects,
  loadConfig,
  loadLocal,
  loadRun,
  markInterruptedRuns,
  newRunId,
  planRun,
  projectMockoon,
  runsFolder,
  type ApkReader,
  type Clock,
  type DeviceBridge,
  type FlowRunner,
  type MockServer,
  type PortChecker,
  type ReportText,
  type RunEvent,
  type RunStateStore,
  type SecretStore,
  type ToolName,
  type ToolStatus,
} from "@jagra/core";
import type {
  LiveRun,
  RunResult,
  StartAnswer,
  StartRun,
} from "../shared/api.js";

/** The tools every run needs; Mockoon CLI only for a project that uses it (ENV-7). */
const RUN_TOOLS: readonly ToolName[] = ["java", "adb", "maestro", "emulator"];

/** A run id as `newRunId` makes it, so a run id from the renderer can never leave the runs folder. */
export const RUN_ID = /^\d{8}-\d{6}-\d{3}-[0-9a-f]{4}$/;

export interface RunsOptions {
  appData: string;
  clock: Clock;
  secrets: SecretStore;
  apkReader: ApkReader;
  checkTools(tools: readonly ToolName[]): Promise<ToolStatus[]>;
  /** The device bridge of the device list, once adb is known. */
  bridge(): DeviceBridge | undefined;
  flowRunner(tools: ToolStatus[]): FlowRunner;
  mockServer(tools: ToolStatus[]): MockServer;
  ports: PortChecker;
  state: RunStateStore;
  isAlive: (pid: number) => boolean;
  /** Words for the report index, in the user's language (RES-6). */
  reportText(): Promise<ReportText>;
  openPath(path: string): Promise<void>;
  /** Sends the run's progress to every window. */
  broadcast(live: LiveRun): void;
}

/**
 * Runs from the desktop app, in the same order and with the same rules as `jagra run`
 * (spec section 7). One run at a time (DEV-8). The run belongs to main, so it goes on while the
 * user looks at other screens.
 */
export class Runs {
  private live: LiveRun | undefined;
  private abort: AbortController | undefined;
  private uninstallAnswer: ((uninstall: boolean) => void) | undefined;

  constructor(private readonly options: RunsOptions) {}

  current(): LiveRun | undefined {
    return this.live;
  }

  get active(): boolean {
    return this.live !== undefined && !this.live.finished;
  }

  async start(request: StartRun): Promise<StartAnswer> {
    if (this.active) throw new Error("a run is already active");
    const { options } = this;
    const project = (await knownProjects(options.appData)).find(
      (p) => p.id === request.projectId,
    );
    if (!project) throw new Error("unknown project");
    const folder = project.folder;

    // Step 1: everything that must be right before anything touches the device.
    const config = await loadConfig(folder);
    if (!config.ok) return { error: config.error };
    const usesMockoon = config.value.mockoon !== undefined;
    const tools = await options.checkTools(
      usesMockoon ? [...RUN_TOOLS, "mockoon"] : RUN_TOOLS,
    );
    const broken = tools.filter(
      (t) =>
        (t.required || (usesMockoon && t.tool === "mockoon")) &&
        t.state !== "ready" &&
        t.state !== "untested-version",
    );
    if (broken.length > 0) return { tools: broken };

    const local = await loadLocal(options.appData, project.id);
    const apk = await findApk(folder, config.value, local.apk);
    if (!apk.ok) return { error: apk.error };
    const info = await options.apkReader.read(apk.value.path);
    if (!info.ok) return { error: info.error };
    let appId = config.value.appId;
    const appIdCheck = checkAppId(config.value, info.value);
    if (appIdCheck.result === "empty") {
      const filled = await fillAppId(folder, appIdCheck.packageName);
      if (!filled.ok) return { error: filled.error };
      appId = appIdCheck.packageName;
    } else if (appIdCheck.result === "different" && !request.acceptPackage) {
      return {
        packageDiffers: {
          appId: appIdCheck.appId,
          packageName: appIdCheck.packageName,
        },
      };
    }

    const plan = await planRun({
      projectFolder: folder,
      chosen: local.flows,
      secret: (name) => options.secrets.get(project.id, name),
    });
    if (!plan.ok) {
      return plan.error.code === "SECRETS_MISSING"
        ? { secrets: plan.error.names }
        : { error: plan.error };
    }

    const bridge = options.bridge();
    if (!bridge)
      return { error: { code: "PROGRAM_NOT_FOUND", program: "adb" } };
    const mockoon = await projectMockoon(folder, config.value, options.ports);
    if (!mockoon.ok) return { error: mockoon.error };
    const listed = await bridge.list();
    if (!listed.ok) return { error: listed.error };
    const device = listed.value.find((d) => d.id === request.deviceId);
    if (!device)
      return {
        error: { code: "DEVICE_NOT_FOUND", deviceId: request.deviceId },
      };

    // REL-2: a run left behind by a Jagra that crashed shows as Interrupted.
    const runs = runsFolder(options.appData, project.id);
    await markInterruptedRuns(runs, options.isAlive, options.clock.now());
    const runId = newRunId(options.clock.now());
    const reportText = await options.reportText();

    const abort = new AbortController();
    this.abort = abort;
    this.live = {
      projectId: project.id,
      projectName: config.value.name,
      run: {
        id: runId,
        projectId: project.id,
        status: "running",
        startedAt: new Date(options.clock.now()).toISOString(),
        apk: {
          file: apk.value.path,
          ...info.value,
          modifiedAt: apk.value.modifiedAt,
        },
        device: { id: device.id, name: device.name, kind: device.kind },
        flows: plan.value.flows.map((f) => ({
          file: f.file,
          name: f.name,
          status: "waiting",
        })),
        pid: process.pid,
      },
      device: "working",
      startingEmulator: false,
      install: "waiting",
      mockoon: mockoon.value ? "waiting" : "skipped",
      mockoonPort: mockoon.value?.port,
      askUninstall: false,
      cancelling: false,
      finished: false,
    };
    this.send();

    void executeRun(
      {
        runId,
        projectId: project.id,
        runFolder: join(runs, runId),
        appId,
        flows: plan.value.flows,
        needs: plan.value.needs,
        values: plan.value.values,
        apk: apk.value,
        apkInfo: info.value,
        device,
        flowTimeoutMinutes: config.value.run.flowTimeoutMinutes,
        reportText,
        mockoon: mockoon.value,
      },
      {
        bridge,
        flowRunner: options.flowRunner(tools),
        clock: options.clock,
        mockServer: mockoon.value ? options.mockServer(tools) : undefined,
        state: options.state,
      },
      {
        signal: abort.signal,
        onEvent: (event) => this.update(event),
        confirmUninstall: () => this.askUninstall(),
      },
    )
      .then(async (result) => {
        if (!result.ok && this.live) this.live.error = result.error;
        await applyRetention(runs).catch(() => undefined);
      })
      .finally(() => {
        if (this.live) this.live.finished = true;
        this.abort = undefined;
        this.send();
      });
    return { started: true };
  }

  /** RUN-9: stops the current flow at once; the rest are marked Cancelled. */
  cancel(): void {
    if (!this.active || !this.live) return;
    this.live.cancelling = true;
    this.uninstallAnswer?.(false);
    this.abort?.abort();
    this.send();
  }

  answerUninstall(uninstall: boolean): void {
    this.uninstallAnswer?.(uninstall);
  }

  async result(
    projectId: string,
    runId: string,
  ): Promise<RunResult | undefined> {
    if (!RUN_ID.test(runId)) return undefined;
    const project = (await knownProjects(this.options.appData)).find(
      (p) => p.id === projectId,
    );
    if (!project) return undefined;
    const run = await loadRun(
      join(runsFolder(this.options.appData, projectId), runId),
    );
    if (!run) return undefined;
    const config = await loadConfig(project.folder);
    return {
      projectName: config.ok ? config.value.name : project.folder,
      run,
      mockoon: config.ok && config.value.mockoon !== undefined,
    };
  }

  async openReport(projectId: string, runId: string): Promise<void> {
    if (!RUN_ID.test(runId)) return;
    const known = (await knownProjects(this.options.appData)).some(
      (p) => p.id === projectId,
    );
    if (known) {
      await this.options.openPath(
        join(runsFolder(this.options.appData, projectId), runId, "index.html"),
      );
    }
  }

  private askUninstall(): Promise<boolean> {
    return new Promise((resolve) => {
      this.uninstallAnswer = (uninstall) => {
        this.uninstallAnswer = undefined;
        if (this.live) this.live.askUninstall = false;
        this.send();
        resolve(uninstall);
      };
      if (this.live) this.live.askUninstall = true;
      this.send();
    });
  }

  private update(event: RunEvent): void {
    const live = this.live;
    if (!live) return;
    switch (event.type) {
      case "run-started":
      case "run-finished":
        live.run = structuredClone(event.run);
        break;
      case "starting-emulator":
        live.startingEmulator = true;
        break;
      case "android-version":
        live.device = "done";
        live.startingEmulator = false;
        live.run.device.androidVersion = event.version.release;
        if (!event.supported) live.oldAndroid = event.version.release;
        break;
      case "installing":
        live.device = "done";
        live.install = "working";
        break;
      case "starting-mockoon":
        live.install = "done";
        live.mockoon = "working";
        break;
      case "flow-started":
        live.device = "done";
        live.install = "done";
        if (live.mockoon === "working") live.mockoon = "done";
        live.step = undefined;
        live.run.flows[event.index] = structuredClone(event.flow);
        break;
      case "flow-step":
        live.step = event.label;
        break;
      case "flow-finished":
        live.step = undefined;
        live.run.flows[event.index] = structuredClone(event.flow);
        break;
    }
    this.send();
  }

  private send(): void {
    if (this.live) this.options.broadcast(this.live);
  }
}
