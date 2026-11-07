import { describe, expect, it } from "vitest";
import { FakeToolProbe } from "../fakes/tools.js";
import type { ToolFinding, ToolProbe } from "../ports/tool-probe.js";
import type { ToolName, ToolStatus } from "../types/index.js";
import { checkEnvironment } from "./check.js";

const at = (version: string) => ({
  found: true as const,
  path: "/bin/x",
  version,
});

describe("checkEnvironment", () => {
  it("reports Ready, Untested version, Too old and Missing from the probe", async () => {
    const probe = new FakeToolProbe();
    probe.set("java", at("17.0.12"));
    probe.set("adb", at("37.0.0"));
    probe.set("maestro", at("2.13.0"));
    probe.set("mockoon", at("8.0.0"));

    const statuses = await checkEnvironment(probe);

    expect(statuses.map((s) => [s.tool, s.state])).toEqual([
      ["java", "ready"],
      ["adb", "ready"],
      ["maestro", "untested-version"],
      ["emulator", "missing"],
      ["mockoon", "too-old"],
    ]);
  });

  it("checks only the tools asked for, with the hand-set paths", async () => {
    const probe = new FakeToolProbe();
    const paths = { maestro: "D:\\tools\\maestro\\bin\\maestro.bat" };

    const statuses = await checkEnvironment(probe, {
      tools: ["java", "adb", "maestro"],
      paths,
    });

    expect(statuses.map((s) => s.tool)).toEqual(["java", "adb", "maestro"]);
    expect(probe.requests.map((r) => r.tool)).toEqual([
      "java",
      "adb",
      "maestro",
    ]);
    expect(probe.requests[2]?.request.paths).toBe(paths);
  });

  it("starts every probe before any of them finishes (ENV-1)", async () => {
    const started: ToolName[] = [];
    const finish: (() => void)[] = [];
    const probe: ToolProbe = {
      probe(tool: ToolName) {
        started.push(tool);
        return new Promise<ToolFinding>((resolve) =>
          finish.push(() => resolve({ found: false })),
        );
      },
    };

    const check = checkEnvironment(probe);
    expect(started).toHaveLength(5);
    finish.forEach((f) => f());
    await check;
  });

  it("reports each tool as soon as it is known", async () => {
    const seen: ToolStatus[] = [];
    await checkEnvironment(new FakeToolProbe(), {
      onProgress: (s) => seen.push(s),
    });
    expect(seen).toHaveLength(5);
  });

  it("blames Java when Maestro cannot start and Java is missing or too old", async () => {
    const probe = new FakeToolProbe();
    probe.set("java", at("11.0.2"));
    probe.set("maestro", { found: true, path: "/m", problem: "failed" });

    const [, maestro] = await checkEnvironment(probe, {
      tools: ["java", "maestro"],
    });

    expect(maestro?.problem).toBe("needs-java");
  });

  it("keeps Maestro's own failure when Java is fine", async () => {
    const probe = new FakeToolProbe();
    probe.set("java", at("17.0.12"));
    probe.set("maestro", { found: true, path: "/m", problem: "failed" });

    const [, maestro] = await checkEnvironment(probe, {
      tools: ["java", "maestro"],
    });

    expect(maestro?.problem).toBe("failed");
  });
});
