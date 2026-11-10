import { readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { checkAndroidVersion } from "../devices/android.js";
import { installApk } from "../devices/install.js";
import { prepareDevice } from "../devices/prepare.js";
import { fail, ok, type JagraError, type Result } from "../errors/index.js";
import type { Clock } from "../ports/clock.js";
import type { DeviceBridge } from "../ports/device-bridge.js";
import type { FlowRunner, FlowRunOutcome } from "../ports/flow-runner.js";
import type { MockServer, MockServerHandle } from "../ports/mock-server.js";
import { outputMasker } from "../log/mask-files.js";
import type { ProjectMockoon } from "../mockoon/project.js";
import type {
  ReverseRecord,
  RunStateStore,
} from "../process/active-processes.js";
import type { FoundApk } from "../project/apk.js";
import type { Flow } from "../project/flow.js";
import { isBlackScreenshot } from "../results/png.js";
import { reportIndex, type ReportText } from "../results/report-index.js";
import { saveRun } from "../results/run-store.js";
import type {
  AndroidVersion,
  ApkInfo,
  Device,
  FlowResult,
  Run,
  RunStatus,
} from "../types/index.js";

export interface RunInput {
  runId: string;
  projectId: string;
  /** Where `run.json`, the report index and each flow's output go. */
  runFolder: string;
  appId: string;
  /** The chosen flows, in order, all free of problems. */
  flows: Flow[];
  /** The variables each flow needs, by flow file (RUN-10). */
  needs: Readonly<Record<string, readonly string[]>>;
  /** A value for every needed variable. */
  values: Readonly<Record<string, string>>;
  apk: FoundApk;
  apkInfo: ApkInfo;
  device: Device;
  flowTimeoutMinutes: number;
  /** Words for the report index. Without them no index is written. */
  reportText?: ReportText;
  /** The project's Mockoon, checked in step 1 (`projectMockoon`). */
  mockoon?: ProjectMockoon;
}

export interface RunPorts {
  bridge: DeviceBridge;
  flowRunner: FlowRunner;
  clock: Clock;
  /** Needed when the project uses Mockoon. */
  mockServer?: MockServer;
  /** Where Mockoon's port and the reverse rule are recorded for cleanup after a crash (REL-2). */
  state?: RunStateStore;
}

/** Progress for the Running screen and the CLI (architecture.md, Events). */
export type RunEvent =
  | { type: "run-started"; run: Run }
  | { type: "starting-emulator" }
  | { type: "android-version"; version: AndroidVersion; supported: boolean }
  | { type: "installing" }
  | { type: "starting-mockoon"; port: number }
  | { type: "flow-started"; index: number; flow: FlowResult }
  | { type: "flow-step"; index: number; label: string }
  | { type: "flow-finished"; index: number; flow: FlowResult }
  | { type: "run-finished"; run: Run };

export interface RunOptions {
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  /** Asked when the installed app was signed with another key (RUN-3). */
  confirmUninstall: () => Promise<boolean>;
}

/**
 * Steps 2 to 6 of a run (spec section 7): prepare the device, install, then for each flow clear the
 * app's data and run it, saving each result as soon as it is known (REL-1). The checks of step 1
 * happen before, in `planRun`. Mockoon joins in M6 (D-52).
 */
export async function executeRun(
  input: RunInput,
  ports: RunPorts,
  options: RunOptions,
): Promise<Result<Run>> {
  const { bridge, flowRunner, clock } = ports;
  const { signal } = options;
  const emit = (event: RunEvent) => options.onEvent?.(event);

  const run: Run = {
    id: input.runId,
    projectId: input.projectId,
    status: "running",
    startedAt: new Date(clock.now()).toISOString(),
    apk: {
      file: input.apk.path,
      ...input.apkInfo,
      modifiedAt: input.apk.modifiedAt,
    },
    device: {
      id: input.device.id,
      name: input.device.name,
      kind: input.device.kind,
    },
    flows: input.flows.map((f) => ({
      file: f.file,
      name: f.name,
      status: "waiting",
    })),
    pid: process.pid,
  };
  const save = async (): Promise<Result<void>> => {
    try {
      await saveRun(input.runFolder, run);
      return ok(undefined);
    } catch (e) {
      return fail({
        code: "RUN_SAVE_FAILED",
        folder: input.runFolder,
        detail: String(e),
      });
    }
  };
  const saved = await save();
  if (!saved.ok) return saved;
  emit({ type: "run-started", run });

  // Step 6 for Mockoon: whatever happens, stop it and remove the reverse rule (MCK-4, MCK-5).
  let mock: MockServerHandle | undefined;
  let reverse: ReverseRecord | undefined;
  const mockLog: string[] = [];
  const tearDown = async () => {
    if (reverse) {
      const rule = reverse;
      reverse = undefined;
      await bridge.removeReverse(rule.deviceId, rule.port);
      await ports.state?.removeReverse(rule).catch(() => undefined);
    }
    if (mock) {
      const server = mock;
      mock = undefined;
      await server.stop();
    }
    if (mockLog.length > 0) {
      // Mockoon logs requests, which may carry secrets the app sent (D-64).
      const masker = outputMasker(Object.values(input.values));
      await writeFile(
        join(input.runFolder, "mockoon.log"),
        `${mockLog.map((line) => masker.mask(line)).join("\n")}\n`,
      ).catch(() => undefined);
      mockLog.length = 0;
    }
  };

  const finish = async (
    status: RunStatus,
    stopReason?: JagraError,
  ): Promise<Result<Run>> => {
    await tearDown();
    const leftover = status === "cancelled" ? "cancelled" : "not-run";
    run.flows = run.flows.map((f) =>
      f.status === "waiting" || f.status === "running"
        ? { ...f, status: leftover }
        : f,
    );
    run.status = status;
    if (stopReason) run.stopReason = stopReason;
    run.endedAt = new Date(clock.now()).toISOString();
    const done = await save();
    if (input.reportText) {
      await writeFile(
        join(input.runFolder, "index.html"),
        reportIndex(run, input.reportText),
      ).catch(() => undefined);
    }
    emit({ type: "run-finished", run });
    return done.ok ? ok(run) : done;
  };
  const stopped = (error: JagraError) =>
    finish(error.code === "CANCELLED" ? "cancelled" : "stopped", error);

  // Step 2: the device (DEV-4).
  const prepared = await prepareDevice({
    bridge,
    clock,
    device: input.device,
    signal,
    onEvent: () => emit({ type: "starting-emulator" }),
  });
  if (!prepared.ok) return stopped(prepared.error);
  const deviceId = prepared.value.id;
  run.device.id = deviceId;
  const android = await checkAndroidVersion(bridge, deviceId, signal);
  if (android.ok) {
    run.device.androidVersion = android.value.version.release;
    emit({ type: "android-version", ...android.value });
  }

  // Step 3: install (RUN-3).
  emit({ type: "installing" });
  const installed = await installApk({
    bridge,
    deviceId,
    apkPath: input.apk.path,
    packageName: input.apkInfo.packageName,
    confirmUninstall: options.confirmUninstall,
    signal,
  });
  if (!installed.ok) return stopped(installed.error);

  try {
    // Step 4: Mockoon and its reverse rule (MCK-2, MCK-4).
    if (input.mockoon) {
      if (!ports.mockServer) {
        return await stopped({ code: "PROGRAM_NOT_FOUND", program: "mockoon" });
      }
      emit({ type: "starting-mockoon", port: input.mockoon.port });
      const started = await ports.mockServer.start({
        file: input.mockoon.file,
        port: input.mockoon.port,
        signal,
        onLine: (line) => mockLog.push(line),
      });
      if (!started.ok) return await stopped(started.error);
      mock = started.value;
      await ports.state?.setPort(mock.pid, mock.port).catch(() => undefined);
      // Recorded before it is added, so a crash in between still leaves a record.
      reverse = { deviceId, port: mock.port, owner: process.pid };
      await ports.state?.addReverse(reverse).catch(() => undefined);
      const added = await bridge.addReverse(deviceId, mock.port, signal);
      if (!added.ok) return await stopped(added.error);
    }

    return await runFlows();
  } finally {
    await tearDown();
  }

  async function runFlows(): Promise<Result<Run>> {
    // A device that leaves the list stops the current flow at once (DEV-9).
    const lost = new AbortController();
    const stopWatching = bridge.watch((devices) => {
      if (!devices.some((d) => d.id === deviceId)) lost.abort();
    });
    try {
      // Step 5: one flow at a time (RUN-4, RUN-5).
      for (const [index, flow] of input.flows.entries()) {
        if (signal?.aborted) return await finish("cancelled");
        if (lost.signal.aborted)
          return await stopped({ code: "DEVICE_NOT_FOUND", deviceId });
        const result = run.flows[index];
        if (!result) continue;
        result.status = "running";
        await save();
        emit({ type: "flow-started", index, flow: result });

        const started = clock.now();
        const flowSignal = signal
          ? AbortSignal.any([signal, lost.signal])
          : lost.signal;
        const cleared = await bridge.clearAppData(
          deviceId,
          input.appId,
          flowSignal,
        );
        const outputDir = join(
          input.runFolder,
          "flows",
          flowFolder(index, flow),
        );
        const outcome: Result<FlowRunOutcome> = cleared.ok
          ? await flowRunner.run({
              deviceId,
              flowFile: flow.file,
              name: flow.name,
              appId: input.appId,
              variables: pick(input.values, input.needs[flow.file] ?? []),
              timeoutMs: input.flowTimeoutMinutes * 60_000,
              outputDir,
              signal: flowSignal,
              onStep: (label) => emit({ type: "flow-step", index, label }),
            })
          : cleared;

        const deviceGone =
          lost.signal.aborted ||
          (!isPassed(outcome) &&
            !signal?.aborted &&
            !(await isConnected(bridge, deviceId)));
        const finished = await toResult(outcome, input.runFolder, {
          deviceGone,
          cancelled: !!signal?.aborted,
        });
        Object.assign(result, finished, { durationMs: clock.now() - started });
        await save();
        emit({ type: "flow-finished", index, flow: result });

        if (deviceGone)
          return await stopped({ code: "DEVICE_NOT_FOUND", deviceId });
        if (finished.status === "cancelled") return await finish("cancelled");
      }
      return await finish("completed");
    } finally {
      stopWatching();
    }
  }
}

function isPassed(outcome: Result<FlowRunOutcome>): boolean {
  return outcome.ok && outcome.value.status === "passed";
}

/** A flow that failed may have failed because the phone was unplugged (DEV-9). */
async function isConnected(
  bridge: DeviceBridge,
  deviceId: string,
): Promise<boolean> {
  const listed = await bridge.list();
  if (!listed.ok) return true;
  const device = listed.value.find((d) => d.id === deviceId);
  return (
    device?.state === "emulator-running" || device?.state === "phone-ready"
  );
}

async function toResult(
  outcome: Result<FlowRunOutcome>,
  runFolder: string,
  context: { deviceGone: boolean; cancelled: boolean },
): Promise<Partial<FlowResult>> {
  if (context.deviceGone)
    return { status: "failed", failure: "device-disconnected" };
  if (!outcome.ok) {
    return outcome.error.code === "CANCELLED" || context.cancelled
      ? { status: "cancelled" }
      : { status: "failed", failure: "error", error: outcome.error };
  }
  const value = outcome.value;
  const result: Partial<FlowResult> = {};
  // Forward slashes, so the run folder still works when zipped and opened elsewhere (RES-6).
  const relativeTo = (path?: string) =>
    path ? relative(runFolder, path).split(sep).join("/") : undefined;
  const set = <K extends keyof FlowResult>(
    key: K,
    item: FlowResult[K] | undefined,
  ) => {
    if (item !== undefined) result[key] = item;
  };
  set("steps", value.steps);
  set("failedStep", value.failedStep);
  set("reason", value.reason);
  set("detail", value.detail);
  set("screen", value.screen);
  set("screenshot", relativeTo(value.screenshot));
  set("crashReport", relativeTo(value.crashReport));
  set("report", relativeTo(value.report));
  if (value.screenshot) {
    const png = await readFile(value.screenshot).catch(() => undefined);
    if (png && isBlackScreenshot(png)) result.blackScreenshot = true;
  }
  switch (value.status) {
    case "passed":
      return { ...result, status: "passed" };
    case "cancelled":
      return { ...result, status: "cancelled" };
    case "failed":
      return { ...result, status: "failed", failure: "step" };
    case "timed-out":
      return { ...result, status: "failed", failure: "timed-out" };
    case "app-crashed":
      return { ...result, status: "failed", failure: "app-crashed" };
    case "app-not-responding":
      return { ...result, status: "failed", failure: "app-not-responding" };
  }
}

/** `03-save-item`: numbered, so two flows with the same name never share a folder. */
function flowFolder(index: number, flow: Flow): string {
  const stem = (flow.file.split(/[\\/]/).at(-1) ?? "flow").replace(
    /\.ya?ml$/i,
    "",
  );
  return `${String(index + 1).padStart(2, "0")}-${stem.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
}

function pick(
  values: Readonly<Record<string, string>>,
  names: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    names.flatMap((n) => (values[n] === undefined ? [] : [[n, values[n]]])),
  );
}
