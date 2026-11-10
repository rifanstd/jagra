import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeProcessRunner,
  type FakeProgram,
} from "../../fakes/process-runner.js";
import { FakeToolFiles } from "../../fakes/tool-files.js";
import type { FlowRunRequest } from "../../ports/flow-runner.js";
import { MaestroFlowRunner } from "./maestro-flow-runner.js";

const MAESTRO = "/opt/maestro/bin/maestro";
const FIXTURES = fileURLToPath(
  new URL("../../../test-fixtures/maestro", import.meta.url),
);

let out: string;
beforeEach(async () => {
  out = await mkdtemp(join(tmpdir(), "jagra-flow-"));
});
afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

interface Writes {
  /** Files to write under the flow's debug folder, as Maestro would. */
  files?: Record<string, string>;
  exit?: number;
  /** Keep running until stopped. */
  hang?: boolean;
}

/** A Maestro that writes the given files into `--debug-output` and exits. */
function setup(writes: Writes) {
  const runner = new FakeProcessRunner();
  runner.define(MAESTRO, (args): FakeProgram => {
    const debug = args[args.indexOf("--debug-output") + 1] ?? "";
    const report = args[args.indexOf("--output") + 1] ?? "";
    const flowDir = join(debug, "Flow name");
    for (const [path, text] of Object.entries(writes.files ?? {})) {
      mkdirSync(join(flowDir, path, ".."), { recursive: true });
      writeFileSync(join(flowDir, path), text);
    }
    if (!writes.hang) writeFileSync(report, "<html>report</html>");
    return writes.hang
      ? { lines: [] }
      : {
          lines: [
            { stream: "stdout", text: "[Failed] Flow name (3s) (last line)" },
          ],
          exit: { code: writes.exit ?? 0, signal: null },
        };
  });
  const flows = new MaestroFlowRunner({
    runner,
    maestro: MAESTRO,
    platform: "darwin",
    environment: () => Promise.resolve({}),
    home: "/home/someone",
    files: new FakeToolFiles(),
    stepPollMs: 5,
  });
  return { runner, flows };
}

const request = (extra: Partial<FlowRunRequest> = {}): FlowRunRequest => ({
  deviceId: "emulator-5554",
  flowFile: "/project/.jagra/flows/save-item.yaml",
  name: "Renaming an item",
  appId: "dev.jagra.sample",
  variables: {},
  timeoutMs: 60_000,
  outputDir: out,
  ...extra,
});

const fixture = (name: string) => readFile(join(FIXTURES, name), "utf8");

describe("MaestroFlowRunner (RUN-5)", () => {
  it("runs the flow file with a report and debug output in the flow's folder", async () => {
    const { runner, flows } = setup({ files: { "commands.json": "[]" } });
    const result = await flows.run(request());
    expect(result).toEqual({
      ok: true,
      value: { status: "passed", steps: [], report: join(out, "report.html") },
    });
    expect(runner.calls[0]?.args).toEqual([
      "--device",
      "emulator-5554",
      "test",
      "--no-ansi",
      "--format",
      "HTML-DETAILED",
      "--output",
      join(out, "report.html"),
      "--debug-output",
      join(out, "debug"),
      "--flatten-debug-output",
      "/project/.jagra/flows/save-item.yaml",
    ]);
    expect(runner.calls[0]?.env).toMatchObject({
      MAESTRO_CLI_NO_ANALYTICS: "1",
    });
  });

  it("reads the failing step, reason, screenshot and screen", async () => {
    const { flows } = setup({
      exit: 1,
      files: {
        "commands.json": await fixture("commands-failed.json"),
        "screen-hierarchy/step-017-tapOnElement-Save.json":
          await fixture("hierarchy.json"),
      },
    });
    const result = await flows.run(request());
    if (!result.ok) throw new Error("run failed");
    expect(result.value).toMatchObject({
      status: "failed",
      failedStep: [7],
      reason: "Element not found: Text matching regex: Save",
      screenshot: join(
        out,
        "debug",
        "Flow name",
        "screenshots",
        "step-017-tapOnElement-Save.png",
      ),
    });
    expect(result.value.detail).toContain("[Failed] Flow name");
    expect(result.value.screen).toContainEqual({ text: "Quantity" });
  });

  it("falls back to Maestro's last line when it wrote no commands", async () => {
    const { flows } = setup({ exit: 1 });
    const result = await flows.run(request());
    expect(result.ok && result.value).toMatchObject({
      status: "failed",
      reason: "[Failed] Flow name (3s) (last line)",
    });
  });

  it("reports the app crash and keeps its report (RUN-6)", async () => {
    const { flows } = setup({
      exit: 1,
      files: { "logs/device-logcat.txt": await fixture("logcat-crash.txt") },
    });
    const result = await flows.run(request());
    if (!result.ok) throw new Error("run failed");
    expect(result.value.status).toBe("app-crashed");
    expect(result.value.crashReport).toBe(join(out, "crash.txt"));
    expect(await readFile(join(out, "crash.txt"), "utf8")).toContain(
      "FATAL EXCEPTION",
    );
  });

  it("passes the latest step on as Maestro logs it (RUN-8)", async () => {
    const log = [
      "18:12:52.395 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: Define variables RUNNING",
      '18:12:53.240 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: Tap on "Username" RUNNING',
      "18:12:53.300 [ INFO] maestro.cli.runner.CliConsoleListener.onCommandStart: Input text hunter2 RUNNING",
      "",
    ].join("\n");
    const { flows } = setup({ files: { "logs/maestro.log": log } });
    const steps: string[] = [];
    await flows.run(
      request({ variables: { PW: "hunter2" }, onStep: (s) => steps.push(s) }),
    );
    expect(steps).toEqual(['Tap on "Username"', "Input text ***"]);
  });
});

