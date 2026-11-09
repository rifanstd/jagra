import { fail, ok, type JagraError, type Result } from "../errors/index.js";
import type {
  OutputLine,
  ProcessExit,
  ProcessRunner,
  ProcessSpec,
  RunningProcess,
} from "../ports/process-runner.js";

export interface FakeProgram {
  lines?: OutputLine[];
  /** Exit right after printing. When left out, the program runs until stopped. */
  exit?: ProcessExit;
}

export type FakeAnswer =
  | FakeProgram
  | JagraError
  | ((args: readonly string[]) => FakeProgram | JagraError);

/** Plays back a scripted answer per program and records every call. */
export class FakeProcessRunner implements ProcessRunner {
  readonly calls: ProcessSpec[] = [];
  /** Programs started with `launch`, which outlive Jagra. */
  readonly launched: Omit<ProcessSpec, "signal" | "output">[] = [];
  private readonly programs = new Map<string, FakeAnswer>();
  private nextPid = 1000;

  /** A fixed answer, or a function that answers from the arguments. */
  define(program: string, answer: FakeAnswer): void {
    this.programs.set(program, answer);
  }

  start(
    spec: ProcessSpec,
    onLine?: (line: OutputLine) => void,
  ): Promise<Result<RunningProcess, JagraError>> {
    this.calls.push(spec);
    const answer = this.answerFor(spec);
    if (answer === undefined) {
      return Promise.resolve(
        fail({ code: "PROGRAM_NOT_FOUND", program: spec.program }),
      );
    }
    if ("code" in answer) return Promise.resolve(fail(answer));

    let finish: (exit: ProcessExit) => void = () => undefined;
    const exited = new Promise<ProcessExit>((resolve) => (finish = resolve));
    const stop = () => {
      finish({ code: null, signal: "SIGTERM" });
      return exited.then(() => undefined);
    };
    for (const line of answer.lines ?? []) onLine?.(line);
    if (answer.exit) finish(answer.exit);
    if (spec.signal?.aborted) void stop();
    spec.signal?.addEventListener("abort", () => void stop(), { once: true });

    return Promise.resolve(ok({ pid: this.nextPid++, exited, stop }));
  }

  launch(
    spec: Omit<ProcessSpec, "signal" | "output">,
  ): Promise<Result<void, JagraError>> {
    this.launched.push(spec);
    const answer = this.answerFor(spec);
    if (answer === undefined) {
      return Promise.resolve(
        fail({ code: "PROGRAM_NOT_FOUND", program: spec.program }),
      );
    }
    return Promise.resolve("code" in answer ? fail(answer) : ok(undefined));
  }

  private answerFor(
    spec: Omit<ProcessSpec, "signal" | "output">,
  ): FakeProgram | JagraError | undefined {
    const answer = this.programs.get(spec.program);
    return typeof answer === "function" ? answer(spec.args) : answer;
  }
}
