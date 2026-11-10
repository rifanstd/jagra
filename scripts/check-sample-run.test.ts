import { describe, expect, it } from "vitest";
import {
  mockoonLogProblems,
  sampleRunProblems,
  type SampleRun,
} from "./check-sample-run.ts";

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

  it("refuses the planted bug's flow failing before it reaches Save", () => {
    const run = {
      ...good,
      flows: [
        good.flows[0],
        flow(
          "save-item.yaml",
          "failed",
          "Element not found: Text matching regex: Sign in",
        ),
      ],
    };
    expect(sampleRunProblems(run, 1)).toEqual([
      "save-item.yaml failed for another reason: Element not found: Text matching regex: Sign in",
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

describe("mockoonLogProblems", () => {
  it("accepts a log where the app called the mock", () => {
    const log =
      '{"message":"Server started on port 3000"}\n{"message":"Transaction recorded"}\n';
    expect(mockoonLogProblems(log)).toEqual([]);
  });

  it("refuses a missing log, a mock that never started and a mock nobody called", () => {
    expect(mockoonLogProblems(undefined)).toEqual([
      "the run folder has no mockoon.log",
    ]);
    expect(mockoonLogProblems("")).toEqual(["Mockoon did not start"]);
    expect(
      mockoonLogProblems('{"message":"Server started on port 3000"}'),
    ).toEqual(["the app never called Mockoon"]);
  });
});
