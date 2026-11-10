import type {
  ErrorCode,
  FailureKind,
  FlowStatus,
  JagraError,
  ReportText,
  RunStatus,
} from "@jagra/core";

// The CLI's words. core returns codes; this file turns them into English (D-20).

type Describe = {
  [K in ErrorCode]: (error: Extract<JagraError, { code: K }>) => string;
};

/** What happened and what to do about it (REL-5). */
const ERRORS: Describe = {
  PROGRAM_NOT_FOUND: (e) =>
    `${e.program} was not found. Install it, or check that it is on PATH.`,
  PROGRAM_IS_SCRIPT: (e) =>
    `${e.program} at ${e.path} is a script, which Jagra does not start. Install the program itself.`,
  PROGRAM_START_FAILED: (e) => `${e.program} could not start: ${e.detail}`,
  FILE_NOT_FOUND: (e) => `${e.file} does not exist.`,
  CONFIG_YAML_INVALID: (e) =>
    `${e.file}:${e.line}:${e.column} is not valid YAML: ${e.detail}`,
  CONFIG_NOT_A_MAP: (e) =>
    `${e.file} must be a list of fields, such as "format: 1".`,
  CONFIG_FORMAT_MISSING: (e) =>
    `${e.file} has no "format" field. Add "format: 1".`,
  CONFIG_FORMAT_UNSUPPORTED: (e) =>
    `${e.file} uses format ${e.found}, and this Jagra reads format ${e.supported}. Update Jagra.`,
  CONFIG_FIELD_INVALID: (e) =>
    `${e.file}:${e.line}:${e.column} "${e.field}": ${e.detail}`,
  CONFIG_WRITE_FAILED: (e) => `${e.file} could not be written: ${e.detail}`,
  CANCELLED: () => "Cancelled.",
  SECRETS_MISSING: (e) =>
    `These variables have no value: ${e.names.join(", ")}. Set ${e.names
      .map((n) => `JAGRA_SECRET_${n}`)
      .join(", ")} in the environment.`,
  NO_FLOWS: () => "There is no flow to run. Add flows to .jagra/flows.",
  RUN_SAVE_FAILED: (e) =>
    `The run could not be saved in ${e.folder}: ${e.detail}`,
  APK_NOT_FOUND: (e) =>
    `No APK was found in ${e.searchPath}. Build the app, or give one with --apk <path>.`,
  APK_UNREADABLE: (e) => `${e.file} could not be read as an APK: ${e.detail}`,
  OUTPUT_MASK_FAILED: (e) =>
    `Maestro's output in ${e.folder} could not be masked, so it was not kept: ${e.detail}`,
  DEVICE_NOT_FOUND: (e) => `Device ${e.deviceId} is not connected.`,
  DEVICE_NOT_AUTHORISED: (e) =>
    `Phone ${e.deviceId} has not allowed USB debugging. Unlock it and accept the prompt.`,
  DEVICE_NOT_RESPONDING: (e) =>
    `Phone ${e.deviceId} does not respond. Unplug it and plug it in again.`,
  EMULATOR_NOT_READY: (e) =>
    `Emulator ${e.name} was not ready after ${e.minutes} minutes.`,
  ADB_FAILED: (e) => `adb ${e.command} failed: ${e.detail}`,
  ADB_TIMED_OUT: (e) => `adb ${e.command} did not answer in time.`,
  INSTALL_FAILED: (e) => `The APK could not be installed: ${e.detail}`,
  PACKAGE_NAME_INVALID: (e) =>
    `"${e.packageName}" is not a package name. Check appId.`,
  INSTALL_SIGNATURE_MISMATCH: (e) =>
    `${e.packageName} on the device was signed with another key. The CLI never uninstalls an app; uninstall it by hand and run again.`,
  FILE_READ_FAILED: (e) => `${e.file} could not be read: ${e.detail}`,
  FLOW_YAML_INVALID: (e) =>
    `${e.file}:${e.line}:${e.column} is not valid YAML: ${e.detail}`,
  FLOW_HEADER_MISSING: (e) =>
    `${e.file} has no header. Start it with "appId:" and "---".`,
  FLOW_TOO_MANY_DOCUMENTS: (e) =>
    `${e.file}:${e.line} has more than one "---".`,
  FLOW_HEADER_NOT_A_MAP: (e) =>
    `${e.file}:${e.line} the header must be a list of fields.`,
  FLOW_APP_ID_MISSING: (e) => `${e.file}:${e.line} the header has no appId.`,
  FLOW_PROPERTIES_INVALID: (e) =>
    `${e.file}:${e.line} "properties" must be a list of fields.`,
  FLOW_STEPS_MISSING: (e) => `${e.file}:${e.line} has no steps.`,
  FLOW_STEP_INVALID: (e) => `${e.file}:${e.line} is not a Maestro step.`,
  FLOW_AI_COMMAND: (e) =>
    `${e.file}:${e.line} uses ${e.command}, which lets an AI decide the result. Jagra does not run it.`,
  FLOW_HELPER_NOT_FOUND: (e) =>
    `${e.file}:${e.line} calls ${e.helper}, which does not exist.`,
};

export function describeError(error: JagraError): string {
  const describe = ERRORS[error.code] as (e: JagraError) => string;
  return describe(error);
}

export const RUN_STATUS: Record<RunStatus, string> = {
  running: "Running",
  completed: "Completed",
  cancelled: "Cancelled",
  stopped: "Stopped",
  interrupted: "Interrupted",
};

export const FLOW_STATUS: Record<FlowStatus, string> = {
  waiting: "Waiting",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  cancelled: "Cancelled",
  "not-run": "Not run",
};

export const FAILURE: Record<FailureKind, string> = {
  step: "Step failed",
  "timed-out": "Timed out",
  "app-crashed": "App crashed",
  "app-not-responding": "App not responding",
  "device-disconnected": "Device disconnected",
  error: "Error",
};

export const REPORT_TEXT: ReportText = {
  title: "Jagra run",
  flow: "Flow",
  status: "Status",
  duration: "Duration",
  reason: "Reason",
  apk: "APK",
  device: "Device",
  started: "Started",
  openReport: "Maestro report",
  runStatus: RUN_STATUS,
  flowStatus: FLOW_STATUS,
  failure: FAILURE,
};

export const USAGE = `Usage: jagra run [project-folder] [options]

Runs every flow in .jagra/flows of the project folder, or of the current folder.

Options:
  --device <id>      the device to run on: an adb serial or an emulator name.
                     Default: the only ready device.
  --apk <path>       the APK to install. Default: the newest APK under apk.searchPath.
  --output <folder>  where to save the results and the HTML report.
                     Default: Jagra's local data folder.
  --help             show this help.
  --version          show Jagra's version.

Variables in flows, such as \${PASSWORD}, take their values from environment
variables named JAGRA_SECRET_<NAME>, such as JAGRA_SECRET_PASSWORD.

Exit codes: 0 every flow passed, 1 a flow failed, 2 the run could not start or stopped.`;
