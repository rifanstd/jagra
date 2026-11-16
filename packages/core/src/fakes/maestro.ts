import { ok, type JagraError, type Result } from "../errors/index.js";
import type {
  FlowRunner,
  FlowRunOutcome,
  FlowRunRequest,
} from "../ports/flow-runner.js";
import type { SyntaxChecker, SyntaxVerdict } from "../ports/syntax-checker.js";

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

/** Verdicts per flow file. A file with no verdict is accepted. `release` lets held checks finish. */
export class FakeSyntaxChecker implements SyntaxChecker {
  readonly checked: string[] = [];
  private readonly verdicts = new Map<string, Result<SyntaxVerdict>>();
  private readonly held: (() => void)[] = [];
  /** Checks wait for `release` while this is on. */
  hold = false;

  set(file: string, verdict: SyntaxVerdict | JagraError): void {
    this.verdicts.set(
      file,
      "code" in verdict ? { ok: false, error: verdict } : ok(verdict),
    );
  }

  /** Lets every held check finish. */
  release(): void {
    for (const resume of this.held.splice(0)) resume();
  }

  async check(file: string): Promise<Result<SyntaxVerdict>> {
    this.checked.push(file);
    if (this.hold) await new Promise<void>((resume) => this.held.push(resume));
    return this.verdicts.get(file) ?? ok({ accepted: true });
  }
}
