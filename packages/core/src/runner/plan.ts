import { basename } from "node:path";
import { fail, ok, type FlowProblem, type Result } from "../errors/index.js";
import type { Flow } from "../project/flow.js";
import {
  discoverFlows,
  scriptsUsed,
  variablesNeeded,
} from "../project/flows.js";

export interface PlanInput {
  projectFolder: string;
  /** File names of the chosen flows (RUN-2). All flows when left out. */
  chosen?: readonly string[];
  /** The value of a variable, from the project's secrets (RUN-10, CLI-3). */
  secret: (name: string) => Promise<string | undefined>;
  /**
   * Maestro's own check of the given flow files, returning the refused ones (D-98). The app
   * passes it; the CLI does not, so a run in CI does not wait for it.
   */
  syntax?: (files: string[]) => Promise<Map<string, FlowProblem>>;
  /**
   * The chosen flows were written by an agent (the AGT-21 review run). A flow that runs
   * JavaScript on the computer, itself or through a helper, is held back (D-04, D-117).
   */
  agentFlows?: boolean;
}

export interface RunPlan {
  /** Chosen flows that can run, sorted by file name (RUN-1). */
  flows: Flow[];
  /** Chosen flows with problems, left out of the run (FLOW-6). */
  skipped: Flow[];
  /** The variables each flow needs, by flow file. */
  needs: Record<string, string[]>;
  values: Record<string, string>;
}

/**
 * The flow and secret checks of step 1 of a run (spec section 7). Variables that Maestro sets
 * itself (`MAESTRO_*`) need no value.
 */
export async function planRun(input: PlanInput): Promise<Result<RunPlan>> {
  const list = await discoverFlows(input.projectFolder);
  const chosen = input.chosen
    ? list.flows.filter((f) => input.chosen?.includes(basename(f.file)))
    : list.flows;
  if (input.agentFlows) {
    for (const flow of chosen) {
      const script = scriptsUsed(flow, list)[0];
      if (script) {
        flow.problems.push({
          code: "FLOW_AGENT_SCRIPT",
          file: script.file,
          line: script.line,
          command: script.command,
        });
      }
    }
  }
  const refused =
    (await input.syntax?.(
      chosen.filter((f) => f.problems.length === 0).map((f) => f.file),
    )) ?? new Map<string, FlowProblem>();
  for (const flow of chosen) {
    const problem = refused.get(flow.file);
    if (problem) flow.problems.push(problem);
  }
  const flows = chosen.filter((f) => f.problems.length === 0);
  const skipped = chosen.filter((f) => f.problems.length > 0);
  if (flows.length === 0) {
    // The review run has one flow: say why it cannot run rather than that nothing can.
    const reason = input.agentFlows ? skipped[0]?.problems[0] : undefined;
    return fail(reason ?? { code: "NO_FLOWS" });
  }

  const needs: Record<string, string[]> = {};
  const values: Record<string, string> = {};
  const missing = new Set<string>();
  for (const flow of flows) {
    needs[flow.file] = variablesNeeded(flow, list).filter(
      (n) => !n.startsWith("MAESTRO_"),
    );
    for (const name of needs[flow.file] ?? []) {
      if (name in values || missing.has(name)) continue;
      const value = await input.secret(name);
      if (value === undefined) missing.add(name);
      else values[name] = value;
    }
  }
  if (missing.size > 0)
    return fail({ code: "SECRETS_MISSING", names: [...missing].sort() });
  return ok({ flows, skipped, needs, values });
}
