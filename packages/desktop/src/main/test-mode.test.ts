import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBlackScreenshot } from "@jagra/core";
import { describe, expect, it } from "vitest";
import { isTestMode, TestFlowRunner, testToolProbe } from "./test-mode.js";

const request = { paths: {} };

describe("isTestMode (D-81)", () => {
  it("is on only with JAGRA_TEST_MODE=1 in an app that is not packaged", () => {
    expect(isTestMode({ JAGRA_TEST_MODE: "1" }, false)).toBe(true);
    expect(isTestMode({ JAGRA_TEST_MODE: "1" }, true)).toBe(false);
    expect(isTestMode({ JAGRA_TEST_MODE: "true" }, false)).toBe(false);
    expect(isTestMode({}, false)).toBe(false);
  });
});

describe("testToolProbe", () => {
  it("finds every tool by default", async () => {
    const probe = testToolProbe({});
    expect(await probe.probe("maestro", request)).toMatchObject({
      found: true,
      version: "2.12.1",
    });
    expect(await probe.probe("java", request)).toMatchObject({ found: true });
  });

  it("applies JAGRA_TEST_TOOLS and ignores what it does not know", async () => {
    const probe = testToolProbe({
      JAGRA_TEST_TOOLS:
        "maestro=missing,mockoon=9.12.0,adb=needs-java,nope=1,java",
    });
    expect(await probe.probe("maestro", request)).toEqual({ found: false });
    expect(await probe.probe("mockoon", request)).toMatchObject({
      version: "9.12.0",
    });
    expect(await probe.probe("adb", request)).toMatchObject({
      problem: "needs-java",
    });
    expect(await probe.probe("java", request)).toMatchObject({
      version: "17.0.12",
    });
  });
});

describe("TestFlowRunner", () => {
  it("passes by default, and gives the outcomes JAGRA_TEST_RUN asks for", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "jagra-test-runner-"));
    const runner = new TestFlowRunner({
      JAGRA_TEST_FLOW_MS: "0",
      JAGRA_TEST_RUN: "a.yaml=failed,b.yaml=black,c.yaml=app-crashed",
    });
    const run = (file: string) =>
      runner.run({
        deviceId: "emulator-5554",
        flowFile: join("/p", file),
        name: file,
        appId: "dev.jagra.sample",
        variables: {},
        timeoutMs: 1000,
        outputDir,
      });
    expect(await run("ok.yaml")).toEqual({
      ok: true,
      value: { status: "passed" },
    });
    expect(await run("a.yaml")).toMatchObject({
      value: { status: "failed", failedStep: [1] },
    });

    const black = await run("b.yaml");
    const shot = black.ok ? black.value.screenshot : undefined;
    expect(shot && isBlackScreenshot(await readFile(shot))).toBe(true);

    const crash = await run("c.yaml");
    const report = crash.ok ? crash.value.crashReport : undefined;
    expect(report && (await readFile(report, "utf8"))).toContain(
      "FATAL EXCEPTION",
    );
    await rm(outputDir, { recursive: true, force: true });
  });
});
