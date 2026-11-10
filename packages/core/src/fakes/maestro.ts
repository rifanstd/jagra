import { ok, type Result } from "../errors/index.js";
import type {
  FlowRunner,
  FlowRunOutcome,
  FlowRunRequest,
} from "../ports/flow-runner.js";

/** Answers per flow file. A flow with no answer passes. An aborted signal gives `cancelled`. */
export class FakeFlowRunner implements FlowRunner {
  readonly requests: FlowRunRequest[] = [];
  private readonly outcomes = new Map<string, FlowRunOutcome>();
  /** Runs before answering, for example to unplug a device in the middle of a flow. */
  during?: (request: FlowRunRequest) => void | Promise<void>;

  set(flowFile: string, outcome: FlowRunOutcome): void {
    this.outcomes.set(flowFile, outcome);
  }

  async run(request: FlowRunRequest): Promise<Result<FlowRunOutcome>> {
    this.requests.push(request);
    await this.during?.(request);
    if (request.signal?.aborted) return ok({ status: "cancelled" });
    return ok(this.outcomes.get(request.flowFile) ?? { status: "passed" });
  }
}
