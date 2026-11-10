import type { Result } from "../errors/index.js";
import type { ScreenElement } from "../types/index.js";

export interface FlowRunRequest {
  deviceId: string;
  /** Full path of the flow file. */
  flowFile: string;
  /** The flow's name (FLOW-2), so a wrapped flow keeps it in Maestro's report. */
  name: string;
  /** The project's `appId`, for the wrapper header and to find crash reports. */
  appId: string;
  /** Values for `${NAME}` variables. They never reach the process list (RUN-11, D-47). */
  variables: Readonly<Record<string, string>>;
  timeoutMs: number;
  /** An empty folder for this flow's output. */
  outputDir: string;
  signal?: AbortSignal;
  /** The step Maestro has just started, masked (RUN-8). */
  onStep?: (label: string) => void;
}

export type FlowRunStatus =
  | "passed"
  | "failed"
  | "timed-out"
  | "cancelled"
  | "app-crashed"
  | "app-not-responding";

export type StepMarkKind = "passed" | "failed" | "not-run";

/** The result of one step, in the order of the flow's steps, with nested steps under it. */
export interface StepMark {
  mark: StepMarkKind;
  steps?: StepMark[];
}

export interface FlowRunOutcome {
  status: FlowRunStatus;
  /** Marks for the flow's top-level steps, when Maestro reported them. */
  steps?: StepMark[];
  /** Indexes from the top-level step down to the failing nested step. */
  failedStep?: number[];
  /** Maestro's one-line reason, masked. */
  reason?: string;
  /** Technical text for "Show details", masked. */
  detail?: string;
  /** Full paths of files in `outputDir`. */
  screenshot?: string;
  /** What was on screen at the failing step (AGT-25, D-50). */
  screen?: ScreenElement[];
  crashReport?: string;
  /** Maestro's HTML report for this flow (RES-6). */
  report?: string;
}

/** One `maestro test` call for one flow (RUN-5). */
export interface FlowRunner {
  run(request: FlowRunRequest): Promise<Result<FlowRunOutcome>>;
}
