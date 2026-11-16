import { stripVTControlCharacters } from "node:util";
import { fail, ok, type Result } from "../../errors/index.js";
import type { OutputLine, ProcessRunner } from "../../ports/process-runner.js";
import type {
  SyntaxChecker,
  SyntaxVerdict,
} from "../../ports/syntax-checker.js";
import type { ToolPaths } from "../../ports/tool-probe.js";
import type { ToolFiles } from "../tools/files.js";
import { maestroLaunch } from "../tools/launch.js";
import { currentMachine } from "../tools/machine.js";

/** One check takes 5 to 7 seconds, most of it Java starting (D-98). */
const CHECK_TIMEOUT_MS = 60_000;

/** `Invalid Command: tapOnn at C:\syntax-checker:4:9`. Maestro prints its own name for the file. */
const REFUSAL = /^(.+?) at .+:(-?\d+):(-?\d+)$/;

export interface MaestroSyntaxCheckerOptions {
  runner: ProcessRunner;
  /** Full path to Maestro, from the environment check. */
  maestro: string;
  toolPaths?: ToolPaths;
  platform?: NodeJS.Platform;
  environment?: () => Promise<NodeJS.ProcessEnv>;
  home?: string;
  files?: ToolFiles;
  timeoutMs?: number;
}

/** `maestro check-syntax <file>`, one file per call (D-98, `to-verify.md`). */
export class MaestroSyntaxChecker implements SyntaxChecker {
  constructor(private readonly options: MaestroSyntaxCheckerOptions) {}

  async check(
    file: string,
    signal?: AbortSignal,
  ): Promise<Result<SyntaxVerdict>> {
    const launch = maestroLaunch(
      this.options.maestro,
      ["check-syntax", file],
      this.options.toolPaths ?? {},
      await currentMachine(this.options),
    );
    if (!launch.ok) {
      return fail({
        code: "PROGRAM_START_FAILED",
        program: "maestro",
        detail: [launch.problem, launch.detail].filter(Boolean).join(": "),
      });
    }
    const timeout = AbortSignal.timeout(
      this.options.timeoutMs ?? CHECK_TIMEOUT_MS,
    );
    const lines: OutputLine[] = [];
    const started = await this.options.runner.start(
      {
        ...launch.spec,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
      (line) => lines.push(line),
    );
    if (!started.ok) return started;
    const exit = await started.value.exited;
    return readSyntaxVerdict(
      file,
      exit.code,
      lines.map((l) => l.text),
    );
  }
}

/** Reads Maestro's answer. Exit 0 accepts the flow, exit 1 with a message refuses it. */
export function readSyntaxVerdict(
  file: string,
  code: number | null,
  output: readonly string[],
): Result<SyntaxVerdict> {
  const lines = output
    .flatMap((text) => stripVTControlCharacters(text).split(/\r?\n/))
    .map((text) => text.trim())
    .filter((text) => text !== "");
  if (code === 0) return ok({ accepted: true });
  // Anything else, such as Java failing to start, is not a verdict on the flow.
  const match = code === 1 ? REFUSAL.exec(lines.at(-1) ?? "") : null;
  if (!match?.[1]) {
    return fail({
      code: "SYNTAX_CHECK_FAILED",
      file,
      detail: [`exit ${code ?? "none"}`, ...lines.slice(-5)].join("\n"),
    });
  }
  const line = Number(match[2]);
  return ok({
    accepted: false,
    message: match[1],
    ...(line > 0 ? { line } : {}),
  });
}
