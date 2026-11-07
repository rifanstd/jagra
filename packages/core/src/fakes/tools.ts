import type {
  ProbeRequest,
  ToolFinding,
  ToolProbe,
} from "../ports/tool-probe.js";
import type { ToolName } from "../types/index.js";

/** Every tool is missing until a test says otherwise. */
export class FakeToolProbe implements ToolProbe {
  readonly requests: { tool: ToolName; request: ProbeRequest }[] = [];
  private readonly findings = new Map<ToolName, ToolFinding>();

  set(tool: ToolName, finding: ToolFinding): void {
    this.findings.set(tool, finding);
  }

  probe(tool: ToolName, request: ProbeRequest): Promise<ToolFinding> {
    this.requests.push({ tool, request });
    return Promise.resolve(this.findings.get(tool) ?? { found: false });
  }
}
