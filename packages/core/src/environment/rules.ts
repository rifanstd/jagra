import type { ToolFinding } from "../ports/tool-probe.js";
import type { ToolName, ToolStatus } from "../types/index.js";

export interface ToolRule {
  tool: ToolName;
  required: boolean;
  minimum?: string;
  /** Newer versions still run, shown as Untested version (ENV-3). */
  newestTested?: string;
}

// Maestro and Mockoon CLI use the only version tested so far. Review in M5 and M6 (to-verify.md).
export const TOOL_RULES: Readonly<Record<ToolName, ToolRule>> = {
  java: { tool: "java", required: true, minimum: "17" },
  adb: { tool: "adb", required: true },
  maestro: {
    tool: "maestro",
    required: true,
    minimum: "2.12.1",
    newestTested: "2.12.1",
  },
  emulator: { tool: "emulator", required: false },
  mockoon: {
    tool: "mockoon",
    required: false,
    minimum: "9.10.0",
    newestTested: "9.10.0",
  },
};

export const ALL_TOOLS: readonly ToolName[] = [
  "java",
  "adb",
  "maestro",
  "emulator",
  "mockoon",
];

export function toolStatus(rule: ToolRule, finding: ToolFinding): ToolStatus {
  const base = { tool: rule.tool, required: rule.required };
  if (!finding.found) return { ...base, state: "missing" };
  if ("problem" in finding) {
    return {
      ...base,
      state: "cant-start",
      path: finding.path,
      problem: finding.problem,
    };
  }
  const found = { ...base, path: finding.path, version: finding.version };
  const version = comparable(rule.tool, finding.version);
  if (rule.minimum && compareVersions(version, rule.minimum) < 0) {
    return { ...found, state: "too-old" };
  }
  if (rule.newestTested && compareVersions(version, rule.newestTested) > 0) {
    return { ...found, state: "untested-version" };
  }
  return { ...found, state: "ready" };
}

/** Compares dotted numbers. Missing parts count as 0, so "17" equals "17.0.0". */
export function compareVersions(a: string, b: string): number {
  const left = numbers(a);
  const right = numbers(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

function numbers(version: string): number[] {
  return (version.match(/\d+/g) ?? []).map(Number);
}

// Java 8 and older report themselves as "1.8.0_392".
function comparable(tool: ToolName, version: string): string {
  return tool === "java" ? version.replace(/^1\.(?=\d)/, "") : version;
}
