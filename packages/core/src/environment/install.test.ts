import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "./rules.js";
import { installGuide } from "./install.js";

describe("installGuide (ENV-4)", () => {
  it("has an official https page and at least one step for every tool on both systems", () => {
    for (const platform of ["win32", "darwin"] as const) {
      for (const tool of ALL_TOOLS) {
        const guide = installGuide(tool, platform);
        expect(guide.tool).toBe(tool);
        expect(guide.url).toMatch(/^https:\/\//);
        expect(guide.steps.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives Maestro its own Windows steps, without the install script", () => {
    const windows = installGuide("maestro", "win32");
    expect(windows.steps.map((s) => s.id)).toContain(
      "maestro.windows.download-zip",
    );
    expect(JSON.stringify(windows)).not.toContain("curl");
    expect(JSON.stringify(installGuide("maestro", "darwin"))).toContain(
      "get.maestro.mobile.dev",
    );
  });

  it("uses step ids that are unique within a guide", () => {
    for (const tool of ALL_TOOLS) {
      const ids = installGuide(tool, "win32").steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
