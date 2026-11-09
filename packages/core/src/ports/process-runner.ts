import type { JagraError, Result } from "../errors/index.js";

export interface ProcessSpec {
  /** A program name found on PATH, or a full path. Never a command line (SEC-8). */
  program: string;
  /** Passed to the program one by one, exactly as given. */
  args: readonly string[];
  cwd?: string;
  /** Added on top of the current environment. */
  env?: Readonly<Record<string, string>>;
  /** Aborting stops the program and its children. */
  signal?: AbortSignal;
  /**
   * `lines` (the default) hands output over one line at a time. `chunks` hands it over as it
   * arrives, for output that is not split into lines, such as `adb track-devices`.
   */
  output?: "lines" | "chunks";
}

/** One line of output, or one piece of it when the spec asks for `chunks`. */
export interface OutputLine {
  stream: "stdout" | "stderr";
  text: string;
}

export interface ProcessExit {
  code: number | null;
  signal: string | null;
}

export interface RunningProcess {
  readonly pid: number;
  /** Settles once the program has exited and its output has been read. */
  readonly exited: Promise<ProcessExit>;
  /** Stops the program and every process it started. Resolves once it has exited. */
  stop(): Promise<void>;
}

/** Starts external programs without a shell, ever (SEC-8, D-21). */
export interface ProcessRunner {
  start(
    spec: ProcessSpec,
    onLine?: (line: OutputLine) => void,
  ): Promise<Result<RunningProcess, JagraError>>;
  /**
   * Starts a program that should keep running after Jagra closes, such as an emulator (DEV-5).
   * Its output is ignored, it is not recorded in `state/active.json` and Jagra never stops it.
   */
  launch(
    spec: Omit<ProcessSpec, "signal" | "output">,
  ): Promise<Result<void, JagraError>>;
}
