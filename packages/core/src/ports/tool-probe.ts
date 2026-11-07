import type { ToolName, ToolProblem } from "../types/index.js";

/** Paths the user set by hand in Settings > Tool locations. They win over detection (ENV-6). */
export type ToolPaths = Partial<Record<ToolName, string>>;

export interface ProbeRequest {
  paths: ToolPaths;
  signal?: AbortSignal;
}

/** What the probe saw. The environment module turns it into a state with the version rules. */
export type ToolFinding =
  | { found: false }
  | { found: true; path: string; version: string }
  | { found: true; path: string; problem: ToolProblem; detail?: string };

/** Finds a tool and reads its version. */
export interface ToolProbe {
  probe(tool: ToolName, request: ProbeRequest): Promise<ToolFinding>;
}