describe("MaestroFlowRunner and secrets (RUN-11, RES-7)", () => {
  it("passes values in the environment and runs a wrapper that holds only names (D-47)", async () => {
    const { runner, flows } = setup({ files: { "commands.json": "[]" } });
    await flows.run(request({ variables: { PASSWORD: "hunter2" } }));

    const call = runner.calls[0];
    const wrapper = join(out, "wrapper", "save-item.yaml");
    expect(call?.args.at(-1)).toBe(wrapper);
    expect(call?.args.join(" ")).not.toContain("hunter2");
    expect(call?.env).toMatchObject({
      MAESTRO_JAGRA_SECRET_PASSWORD: "hunter2",
    });
    const text = await readFile(wrapper, "utf8");
    expect(text).toContain("PASSWORD: ${MAESTRO_JAGRA_SECRET_PASSWORD}");
    expect(text).toContain("runFlow: /project/.jagra/flows/save-item.yaml");
    expect(text).not.toContain("hunter2");
  });

  it("masks every text file Maestro wrote, and the reason and details", async () => {
    const { flows } = setup({
      exit: 1,
      files: {
        "commands.json": JSON.stringify([
          {
            command: { runFlowCommand: {} },
            metadata: { status: "RUNNING", depth: 0 },
          },
          {
            command: { inputTextCommand: { text: "hunter2" } },
            metadata: {
              status: "FAILED",
              depth: 1,
              error: { message: "typed hunter2" },
            },
          },
        ]),
        "logs/maestro.log": "MAESTRO_JAGRA_SECRET_PASSWORD=hunter2\n",
      },
    });
    const result = await flows.run(
      request({ variables: { PASSWORD: "hunter2" } }),
    );
    expect(result.ok && result.value.reason).toBe("typed ***");

    for (const entry of await readdir(out, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      const text = await readFile(join(entry.parentPath, entry.name), "utf8");
      expect(text, entry.name).not.toContain("hunter2");
    }
  });
});

describe("MaestroFlowRunner stopping (RUN-7, RUN-9)", () => {
  it("stops a flow at its time limit", async () => {
    const { flows } = setup({ hang: true });
    expect(await flows.run(request({ timeoutMs: 30 }))).toEqual({
      ok: true,
      value: { status: "timed-out" },
    });
  });

  it("stops a flow when cancelled", async () => {
    const { flows } = setup({ hang: true });
    const controller = new AbortController();
    const running = flows.run(request({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 20);
    expect(await running).toEqual({ ok: true, value: { status: "cancelled" } });
  });

  it("reports Maestro that cannot be found", async () => {
    const missing = new MaestroFlowRunner({
      runner: new FakeProcessRunner(),
      maestro: MAESTRO,
      platform: "darwin",
      environment: () => Promise.resolve({}),
      files: new FakeToolFiles(),
    });
    expect(await missing.run(request())).toEqual({
      ok: false,
      error: { code: "PROGRAM_NOT_FOUND", program: MAESTRO },
    });
  });
});
