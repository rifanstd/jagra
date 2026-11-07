// Shapes shared by every package (docs/architecture.md section 3).

export type ToolName = "java" | "adb" | "maestro" | "emulator" | "mockoon";

export type ToolState = "ready" | "untested-version" | "too-old" | "missing";

export interface ToolStatus {
  tool: ToolName;
  state: ToolState;
  version?: string;
  path?: string;
}

export type DeviceKind = "emulator" | "phone";

export type DeviceState =
  "emulator-running" | "emulator-off" | "phone-ready" | "phone-not-authorised";

export interface Device {
  id: string;
  kind: DeviceKind;
  state: DeviceState;
  name: string;
  androidVersion?: string;
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
