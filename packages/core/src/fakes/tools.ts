import type { ToolProbe } from "../ports/tool-probe.js";
import type { ToolName, ToolStatus } from "../types/index.js";

/** Every tool is missing until a test says otherwise. */
export class FakeToolProbe implements ToolProbe {
  private readonly statuses = new Map<ToolName, ToolStatus>();

  set(status: ToolStatus): void {
    this.statuses.set(status.tool, status);
  }

  probe(tool: ToolName): Promise<ToolStatus> {
    return Promise.resolve(
      this.statuses.get(tool) ?? { tool, state: "missing" },
    );
  }
}
