import { describe, expect, it } from "vitest";
import { sampleRunProblems, type SampleRun } from "./check-sample-run.ts";

const flow = (name: string, status: string, reason?: string) => ({
  file: `/w/sample-app/.jagra/flows/${name}`,
  status,
  ...(reason ? { failure: "step", reason } : {}),
});

const good: SampleRun = {
  status: "completed",
  flows: [
    flow("item-detail.yaml", "passed"),
    flow("save-item.yaml", "failed", "Save"),
  ],
};

describe("sampleRunProblems", () => {
  it("accepts the planted bug as the only failure", () => {
    expect(sampleRunProblems(good, 1)).toEqual([]);
  });

  it("refuses a run where other flows failed too, even with exit code 1", () => {
    const run = {
      ...good,
      flows: [flow("item-detail.yaml", "failed", "Username"), good.flows[1]],
    };
    expect(sampleRunProblems(run, 1)).toEqual([
      "item-detail.yaml failed, expected passed (step: Username)",
    ]);
  });

  it("refuses the wrong exit code, a run that did not complete, and a missing flow", () => {
    const run = {
      status: "stopped",
      flows: [flow("item-detail.yaml", "passed")],
    };
    expect(sampleRunProblems(run, 2)).toEqual([
      "jagra run exited with 2, not 1",
      "the run ended stopped, not completed",
      "save-item.yaml did not run",
    ]);
  });
});
