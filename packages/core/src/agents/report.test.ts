import { describe, expect, it } from "vitest";
import { readReport } from "./report.js";

describe("readReport (AGT-16)", () => {
  it("reads the report at the end of the message, in a code block or not", () => {
    const report = {
      flow: ".jagra/flows/login-wrong-password.yaml",
      checks: "A wrong password shows an error.",
      possibleBug: null,
      suggestedTests: ["Log in with an empty password"],
    };
    expect(
      readReport(
        `I wrote the flow.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\nDone.`,
      ),
    ).toEqual({
      flow: ".jagra/flows/login-wrong-password.yaml",
      checks: "A wrong password shows an error.",
      suggestedTests: ["Log in with an empty password"],
    });
  });

  it("keeps a possible bug, and braces inside strings", () => {
    expect(
      readReport(
        'Note {not json}. {"flow": "a.yaml", "checks": "Uses ${PASSWORD} and {x}", "possibleBug": "Save never enables", "suggestedTests": []}',
      ),
    ).toEqual({
      flow: "a.yaml",
      checks: "Uses ${PASSWORD} and {x}",
      possibleBug: "Save never enables",
      suggestedTests: [],
    });
  });

  it("takes the last report when there are several", () => {
    expect(
      readReport(
        '{"flow": "old.yaml", "checks": "x", "suggestedTests": []} then {"flow": "new.yaml", "checks": "y", "suggestedTests": []}',
      )?.flow,
    ).toBe("new.yaml");
  });

  it("gives nothing for a message without a report, or a different shape", () => {
    expect(readReport("All done, the flow is ready.")).toBeUndefined();
    expect(readReport('{"result": "ok"}')).toBeUndefined();
    expect(readReport('{"flow": "a.yaml", "checks": ')).toBeUndefined();
  });

  it("tolerates suggested tests that are not a list", () => {
    expect(
      readReport('{"flow": "a.yaml", "checks": "x", "suggestedTests": "none"}'),
    ).toEqual({ flow: "a.yaml", checks: "x", suggestedTests: [] });
  });
});
