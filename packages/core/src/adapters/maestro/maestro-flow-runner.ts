import { mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fail, ok, type Result } from "../../errors/index.js";
import { maskFiles, outputMasker } from "../../log/mask-files.js";
import type { Masker } from "../../log/masker.js";
import type { Clock } from "../../ports/clock.js";
import type {
  FlowRunner,
  FlowRunOutcome,
  FlowRunRequest,
} from "../../ports/flow-runner.js";
import type { OutputLine, ProcessRunner } from "../../ports/process-runner.js";
import type { ToolPaths } from "../../ports/tool-probe.js";
import type { ScreenElement } from "../../types/index.js";
import { SystemClock } from "../clock/system-clock.js";
import { nodeToolFiles, type ToolFiles } from "../tools/files.js";
import { maestroLaunch } from "../tools/launch.js";
import type { Machine } from "../tools/locate.js";
import { freshWindowsEnvironment } from "../tools/windows-environment.js";
import {
  findAppProblem,
  readCommands,
  readHierarchy,
  secretVariable,
  stepStarted,
  wrapperFlow,
} from "./maestro-output.js";

/** How often the step shown on the Running screen is refreshed (RUN-8). */
const STEP_POLL_MS = 500;

export interface MaestroFlowRunnerOptions {
  runner: ProcessRunner;
  /** Full path to Maestro, from the environment check. */
  maestro: string;
  /** Paths set in Settings, so Maestro gets the same Java the check found (ENV-6). */
  toolPaths?: ToolPaths;
  clock?: Clock;
  platform?: NodeJS.Platform;
  environment?: () => Promise<NodeJS.ProcessEnv>;
  home?: string;
  files?: ToolFiles;
  stepPollMs?: number;
}

/**
 * Runs one flow with `maestro test` and reads what Maestro wrote (RUN-5, D-47 to D-51). Every text
 * file Maestro writes is masked before anything else reads it.
 */
export class MaestroFlowRunner implements FlowRunner {
  private readonly options: MaestroFlowRunnerOptions;
  private readonly clock: Clock;
  private readonly platform: NodeJS.Platform;

  constructor(options: MaestroFlowRunnerOptions) {
    this.options = options;
    this.clock = options.clock ?? new SystemClock();
    this.platform = options.platform ?? process.platform;
  }

  async run(request: FlowRunRequest): Promise<Result<FlowRunOutcome>> {
    const { outputDir, variables } = request;
    const masker = outputMasker(Object.values(variables));
    const names = Object.keys(variables);
    const wrapped = names.length > 0;
    const report = join(outputDir, "report.html");
    const debug = join(outputDir, "debug");
    await mkdir(debug, { recursive: true });

    let target = request.flowFile;
    if (wrapped) {
      // Named like the flow, because Maestro shows the file name in its report.
      target = join(outputDir, "wrapper", basename(request.flowFile));
      await mkdir(join(outputDir, "wrapper"), { recursive: true });
      await writeFile(
        target,
        wrapperFlow(request.appId, request.name, request.flowFile, names),
        "utf8",
      );
    }

    const args = [
      "--device",
      request.deviceId,
      "test",
      "--no-ansi",
      "--format",
      "HTML-DETAILED",
      "--output",
      report,
      // Keeps Maestro's logs, which hold secret values, out of ~/.maestro/tests (D-48).
      "--debug-output",
      debug,
      "--flatten-debug-output",
      target,
    ];
    const launch = maestroLaunch(
      this.options.maestro,
      args,
      this.options.toolPaths ?? {},
      await this.machine(),
    );
    if (!launch.ok) {
      return fail({
        code: "PROGRAM_START_FAILED",
        program: "maestro",
        detail: [launch.problem, launch.detail].filter(Boolean).join(": "),
      });
    }
    const env: Record<string, string> = { ...launch.spec.env };
    for (const [name, value] of Object.entries(variables)) {
      env[secretVariable(name)] = value;
    }

    const timeout = AbortSignal.timeout(request.timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeout])
      : timeout;
    const lines: OutputLine[] = [];
    const started = await this.options.runner.start(
      { ...launch.spec, env, signal },
      (line) => lines.push(line),
    );
    if (!started.ok) return started;
    // With a wrapper, its own `runFlow` step is not one of the flow's steps.
    const wrapperStep = `Run ${request.flowFile.replaceAll("\\", "/")}`;
    const following = this.followSteps(debug, started.value.exited, (label) => {
      if (!wrapped || label !== wrapperStep)
        request.onStep?.(masker.mask(label));
    });
    const exit = await started.value.exited;
    await following;
    try {
      await maskFiles(outputDir, masker);
    } catch (e) {
      return fail({
        code: "OUTPUT_MASK_FAILED",
        folder: outputDir,
        detail: String(e),
      });
    }

