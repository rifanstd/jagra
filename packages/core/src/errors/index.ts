// core reports failures as codes with parameters, never sentences (D-20). The renderer and the CLI
// turn them into text. A `detail` parameter holds technical output for "Show details" (REL-5).

export type JagraError =
  | { code: "PROGRAM_NOT_FOUND"; program: string }
  | { code: "PROGRAM_IS_SCRIPT"; program: string; path: string }
  | { code: "PROGRAM_START_FAILED"; program: string; detail: string }
  | { code: "FILE_NOT_FOUND"; file: string }
  | {
      code: "CONFIG_YAML_INVALID";
      file: string;
      line: number;
      column: number;
      detail: string;
    }
  | { code: "CONFIG_NOT_A_MAP"; file: string }
  | { code: "CONFIG_FORMAT_MISSING"; file: string }
  | {
      code: "CONFIG_FORMAT_UNSUPPORTED";
      file: string;
      found: number;
      supported: number;
    }
  | {
      code: "CONFIG_FIELD_INVALID";
      file: string;
      field: string;
      line: number;
      column: number;
      detail: string;
    }
  | { code: "CANCELLED" }
  /** Variables the chosen flows use that have no value (RUN-10, CLI-3). */
  | { code: "SECRETS_MISSING"; names: string[] }
  | { code: "NO_FLOWS" }
  | { code: "RUN_SAVE_FAILED"; folder: string; detail: string }
  | { code: "APK_NOT_FOUND"; searchPath: string }
  | { code: "APK_UNREADABLE"; file: string; detail: string }
  | { code: "CONFIG_WRITE_FAILED"; file: string; detail: string }
  /** Maestro's output could not be masked, so it must not be kept (RES-7). */
  | { code: "OUTPUT_MASK_FAILED"; folder: string; detail: string }
  | DeviceError
  | FlowProblem;

/** What can go wrong with a device or `adb` (spec section 5, RUN-3). */
export type DeviceError =
  | { code: "DEVICE_NOT_FOUND"; deviceId: string }
  | { code: "DEVICE_NOT_AUTHORISED"; deviceId: string }
  | { code: "DEVICE_NOT_RESPONDING"; deviceId: string }
  /** The emulator did not finish booting in time (DEV-4). */
  | { code: "EMULATOR_NOT_READY"; name: string; minutes: number }
  | { code: "ADB_FAILED"; command: string; detail: string }
  | { code: "ADB_TIMED_OUT"; command: string }
  | { code: "INSTALL_FAILED"; detail: string }
  /** Package names reach a shell on the device, so anything else is refused. */
  | { code: "PACKAGE_NAME_INVALID"; packageName: string }
  /** The user chose not to uninstall an app signed with another key (RUN-3). */
  | { code: "INSTALL_SIGNATURE_MISMATCH"; packageName: string };

/** Why a flow cannot run. A flow with a problem is shown with it and left out of runs (FLOW-6). */
export type FlowProblem =
  | { code: "FILE_READ_FAILED"; file: string; detail: string }
  | {
      code: "FLOW_YAML_INVALID";
      file: string;
      line: number;
      column: number;
      detail: string;
    }
  | { code: "FLOW_HEADER_MISSING"; file: string }
  | { code: "FLOW_TOO_MANY_DOCUMENTS"; file: string; line: number }
  | { code: "FLOW_HEADER_NOT_A_MAP"; file: string; line: number }
  | { code: "FLOW_APP_ID_MISSING"; file: string; line: number }
  | { code: "FLOW_PROPERTIES_INVALID"; file: string; line: number }
  | { code: "FLOW_STEPS_MISSING"; file: string; line: number }
  | { code: "FLOW_STEP_INVALID"; file: string; line: number }
  /** A command that lets an AI model decide or feed a result (FLOW-10, D-33). */
  | { code: "FLOW_AI_COMMAND"; file: string; line: number; command: string }
  | {
      code: "FLOW_HELPER_NOT_FOUND";
      file: string;
      line: number;
      helper: string;
    };

export type ErrorCode = JagraError["code"];

export type Result<T, E = JagraError> =
  { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({
  ok: true,
  value,
});

export const fail = <E>(error: E): { ok: false; error: E } => ({
  ok: false,
  error,
});
