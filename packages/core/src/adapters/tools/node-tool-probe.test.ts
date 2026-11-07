import { describe, expect, it } from "vitest";
import { FakeProcessRunner } from "../../fakes/process-runner.js";
import { FakeToolFiles } from "../../fakes/tool-files.js";
import { NodeToolProbe } from "./node-tool-probe.js";
import { MAESTRO_ENV } from "./launch.js";

const JAVA = "C:\\javapath\\java.exe";
const ADB = "C:\\sdk\\platform-tools\\adb.exe";

function setup(files: FakeToolFiles, timeoutMs = 1000) {
  const runner = new FakeProcessRunner();
  const probe = new NodeToolProbe({
    runner,
    platform: "win32",
    environment: () =>
      Promise.resolve({ Path: "C:\\javapath;C:\\maestro\\bin" }),
    home: "C:\\Users\\dev",
    files,
    timeoutMs,
  });
  return { runner, probe };
}

const exit0 = { code: 0, signal: null };

describe("NodeToolProbe", () => {
  it("finds a tool and reads its version", async () => {
    const { runner, probe } = setup(new FakeToolFiles().file(ADB));
    runner.define(ADB, {
      lines: [
        { stream: "stdout", text: "Android Debug Bridge version 1.0.41" },
        { stream: "stdout", text: "Version 37.0.0-14910828" },
      ],
      exit: exit0,
    });

    expect(await probe.probe("adb", { paths: { adb: ADB } })).toEqual({
      found: true,
      path: ADB,
      version: "37.0.0",
    });
    expect(runner.calls[0]?.args).toEqual(["version"]);
  });

  it("reports a missing tool without starting anything", async () => {
    const { runner, probe } = setup(new FakeToolFiles());
    expect(await probe.probe("maestro", { paths: {} })).toEqual({
      found: false,
    });
    expect(runner.calls).toEqual([]);
  });

  it("starts Maestro through Java, with analytics and the update check off", async () => {
    const files = new FakeToolFiles()
      .file(JAVA)
      .file("C:\\maestro\\bin\\maestro.bat")
      .folder("C:\\maestro\\lib");
    const { runner, probe } = setup(files);
    runner.define(JAVA, {
      lines: [{ stream: "stdout", text: "2.12.1" }],
      exit: exit0,
    });

    expect(await probe.probe("maestro", { paths: {} })).toEqual({
      found: true,
      path: "C:\\maestro\\bin\\maestro.bat",
      version: "2.12.1",
    });
    expect(runner.calls[0]?.program).toBe(JAVA);
    expect(runner.calls[0]?.env).toEqual(MAESTRO_ENV);
  });

  it("reports Can't start when a tool exits with an error", async () => {
    const { runner, probe } = setup(new FakeToolFiles().file(JAVA));
    runner.define(JAVA, {
      lines: [{ stream: "stderr", text: "Error: broken install" }],
      exit: { code: 1, signal: null },
    });

    expect(await probe.probe("java", { paths: {} })).toEqual({
      found: true,
      path: JAVA,
      problem: "failed",
      detail: "Error: broken install",
    });
  });

  it("stops a tool that never answers and reports it timed out", async () => {
    const { runner, probe } = setup(new FakeToolFiles().file(JAVA), 20);
    runner.define(JAVA, { lines: [] });

    expect(await probe.probe("java", { paths: {} })).toEqual({
      found: true,
      path: JAVA,
      problem: "timed-out",
    });
  });

  it("reports the launch problem without starting the tool", async () => {
    const files = new FakeToolFiles()
      .file("C:\\maestro\\bin\\maestro.bat")
      .folder("C:\\maestro\\lib");
    const { runner, probe } = setup(files);

    expect(await probe.probe("maestro", { paths: {} })).toEqual({
      found: true,
      path: "C:\\maestro\\bin\\maestro.bat",
      problem: "needs-java",
      detail: undefined,
    });
    expect(runner.calls).toEqual([]);
  });
});
