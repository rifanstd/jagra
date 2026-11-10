import { join, resolve } from "node:path";
import {
  applyRetention,
  checkAppId,
  executeRun,
  fillAppId,
  findApk,
  loadConfig,
  markInterruptedRuns,
  newRunId,
  planRun,
  runsFolder,
  cliProjectId,
  type ApkReader,
  type Clock,
  type Device,
  type DeviceBridge,
  type FlowResult,
  type FlowRunner,
  type JagraError,
  type Run,
  type RunEvent,
  type SecretStore,
  type ToolName,
  type ToolStatus,
} from "@jagra/core";
import {
  describeError,
  FAILURE,
  FLOW_STATUS,
  REPORT_TEXT,
  RUN_STATUS,
} from "./text.js";

export interface RunArgs {
  folder?: string;
  device?: string;
  apk?: string;
  output?: string;
}

/** What `jagra run` needs from the machine. Tests pass fakes. */
export interface RunDeps {
  cwd: string;
  appData: string;
  clock: Clock;
  secrets: SecretStore;
  apkReader: ApkReader;
  /** The tools a run needs (ENV-7). */
  checkTools: (tools: readonly ToolName[]) => Promise<ToolStatus[]>;
  bridge: (tools: ToolStatus[]) => DeviceBridge;
  flowRunner: (tools: ToolStatus[]) => FlowRunner;
  isAlive: (pid: number) => boolean;
  out: (line: string) => void;
  signal?: AbortSignal;
}

/** CLI-4 */
export const EXIT = { passed: 0, failed: 1, notRun: 2 } as const;

const RUN_TOOLS: readonly ToolName[] = ["java", "adb", "maestro", "emulator"];

/** `jagra run` (CLI-1 to CLI-4): the same order and rules as a run in the app (spec section 7). */
export async function runCommand(
  args: RunArgs,
  deps: RunDeps,
): Promise<number> {
  const { out } = deps;
  const stop = (error: JagraError) => {
    out(describeError(error));
    return EXIT.notRun;
  };
  const folder = resolve(deps.cwd, args.folder ?? ".");

  const config = await loadConfig(folder);
  if (!config.ok) return stop(config.error);

  // Step 1: tools, APK, package, secrets (spec section 7).
  const tools = await deps.checkTools(RUN_TOOLS);
  const broken = tools.filter(
    (t) => t.required && t.state !== "ready" && t.state !== "untested-version",
  );
  if (broken.length > 0) {
    for (const tool of broken) out(toolLine(tool));
    return EXIT.notRun;
  }

  const apk = await findApk(
    folder,
    config.value,
    args.apk && resolve(deps.cwd, args.apk),
  );
  if (!apk.ok) return stop(apk.error);
  const info = await deps.apkReader.read(apk.value.path);
  if (!info.ok) return stop(info.error);
  let appId = config.value.appId;
  const appIdCheck = checkAppId(config.value, info.value);
  if (appIdCheck.result === "empty") {
    const filled = await fillAppId(folder, appIdCheck.packageName);
    if (!filled.ok) return stop(filled.error);
    appId = appIdCheck.packageName;
    out(`appId was empty; set it to ${appId} in .jagra/config.yaml.`);
  } else if (appIdCheck.result === "different") {
    // PRJ-6 asks before the run in the app. The CLI cannot ask, so it says so and goes on.
    out(
      `Warning: the APK is ${appIdCheck.packageName}, but appId in .jagra/config.yaml is ${appIdCheck.appId}.`,
    );
  }

  const projectId = await cliProjectId(deps.appData, folder);
  const plan = await planRun({
    projectFolder: folder,
    secret: (name) => deps.secrets.get(projectId, name),
  });
  for (const flow of plan.ok ? plan.value.skipped : []) {
    out(
      `SKIPPED ${fileName(flow.file)}: ${flow.problems.map(describeError).join(" ")}`,
    );
  }
  if (!plan.ok) return stop(plan.error);

  const bridge = deps.bridge(tools);
  const device = await chooseDevice(bridge, args.device);
  if (typeof device === "string") {
    out(device);
    return EXIT.notRun;
  }

  // REL-2: a run left behind by a Jagra that crashed shows as Interrupted.
  const runs = runsFolder(deps.appData, projectId);
  await markInterruptedRuns(runs, deps.isAlive, deps.clock.now());
  const runId = newRunId(deps.clock.now());
  const runFolder = args.output
    ? resolve(deps.cwd, args.output)
    : join(runs, runId);

  out(`Project ${config.value.name}`);
  out(
    `APK ${fileName(apk.value.path)} ${info.value.versionName} (${info.value.versionCode})`,
  );
  out(`Device ${device.name} (${device.id})`);
  const result = await executeRun(
    {
      runId,
      projectId,
      runFolder,
      appId,
      flows: plan.value.flows,
      needs: plan.value.needs,
      values: plan.value.values,
      apk: apk.value,
      apkInfo: info.value,
      device,
      flowTimeoutMinutes: config.value.run.flowTimeoutMinutes,
      reportText: REPORT_TEXT,
    },
    { bridge, flowRunner: deps.flowRunner(tools), clock: deps.clock },
    {
      signal: deps.signal,
      onEvent: (event) => printEvent(event, device, out),
      // The CLI cannot ask, and never uninstalls without a yes (RUN-3).
      confirmUninstall: () => Promise.resolve(false),
    },
  );
  if (!args.output) await applyRetention(runs);
  if (!result.ok) return stop(result.error);

  const run = result.value;
  out(summary(run, plan.value.skipped.length));
  if (run.stopReason && run.stopReason.code !== "CANCELLED")
    out(describeError(run.stopReason));
  out(`Report ${join(runFolder, "index.html")}`);
  if (run.status !== "completed") return EXIT.notRun;
  const allPassed = run.flows.every((f) => f.status === "passed");
  return allPassed && plan.value.skipped.length === 0
    ? EXIT.passed
    : EXIT.failed;
}

