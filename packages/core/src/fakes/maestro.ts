import { ok, type Result } from "../errors/index.js";
import type {
  FlowRunner,
  FlowRunOutcome,
  FlowRunRequest,
} from "../ports/flow-runner.js";
import type {
  ScreenElement,
  ScreenInspector,
} from "../ports/screen-inspector.js";

/** Answers per flow file. A flow with no answer passes. An aborted signal gives `cancelled`. */
export class FakeFlowRunner implements FlowRunner {
  readonly requests: FlowRunRequest[] = [];
  private readonly outcomes = new Map<string, FlowRunOutcome>();

  set(flowFile: string, outcome: FlowRunOutcome): void {
    this.outcomes.set(flowFile, outcome);
  }

  run(request: FlowRunRequest): Promise<Result<FlowRunOutcome>> {
    this.requests.push(request);
    if (request.signal?.aborted)
      return Promise.resolve(ok({ status: "cancelled" }));
    return Promise.resolve(
      ok(this.outcomes.get(request.flowFile) ?? { status: "passed" }),
    );
  }
}

export class FakeScreenInspector implements ScreenInspector {
  elements: ScreenElement[] = [];

  capture(): Promise<Result<ScreenElement[]>> {
    return Promise.resolve(ok(this.elements));
  }
}
