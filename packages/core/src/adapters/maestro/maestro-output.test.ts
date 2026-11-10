import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse, parseAllDocuments } from "yaml";
import {
  findAppProblem,
  readCommands,
  readHierarchy,
  stepStarted,
  wrapperFlow,
} from "./maestro-output.js";

// Real output of Maestro 2.12.1 on the sample app, 2026-11-10. Secrets in it are already masked.
const fixture = (name: string) =>
  readFile(
    fileURLToPath(
      new URL(`../../../test-fixtures/maestro/${name}`, import.meta.url),
    ),
    "utf8",
  );
const json = async (name: string): Promise<unknown> =>
  JSON.parse(await fixture(name));

describe("readCommands (D-49)", () => {
  it("marks each step and finds the planted bug's failing step", async () => {
    const read = readCommands(await json("commands-failed.json"), false);
    expect(read?.steps.map((s) => s.mark)).toEqual([
      "passed", // launchApp
      "passed", // runFlow parts/login.yaml
      "passed",
      "passed",
      "passed",
      "passed",
      "passed",
      "failed", // tapOn: Save
    ]);
    expect(read?.steps[1]?.steps).toHaveLength(6);
    expect(read?.failedStep).toEqual([7]);
    expect(read?.failure).toEqual({
      message: "Element not found: Text matching regex: Save",
      debugMessage: expect.stringContaining("Save not found") as string,
      screenshot: "screenshots/step-017-tapOnElement-Save.png",
      hierarchy: "screen-hierarchy/step-017-tapOnElement-Save.json",
    });
  });

  it("drops the wrapper's own step (D-47)", async () => {
    const read = readCommands(await json("commands-wrapped.json"), true);
    expect(read?.steps).toEqual([
      { mark: "passed" },
      {
        mark: "passed",
        steps: Array.from({ length: 6 }, () => ({ mark: "passed" })),
      },
      { mark: "passed" },
    ]);
    expect(read?.failedStep).toBeUndefined();
  });

  it("marks a step under a failed nested step as failed, and later steps as not run", () => {
    const entry = (kind: string, status: string, depth: number) => ({
      command: { [kind]: {} },
      metadata: {
        status,
        depth,
        error: status === "FAILED" ? { message: "nope" } : undefined,
      },
    });
    const read = readCommands(
      [
        entry("defineVariablesCommand", "COMPLETED", 0),
        entry("runFlowCommand", "RUNNING", 0),
        entry("tapOnElement", "COMPLETED", 1),
        entry("tapOnElement", "FAILED", 1),
        entry("assertConditionCommand", "SKIPPED", 0),
      ],
      false,
    );
    expect(read).toEqual({
      steps: [
        { mark: "failed", steps: [{ mark: "passed" }, { mark: "failed" }] },
        { mark: "not-run" },
      ],
      failedStep: [0, 1],
      failure: { message: "nope" },
    });
  });

  it("refuses something that is not Maestro's list", () => {
    expect(readCommands({ not: "a list" }, false)).toBeUndefined();
    expect(readCommands([], true)).toBeUndefined();
  });
});

describe("stepStarted (RUN-8)", () => {
  it("reads the step from Maestro's log line", () => {
    expect(
      stepStarted(
        '18:12:53.240 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: Tap on "Username" RUNNING',
      ),
    ).toBe('Tap on "Username"');
  });

  it("ignores Maestro's own commands and other lines", () => {
    expect(
      stepStarted(
        "18:12:52.395 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: Define variables RUNNING",
      ),
    ).toBeUndefined();
    expect(
      stepStarted(
        '18:12:53.236 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandFinished: Launch app "x" COMPLETED',
      ),
    ).toBeUndefined();
  });
});

describe("findAppProblem (RUN-6, D-51)", () => {
  it("finds the app's crash in logcat and keeps its report", async () => {
    const problem = findAppProblem(
      await fixture("logcat-crash.txt"),
      "dev.jagra.sample",
    );
    expect(problem?.kind).toBe("crash");
    expect(problem?.report).toContain("FATAL EXCEPTION: main");
    expect(problem?.report).toContain("shell-induced crash");
    expect(problem?.report).not.toContain("QueryController");
  });

  it("ignores another app's crash", async () => {
    expect(
      findAppProblem(await fixture("logcat-crash.txt"), "dev.jagra.other"),
    ).toBeUndefined();
  });

  it("finds an ANR", () => {
    const logcat = [
      "11-10 18:20:00.100 I/Something( 100): unrelated",
      "11-10 18:20:01.000 E/ActivityManager(  500): ANR in dev.jagra.sample (dev.jagra.sample/.MainActivity)",
      "11-10 18:20:01.000 E/ActivityManager(  500): Reason: Input dispatching timed out",
      "11-10 18:20:01.200 I/Other( 100): next",
    ].join("\n");
    expect(findAppProblem(logcat, "dev.jagra.sample")).toEqual({
      kind: "anr",
      report: [
        "11-10 18:20:01.000 E/ActivityManager(  500): ANR in dev.jagra.sample (dev.jagra.sample/.MainActivity)",
        "11-10 18:20:01.000 E/ActivityManager(  500): Reason: Input dispatching timed out",
      ].join("\n"),
    });
    expect(findAppProblem(logcat, "dev.jagra")).toBeUndefined();
  });
});

describe("readHierarchy (D-50)", () => {
  it("lists the app's texts and leaves out system UI", async () => {
    const elements = readHierarchy(await json("hierarchy.json"));
    const texts = elements.map((e) => e.text);
    expect(texts).toContain("Oat milk 1 L, barista edition");
    expect(texts).toContain("Quantity");
    expect(texts).not.toContain("Save");
    expect(
      elements.some((e) => e.id?.startsWith("com.android.systemui:")),
    ).toBe(false);
    expect(elements.some((e) => e.description?.includes("notification"))).toBe(
      false,
    );
  });
});

describe("wrapperFlow (D-47)", () => {
  it("maps names to environment variables and calls the real flow", () => {
    const text = wrapperFlow(
      "dev.jagra.sample",
      "Signing in",
      "D:\\project\\.jagra\\flows\\login works.yaml",
      ["PASSWORD"],
    );
    const [header, steps] = parseAllDocuments(text).map(
      (d) => d.toJS() as unknown,
    );
    expect(header).toEqual({
      appId: "dev.jagra.sample",
      name: "Signing in",
      env: { PASSWORD: "${MAESTRO_JAGRA_SECRET_PASSWORD}" },
    });
    expect(steps).toEqual([
      { runFlow: "D:/project/.jagra/flows/login works.yaml" },
    ]);
  });

  it("keeps odd names and paths as plain YAML values", () => {
    const text = wrapperFlow(
      "a.b",
      "x: y # z",
      "/tmp/'quoted' \"flow\".yaml",
      [],
    );
    expect(parse(text.split("---\n")[0] ?? "")).toMatchObject({
      name: "x: y # z",
    });
  });
});
