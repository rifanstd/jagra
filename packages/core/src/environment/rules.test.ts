import { describe, expect, it } from "vitest";
import { compareVersions, TOOL_RULES, toolStatus } from "./rules.js";

const found = (version: string) => ({
  found: true as const,
  path: "/bin/tool",
  version,
});

describe("compareVersions", () => {
  it("compares each number, treating missing parts as 0", () => {
    expect(compareVersions("2.12.1", "2.12.1")).toBe(0);
    expect(compareVersions("2.9.0", "2.12.1")).toBe(-1);
    expect(compareVersions("2.12.10", "2.12.9")).toBe(1);
    expect(compareVersions("17", "17.0.0")).toBe(0);
    expect(compareVersions("17.0.12", "17")).toBe(1);
  });
});

describe("toolStatus (ENV-2, ENV-3)", () => {
  it("is Ready inside the tested range", () => {
    expect(toolStatus(TOOL_RULES.maestro, found("2.12.1"))).toEqual({
      tool: "maestro",
      required: true,
      state: "ready",
      path: "/bin/tool",
      version: "2.12.1",
    });
  });

  it("is Untested version above the newest tested", () => {
    expect(toolStatus(TOOL_RULES.mockoon, found("9.11.0")).state).toBe(
      "untested-version",
    );
  });

  it("is Too old below the minimum", () => {
    expect(toolStatus(TOOL_RULES.maestro, found("1.39.0")).state).toBe(
      "too-old",
    );
    expect(toolStatus(TOOL_RULES.java, found("11.0.2")).state).toBe("too-old");
  });

  it("reads Java 8's 1.8 numbering as 8", () => {
    expect(toolStatus(TOOL_RULES.java, found("1.8.0_392")).state).toBe(
      "too-old",
    );
  });

  it("has no newest tested Java, so any newer Java is Ready", () => {
    expect(toolStatus(TOOL_RULES.java, found("25.0.1")).state).toBe("ready");
  });

  it("is Ready for tools without version rules", () => {
    expect(toolStatus(TOOL_RULES.adb, found("37.0.0")).state).toBe("ready");
  });

  it("is Missing when not found, and says whether the tool is required", () => {
    expect(toolStatus(TOOL_RULES.maestro, { found: false })).toEqual({
      tool: "maestro",
      required: true,
      state: "missing",
    });
    expect(toolStatus(TOOL_RULES.emulator, { found: false }).required).toBe(
      false,
    );
  });

  it("is Can't start when found but not runnable", () => {
    expect(
      toolStatus(TOOL_RULES.mockoon, {
        found: true,
        path: "C:\\npm\\mockoon-cli.cmd",
        problem: "needs-node",
      }),
    ).toEqual({
      tool: "mockoon",
      required: false,
      state: "cant-start",
      path: "C:\\npm\\mockoon-cli.cmd",
      problem: "needs-node",
    });
  });
});
