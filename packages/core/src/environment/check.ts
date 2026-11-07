import type { ToolFinding, ToolPaths, ToolProbe } from "../ports/tool-probe.js";
import type { ToolName, ToolStatus } from "../types/index.js";
import { ALL_TOOLS, TOOL_RULES, toolStatus } from "./rules.js";

export interface CheckOptions {
  /** Before a run, only the tools that run needs (ENV-7). */
  tools?: readonly ToolName[];
  paths?: ToolPaths;
  signal?: AbortSignal;
  /** Called once per tool, as soon as its state is known. */
  onProgress?: (status: ToolStatus) => void;
}

/** Checks every tool at the same time (ENV-1) and returns them in the order asked. */
export async function checkEnvironment(
  probe: ToolProbe,
  options: CheckOptions = {},
): Promise<ToolStatus[]> {
  const tools = options.tools ?? ALL_TOOLS;
  const request = { paths: options.paths ?? {}, signal: options.signal };
  const probes = tools.map((tool) => ({
    tool,
    finding: probe.probe(tool, request),
  }));
  const java = probes.find((p) => p.tool === "java")?.finding;

  return Promise.all(
    probes.map(async ({ tool, finding }) => {
      let status = toolStatus(TOOL_RULES[tool], await finding);
      if (tool === "maestro" && java) status = blameJava(status, await java);
      options.onProgress?.(status);
      return status;
    }),
  );
}

// Maestro fails to start on a missing or old Java; point the user at Java, not at Maestro.
function blameJava(maestro: ToolStatus, java: ToolFinding): ToolStatus {
  if (maestro.state !== "cant-start" || maestro.problem !== "failed") {
    return maestro;
  }
  const javaState = toolStatus(TOOL_RULES.java, java).state;
  return javaState === "ready" || javaState === "untested-version"
    ? maestro
    : { ...maestro, problem: "needs-java" };
}
