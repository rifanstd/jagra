import type { StepKind } from "../types/index.js";

/** Which way a failure most likely points (AGT-24). Never certain, and never decided by AI. */
export type FailureLikely = "flow" | "app";

interface MarkedStep {
  kind: StepKind;
  steps?: MarkedStep[];
}

/**
 * AGT-24. Steps run in order, so everything before the failing step passed. A failed action,
 * such as a tap on a button name the app does not have, most likely means the flow is wrong. A
 * failed check after every action passed most likely means the app does not do what the
 * scenario expects. For a step inside a helper or a repeat, the innermost failing step counts.
 */
export function failureLikely(
  steps: readonly MarkedStep[],
  failedStep: readonly number[] | undefined,
): FailureLikely | undefined {
  if (!failedStep || failedStep.length === 0) return undefined;
  let level: readonly MarkedStep[] | undefined = steps;
  let step: MarkedStep | undefined;
  for (const index of failedStep) {
    const next: MarkedStep | undefined = level?.[index];
    if (!next) break;
    step = next;
    level = next.steps;
  }
  if (!step) return undefined;
  return step.kind === "check" ? "app" : "flow";
}