    if (request.signal?.aborted) return ok({ status: "cancelled" });
    if (timeout.aborted) return ok({ status: "timed-out" });
    return ok(
      await this.outcome(request, exit.code === 0, wrapped, lines, masker),
    );
  }

  private async outcome(
    request: FlowRunRequest,
    passed: boolean,
    wrapped: boolean,
    lines: OutputLine[],
    masker: Masker,
  ): Promise<FlowRunOutcome> {
    const { outputDir } = request;
    const outcome: FlowRunOutcome = { status: passed ? "passed" : "failed" };
    const report = join(outputDir, "report.html");
    if (await exists(report)) outcome.report = report;

    const flowDir = await firstFolder(join(outputDir, "debug"));
    const commands = flowDir
      ? readCommands(await readJson(join(flowDir, "commands.json")), wrapped)
      : undefined;
    if (commands) {
      outcome.steps = commands.steps;
      if (commands.failedStep) outcome.failedStep = commands.failedStep;
    }
    if (passed) return outcome;

    const failure = commands?.failure;
    const output = lines
      .map((l) => l.text)
      .filter((t) => t.trim() !== "")
      .slice(-20);
    outcome.reason = masker.mask(failure?.message ?? output.at(-1) ?? "");
    outcome.detail = masker.mask(
      [failure?.debugMessage, output.join("\n")].filter(Boolean).join("\n\n"),
    );
    if (flowDir && failure?.screenshot) {
      outcome.screenshot = join(flowDir, failure.screenshot);
    }
    if (flowDir && failure?.hierarchy) {
      const hierarchy = await readJson(join(flowDir, failure.hierarchy));
      if (hierarchy !== undefined) {
        outcome.screen = masker.maskDeep(
          readHierarchy(hierarchy),
        ) as ScreenElement[];
      }
    }

    const logcat = flowDir
      ? await readFile(
          join(flowDir, "logs", "device-logcat.txt"),
          "utf8",
        ).catch(() => "")
      : "";
    const problem = findAppProblem(logcat, request.appId);
    if (problem) {
      outcome.status =
        problem.kind === "crash" ? "app-crashed" : "app-not-responding";
      outcome.crashReport = join(
        outputDir,
        problem.kind === "crash" ? "crash.txt" : "anr.txt",
      );
      await writeFile(outcome.crashReport, masker.mask(problem.report), "utf8");
    }
    return outcome;
  }

  /** Reads the flow's log as Maestro writes it and reports each step it starts (RUN-8, D-49). */
  private async followSteps(
    debug: string,
    exited: Promise<unknown>,
    onStep: (label: string) => void,
  ): Promise<void> {
    let done = false;
    const finished = exited.then(() => {
      done = true;
    });
    let log: string | undefined;
    let offset = 0;
    let partial = "";
    for (;;) {
      const last = done;
      if (log === undefined) {
        const folder = await firstFolder(debug);
        if (folder && (await exists(join(folder, "logs", "maestro.log")))) {
          log = join(folder, "logs", "maestro.log");
        }
      }
      if (log !== undefined) {
        const read = await readFrom(log, offset);
        offset += read.bytes;
        const lines = (partial + read.text).split(/\r?\n/);
        partial = lines.pop() ?? "";
        for (const line of lines) {
          const label = stepStarted(line);
          if (label !== undefined) onStep(label);
        }
      }
      if (last) return;
      await Promise.race([
        this.clock
          .sleep(this.options.stepPollMs ?? STEP_POLL_MS)
          .catch(() => undefined),
        finished,
      ]);
    }
  }

  private async machine(): Promise<Machine> {
    const env = this.options.environment
      ? await this.options.environment()
      : this.platform === "win32"
        ? await freshWindowsEnvironment(this.options.runner, process.env)
        : process.env;
    return {
      platform: this.platform,
      env,
      home: this.options.home ?? homedir(),
      files: this.options.files ?? nodeToolFiles,
    };
  }
}

async function readFrom(
  file: string,
  offset: number,
): Promise<{ text: string; bytes: number }> {
  const handle = await open(file, "r").catch(() => undefined);
  if (!handle) return { text: "", bytes: 0 };
  try {
    const { size } = await handle.stat();
    if (size <= offset) return { text: "", bytes: 0 };
    const buffer = Buffer.alloc(size - offset);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    return {
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      bytes: bytesRead,
    };
  } finally {
    await handle.close();
  }
}

/** With flattened debug output, Maestro writes one folder per flow, named after the flow. */
async function firstFolder(folder: string): Promise<string | undefined> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(
    () => [],
  );
  const first = entries.find((e) => e.isDirectory());
  return first ? join(folder, first.name) : undefined;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  const handle = await open(file, "r").catch(() => undefined);
  await handle?.close();
  return handle !== undefined;
}
