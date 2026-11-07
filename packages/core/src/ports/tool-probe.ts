import type { ToolName, ToolStatus } from "../types/index.js";

/** Finds a tool and reads its version. Exact commands per tool are confirmed in M2 (to-verify.md). */
export interface ToolProbe {
  probe(tool: ToolName, signal?: AbortSignal): Promise<ToolStatus>;
}
