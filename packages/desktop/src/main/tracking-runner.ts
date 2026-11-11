import type {
  JagraError,
  OutputLine,
  ProcessRunner,
  ProcessSpec,
  Result,
  RunningProcess,
} from "@jagra/core";

/**
 * Remembers every program it starts until it exits, so all of them can be stopped when Jagra
 * quits, however it quits (REL-3). Emulators are launched, not started, and stay running (DEV-5).
 */
export class TrackingProcessRunner implements ProcessRunner {
  private readonly running = new Set<RunningProcess>();

  constructor(private readonly inner: ProcessRunner) {}

  async start(
    spec: ProcessSpec,
    onLine?: (line: OutputLine) => void,
  ): Promise<Result<RunningProcess, JagraError>> {
    const started = await this.inner.start(spec, onLine);
    if (started.ok) {
      const process = started.value;
      this.running.add(process);
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

  /** Stops every program still running, and their children. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.running].map((process) => process.stop()));
  }
}
