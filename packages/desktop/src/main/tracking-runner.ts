import type {
  JagraError,
  OutputLine,
  ProcessRunner,
  ProcessSpec,
  Result,
  RunningProcess,
} from "@jagra/core";

/** A program Jagra started and has not seen end, for the log. */
export interface TrackedProgram {
  program: string;
  args: readonly string[];
  pid: number;
}

/**
 * Remembers every program it starts until it exits, so all of them can be stopped when Jagra
 * quits, however it quits (REL-3). Emulators are launched, not started, and stay running (DEV-5).
 */
export class TrackingProcessRunner implements ProcessRunner {
  private readonly running = new Map<RunningProcess, TrackedProgram>();

  constructor(private readonly inner: ProcessRunner) {}

  async start(
    spec: ProcessSpec,
    onLine?: (line: OutputLine) => void,
  ): Promise<Result<RunningProcess, JagraError>> {
    const started = await this.inner.start(spec, onLine);
    if (started.ok) {
      const process = started.value;
      this.running.set(process, {
        program: spec.program,
        args: spec.args,
        pid: process.pid,
      });
      void process.exited.then(() => this.running.delete(process));
    }
    return started;
  }

  launch(
    spec: Omit<ProcessSpec, "signal" | "output">,
  ): Promise<Result<void, JagraError>> {
    return this.inner.launch(spec);
  }

  /** How many programs are still running. */
  get count(): number {
    return this.running.size;
  }

  /** The programs still running. */
  list(): TrackedProgram[] {
    return [...this.running.values()];
  }

  /**
   * Stops every program still running, and their children. Waits at most `limitMs`, so Jagra
   * always closes; returns the programs that had not ended by then.
   */
  async stopAll(limitMs = 10_000): Promise<TrackedProgram[]> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all([...this.running.keys()].map((process) => process.stop())),
      new Promise((resolve) => (timer = setTimeout(resolve, limitMs))),
    ]);
    clearTimeout(timer);
    return this.list();
  }
}
