import { describe, expect, it } from "vitest";
import { failureLikely } from "./failure-note.js";

const steps = [
  { kind: "action" as const },
  {
    kind: "action" as const,
    steps: [{ kind: "action" as const }, { kind: "check" as const }],
  },
  { kind: "action" as const },
  { kind: "check" as const },
];

describe("failureLikely (AGT-24)", () => {
  it("points at the flow when an action failed", () => {
    expect(failureLikely(steps, [2])).toBe("flow");
    expect(failureLikely(steps, [1, 0])).toBe("flow");
  });

  it("points at the app when a check failed after the actions passed", () => {
    expect(failureLikely(steps, [3])).toBe("app");
    expect(failureLikely(steps, [1, 1])).toBe("app");
  });

  it("says nothing without a failing step", () => {
    expect(failureLikely(steps, undefined)).toBeUndefined();
    expect(failureLikely(steps, [])).toBeUndefined();
    expect(failureLikely([], [0])).toBeUndefined();
  });

  it("uses the deepest step it can find when the path goes further than the steps", () => {
    expect(failureLikely(steps, [2, 5])).toBe("flow");
  });
});
