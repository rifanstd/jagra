import { homedir } from "node:os";
import type { OutputLine, ProcessRunner } from "../../ports/process-runner.js";
import type {
  ProbeRequest,
  ToolFinding,
  ToolProbe,
} from "../../ports/tool-probe.js";
import type { ToolName } from "../../types/index.js";
import { nodeToolFiles, type ToolFiles } from "./files.js";
import { maestroLaunch, mockoonLaunch, type Launch } from "./launch.js";
import { locateTool, type Machine } from "./locate.js";
import { readVersion, VERSION_ARGS } from "./versions.js";
import { freshWindowsEnvironment } from "./windows-environment.js";

/** Maestro's first start after install took 11 s on Windows (to-verify.md); later ones about 2 s. */
export const PROBE_TIMEOUT_MS = 20_000;

export interface NodeToolProbeOptions {
  runner: ProcessRunner;
  platform?: NodeJS.Platform;
  /** Defaults to the current environment, read fresh from the registry on Windows. */
  environment?: () => Promise<NodeJS.ProcessEnv>;
  home?: string;
  files?: ToolFiles;
  timeoutMs?: number;
}

export class NodeToolProbe implements ToolProbe {
  private readonly runner: ProcessRunner;
  private readonly platform: NodeJS.Platform;
  private readonly environment: () => Promise<NodeJS.ProcessEnv>;
  private readonly home: string;
  private readonly files: ToolFiles;
  private readonly timeoutMs: number;

  constructor(options: NodeToolProbeOptions) {
    this.runner = options.runner;
    this.platform = options.platform ?? process.platform;
    this.environment =
      options.environment ??
      (this.platform === "win32"
        ? () => freshWindowsEnvironment(this.runner, process.env)
        : () => Promise.resolve(process.env));
    this.home = options.home ?? homedir();
    this.files = options.files ?? nodeToolFiles;
    this.timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  }

  async probe(tool: ToolName, request: ProbeRequest): Promise<ToolFinding> {
    const machine: Machine = {
      platform: this.platform,
      env: await this.environment(),
      home: this.home,
      files: this.files,
    };
    const path = locateTool(tool, request.paths, machine);
    if (path === undefined) return { found: false };

    const launch = this.launch(tool, path, request, machine);
    if (!launch.ok) {
      return {
        found: true,
        path,
        problem: launch.problem,
        detail: launch.detail,
      };
    }

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeout])
      : timeout;
    const lines: OutputLine[] = [];
    const started = await this.runner.start(
      { ...launch.spec, signal },
      (line) => lines.push(line),
    );
    if (!started.ok) {
      if (started.error.code === "PROGRAM_NOT_FOUND") return { found: false };
      return {
        found: true,
        path,
        problem: "failed",
        detail: started.error.code,
      };
    }

    const exit = await started.value.exited;
    if (timeout.aborted) return { found: true, path, problem: "timed-out" };
    const version = exit.code === 0 ? readVersion(tool, lines) : undefined;
    if (version === undefined) {
      return {
        found: true,
        path,
        problem: "failed",
        detail: lines
          .slice(-5)
          .map((l) => l.text)
          .join("\n"),
      };
    }
    return { found: true, path, version };
  }

  private launch(
    tool: ToolName,
    path: string,
    request: ProbeRequest,
    machine: Machine,
  ): Launch {
    const args = VERSION_ARGS[tool];
    if (tool === "maestro") {
      return maestroLaunch(path, args, request.paths, machine);
    }
    if (tool === "mockoon") return mockoonLaunch(path, args, machine);
    return { ok: true, spec: { program: path, args } };
  }
}
