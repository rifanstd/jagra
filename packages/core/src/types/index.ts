import type { JagraError } from "../errors/index.js";
import type { StepMark } from "../ports/flow-runner.js";

// Shapes shared by every package (docs/architecture.md section 3).

export type ToolName = "java" | "adb" | "maestro" | "emulator" | "mockoon";

export type ToolState =
  "ready" | "untested-version" | "too-old" | "missing" | "cant-start";

/** Why a tool that was found cannot start (D-35). */
export type ToolProblem = "needs-java" | "needs-node" | "timed-out" | "failed";

export interface ToolStatus {
  tool: ToolName;
  state: ToolState;
  required: boolean;
  version?: string;
  path?: string;
  problem?: ToolProblem;
}

export type DeviceKind = "emulator" | "phone";

/**
 * Spec section 5. `emulator-starting` is an emulator `adb` already sees but that is still booting,
 * and `phone-not-responding` a phone `adb` reports as offline (D-43).
 */
export type DeviceState =
  | "emulator-running"
  | "emulator-starting"
  | "emulator-off"
  | "phone-ready"
  | "phone-not-authorised"
  | "phone-not-responding";

export interface Device {
  /** The `adb` serial, or `avd:<name>` for an emulator that is off. */
  id: string;
  kind: DeviceKind;
  state: DeviceState;
  /** The AVD name for an emulator, the model for a phone. */
  name: string;
}

export interface AndroidVersion {
  /** For example `15`. */
  release: string;
  /** The API level, for example `35`. */
  sdk: number;
}

/** Something on screen with text, an id or a description (AGT-25). */
export interface ScreenElement {
  text?: string;
  id?: string;
  description?: string;
}

export interface ApkInfo {
  packageName: string;
  versionName: string;
  versionCode: number;
}

/** RUN-12, plus `running` while the run is in progress. */
export type RunStatus =
  "running" | "completed" | "cancelled" | "stopped" | "interrupted";

/**
 * A flow's state in a run (RUN-8). `not-run` is a flow the run never reached because the device
 * was lost, a required step failed or Jagra closed (RUN-12).
 */
export type FlowStatus =
  "waiting" | "running" | "passed" | "failed" | "cancelled" | "not-run";

/** Why a flow failed. `step` is a failed Maestro step, with Maestro's reason beside it. */
export type FailureKind =
  | "step"
  | "timed-out"
  | "app-crashed"
  | "app-not-responding"
  | "device-disconnected"
  | "error";

export interface FlowResult {
  /** Full path of the flow file. */
  file: string;
  name: string;
  status: FlowStatus;
  failure?: FailureKind;
  durationMs?: number;
  /** Maestro's one-line reason, masked. */
  reason?: string;
  /** Technical text for "Show details", masked. */
  detail?: string;
  /** A Jagra error behind an `error` failure. */
  error?: JagraError;
  steps?: StepMark[];
  failedStep?: number[];
  /** Paths relative to the run's folder. */
  screenshot?: string;
  /** The failure screenshot is black, probably `FLAG_SECURE` (RES-5). */
  blackScreenshot?: boolean;
  screen?: ScreenElement[];
  crashReport?: string;
  report?: string;
}

export interface RunApk {
  file: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  /** When the APK was built, milliseconds since the epoch. */
  modifiedAt: number;
}

export interface RunDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  androidVersion?: string;
}

/** `run.json`, saved after every flow (REL-1). */
export interface Run {
  id: string;
  projectId: string;
  status: RunStatus;
  /** ISO times. */
  startedAt: string;
  endedAt?: string;
  apk: RunApk;
  device: RunDevice;
  flows: FlowResult[];
  /** Why a `stopped` run stopped. */
  stopReason?: JagraError;
  /** The Jagra process running it, to tell a crash from a run in progress (REL-2). */
  pid: number;
}

export type StepKind = "action" | "check";

/**
 * One Maestro command. core never writes the sentence shown to people (D-20, D-32):
 * the renderer and the CLI build it from `command` and `args`.
 */
export interface Step {
  kind: StepKind;
  command: string;
  /** The command's value as written in the flow, for example `"Sign In"` for `tapOn`. */
  args: unknown;
  /** 1-based line in the flow file. */
  line: number;
  /** Commands nested under `runFlow`, `repeat` or `retry`. */
  steps?: Step[];
}
