import type { ErrorCode, JagraError } from "@jagra/core/types";
import type { TFunction } from "i18next";

/**
 * Every error code core can return. TypeScript fails to compile when a code is added to core but
 * not here, and `errors.test.ts` fails when a code has no text in a language (D-20, LNG-1).
 */
export const ERROR_CODES = {
  PROGRAM_NOT_FOUND: true,
  PROGRAM_IS_SCRIPT: true,
  PROGRAM_START_FAILED: true,
  FILE_NOT_FOUND: true,
  FILE_READ_FAILED: true,
  CONFIG_YAML_INVALID: true,
  CONFIG_NOT_A_MAP: true,
  CONFIG_FORMAT_MISSING: true,
  CONFIG_FORMAT_UNSUPPORTED: true,
  CONFIG_FIELD_INVALID: true,
  CONFIG_WRITE_FAILED: true,
  CANCELLED: true,
  SECRETS_MISSING: true,
  NO_FLOWS: true,
  RUN_SAVE_FAILED: true,
  APK_NOT_FOUND: true,
  APK_UNREADABLE: true,
  OUTPUT_MASK_FAILED: true,
  DEVICE_NOT_FOUND: true,
  DEVICE_NOT_AUTHORISED: true,
  DEVICE_NOT_RESPONDING: true,
  EMULATOR_NOT_READY: true,
  ADB_FAILED: true,
  ADB_TIMED_OUT: true,
  INSTALL_FAILED: true,
  PACKAGE_NAME_INVALID: true,
  INSTALL_SIGNATURE_MISMATCH: true,
  MOCKOON_FILE_INVALID: true,
  MOCKOON_PORT_MISSING: true,
  MOCKOON_PORT_BUSY: true,
  MOCKOON_NOT_READY: true,
  MOCKOON_EXITED: true,
  FLOW_YAML_INVALID: true,
  FLOW_HEADER_MISSING: true,
  FLOW_TOO_MANY_DOCUMENTS: true,
  FLOW_HEADER_NOT_A_MAP: true,
  FLOW_APP_ID_MISSING: true,
  FLOW_PROPERTIES_INVALID: true,
  FLOW_STEPS_MISSING: true,
  FLOW_STEP_INVALID: true,
  FLOW_AI_COMMAND: true,
  FLOW_HELPER_NOT_FOUND: true,
} as const satisfies Record<ErrorCode, true>;

/**
 * The sentence for an error, in the current language. Technical output (`detail`) is not part of
 * it: it goes under "Show details" (REL-5).
 */
export function describeError(error: JagraError, t: TFunction): string {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(error)) {
    if (key === "code" || key === "detail") continue;
    if (Array.isArray(value)) values[key] = value.join(", ");
    else if (typeof value === "string" || typeof value === "number")
      values[key] = value;
  }
  return t(`errors.${error.code}`, values);
}
