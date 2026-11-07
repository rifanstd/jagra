import type { Result } from "../errors/index.js";

export interface FlowRunRequest {
  deviceId: string;
  flowFile: string;
  /** Values for `${NAME}` variables. Secrets are passed so they never show in the process list (RUN-11). */
  variables: Readonly<Record<string, string>>;
  timeoutMs: number;
  outputDir: string;
  signal?: AbortSignal;
}

export type FlowRunStatus =
  | "passed"
  | "failed"
  | "timed-out"
  | "cancelled"
  | "app-crashed"
  | "app-not-responding";

export interface FlowRunOutcome {
  status: FlowRunStatus;
  /** Index of the failing top-level step, when Maestro reports one. */
  failedStepIndex?: number;
  /** Maestro's own reason, technical text for "Show details". */
  detail?: string;
}

/** One `maestro test` call for one flow (RUN-5). Flags are confirmed in M5 (to-verify.md). */
export interface FlowRunner {
  run(request: FlowRunRequest): Promise<Result<FlowRunOutcome>>;
}
