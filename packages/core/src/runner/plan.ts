import { basename } from "node:path";
import { fail, ok, type Result } from "../errors/index.js";
import type { Flow } from "../project/flow.js";
import { discoverFlows, variablesNeeded } from "../project/flows.js";

export interface PlanInput {
  projectFolder: string;
  /** File names of the chosen flows (RUN-2). All flows when left out. */
  chosen?: readonly string[];
  /** The value of a variable, from the project's secrets (RUN-10, CLI-3). */
  secret: (name: string) => Promise<string | undefined>;
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
  const flows = chosen.filter((f) => f.problems.length === 0);
  const skipped = chosen.filter((f) => f.problems.length > 0);
  if (flows.length === 0) return fail({ code: "NO_FLOWS" });

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