/** `--device`, or the only ready device (CLI-2). Returns a message when there is none. */
async function chooseDevice(
  bridge: DeviceBridge,
  wanted: string | undefined,
): Promise<Device | string> {
  const listed = await bridge.list();
  if (!listed.ok) return describeError(listed.error);
  const devices = listed.value;
  if (wanted !== undefined) {
    const device =
      devices.find((d) => d.id === wanted) ??
      devices.find((d) => d.name === wanted);
    return (
      device ??
      `No device or emulator is called ${wanted}. ${deviceList(devices)}`
    );
  }
  const ready = devices.filter(
    (d) => d.state === "emulator-running" || d.state === "phone-ready",
  );
  if (ready.length === 1 && ready[0]) return ready[0];
  if (ready.length === 0) {
    return `No device is ready. Start an emulator or connect a phone with USB debugging on, or choose one with --device. ${deviceList(devices)}`;
  }
  return `More than one device is ready. Choose one with --device. ${deviceList(devices)}`;
}

function deviceList(devices: Device[]): string {
  if (devices.length === 0) return "No device or emulator was found.";
  return `Found: ${devices.map((d) => `${d.name} (${d.id}, ${d.state})`).join(", ")}.`;
}

function printEvent(
  event: RunEvent,
  device: Device,
  out: (line: string) => void,
): void {
  switch (event.type) {
    case "starting-emulator":
      out(`Starting emulator ${device.name}...`);
      return;
    case "android-version":
      if (!event.supported) {
        out(
          `Warning: Android ${event.version.release} (API ${event.version.sdk}) is older than Maestro supports.`,
        );
      }
      return;
    case "installing":
      out("Installing the APK...");
      return;
    case "flow-finished":
      out(flowLine(event.flow));
      return;
    default:
      return;
  }
}

/** One line per flow as it finishes (CLI-4). */
export function flowLine(flow: FlowResult): string {
  const status = FLOW_STATUS[flow.status].toUpperCase().padEnd(9);
  const duration =
    flow.durationMs === undefined ? "" : `  ${seconds(flow.durationMs)}`;
  const why =
    flow.status === "failed" && flow.failure
      ? `  ${[
          FAILURE[flow.failure],
          flow.reason ?? (flow.error && describeError(flow.error)),
        ]
          .filter(Boolean)
          .join(": ")}`
      : "";
  return `${status} ${fileName(flow.file)}${duration}${why}`;
}

function summary(run: Run, skipped: number): string {
  const count = (status: FlowResult["status"]) =>
    run.flows.filter((f) => f.status === status).length;
  const parts = [
    `${count("passed")} passed`,
    `${count("failed")} failed`,
    ...(count("cancelled") ? [`${count("cancelled")} cancelled`] : []),
    ...(count("not-run") ? [`${count("not-run")} not run`] : []),
    ...(skipped ? [`${skipped} skipped`] : []),
  ];
  const took =
    run.endedAt === undefined
      ? ""
      : ` in ${seconds(Date.parse(run.endedAt) - Date.parse(run.startedAt))}`;
  return `${RUN_STATUS[run.status]}${took}: ${parts.join(", ")}.`;
}

function toolLine(tool: ToolStatus): string {
  const problem = tool.problem ? ` (${tool.problem})` : "";
  const state = {
    missing: "is missing",
    "too-old": `is too old (${tool.version ?? "unknown version"})`,
    "cant-start": `cannot start${problem}`,
    ready: "is ready",
    "untested-version": "is an untested version",
  }[tool.state];
  return `${tool.tool} ${state}. Install or update it, then run again.`;
}

function seconds(ms: number): string {
  const s = ms / 1000;
  return s < 60
    ? `${s.toFixed(1)} s`
    : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}
