import type { OutputLine } from "../../ports/process-runner.js";
import type { ToolName } from "../../types/index.js";

/** The argument each tool takes to print its version. Output formats are in to-verify.md. */
export const VERSION_ARGS: Readonly<Record<ToolName, readonly string[]>> = {
  java: ["-version"],
  adb: ["version"],
  emulator: ["-version"],
  maestro: ["--version"],
  mockoon: ["--version"],
};

const PATTERNS: Readonly<Record<ToolName, RegExp>> = {
  // java version "17.0.12" 2024-07-16 LTS, or openjdk version "21.0.2" 2024-01-16
  java: /version "([^"]+)"/,
  // Version 37.0.0-14910828 (the line after "Android Debug Bridge version 1.0.41")
  adb: /^Version (\d+(?:\.\d+)+)/,
  // Android emulator version 36.5.11.0 (build_id 15261927) (CL:N/A)
  emulator: /^Android emulator version (\d+(?:\.\d+)+)/,
  // 2.12.1
  maestro: /^(\d+\.\d+\.\d+)$/,
  // @mockoon/cli/9.10.0 win32-x64 node-v24.22.1
  mockoon: /^@mockoon\/cli\/(\d+(?:\.\d+)+)/,
};

export function readVersion(
  tool: ToolName,
  lines: readonly OutputLine[],
): string | undefined {
  for (const line of lines) {
    const match = PATTERNS[tool].exec(line.text.trim());
    if (match?.[1]) return match[1];
  }
  return undefined;
}
