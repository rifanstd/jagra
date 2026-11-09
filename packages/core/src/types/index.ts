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

export interface ApkInfo {
  packageName: string;
  versionName: string;
  versionCode: number;
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
