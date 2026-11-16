import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FlowProblem, JagraError, Result } from "../errors/index.js";
import type { SyntaxChecker, SyntaxVerdict } from "../ports/syntax-checker.js";

/** Java starts for every check, so more than two at once slows the machine down (D-98). */
const CHECKS_AT_ONCE = 2;

export type SyntaxState =
  | { state: "checking" }
  | { state: "accepted" }
  | { state: "refused"; problem: FlowProblem }
  /** Maestro is not ready, the file cannot be read, or the check gave no verdict. */
  | { state: "unknown" };

export interface SyntaxChecksOptions {
  /** The checker for the Maestro found now. Undefined while there is none. */
  checker: () => SyntaxChecker | undefined;
  /** After each check, so the flow list can show the result. */
  onChecked?: (file: string) => void;
  /** A check that gave no verdict. The flow is not held back by it. */
  onFailed?: (error: JagraError) => void;
  checksAtOnce?: number;
}

/**
 * Maestro's syntax check, in the background and once per file version (FLOW-6, D-98). Results are
 * kept by the file's contents, so a file is checked again only after it changes, and all of them
 * are dropped when the Maestro in use changes.
 */
export class SyntaxChecks {
  private current: SyntaxChecker | undefined;
  private readonly results = new Map<string, Result<SyntaxVerdict>>();
  private readonly pending = new Map<string, Promise<Result<SyntaxVerdict>>>();
  private running = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly options: SyntaxChecksOptions) {}

  /** The result for the file as it is now. Starts a check in the background when there is none. */
  async state(file: string): Promise<SyntaxState> {
    const checker = this.checker();
    const digest = checker && (await digestOf(file));
    if (!checker || digest === undefined) return { state: "unknown" };
    const known = this.results.get(digest);
    if (known) return stateOf(file, known);
    void this.check(checker, file, digest);
    return { state: "checking" };
  }

  /** Checks the files not checked yet, waits for every result, and returns the refusals. */
  async settle(files: readonly string[]): Promise<Map<string, FlowProblem>> {
    const problems = new Map<string, FlowProblem>();
    await Promise.all(
      files.map(async (file) => {
        const checker = this.checker();
        const digest = checker && (await digestOf(file));
        if (!checker || digest === undefined) return;
        const result =
          this.results.get(digest) ?? (await this.check(checker, file, digest));
        const state = stateOf(file, result);
        if (state.state === "refused") problems.set(file, state.problem);
      }),
    );
    return problems;
  }

  private checker(): SyntaxChecker | undefined {
    const checker = this.options.checker();
    if (checker !== this.current) {
      this.current = checker;
      this.results.clear();
      this.pending.clear();
    }
    return checker;
  }

  private check(
    checker: SyntaxChecker,
    file: string,
    digest: string,
  ): Promise<Result<SyntaxVerdict>> {
    const waiting = this.pending.get(digest);
    if (waiting) return waiting;
    const checking = this.inTurn(async () => {
      const result = await checker.check(file);
      if (!result.ok) this.options.onFailed?.(result.error);
      // Kept only if Maestro read the version that was hashed, with the Maestro still in use.
      if (this.current === checker && (await digestOf(file)) === digest) {
        this.results.set(digest, result);
      }
      return result;
    }).finally(() => {
      if (this.pending.get(digest) === checking) this.pending.delete(digest);
      this.options.onChecked?.(file);
    });
    this.pending.set(digest, checking);
    return checking;
  }

  private async inTurn<T>(work: () => Promise<T>): Promise<T> {
    const limit = this.options.checksAtOnce ?? CHECKS_AT_ONCE;
    while (this.running >= limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await work();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}

function stateOf(file: string, result: Result<SyntaxVerdict>): SyntaxState {
  if (!result.ok) return { state: "unknown" };
  const verdict = result.value;
  if (verdict.accepted) return { state: "accepted" };
  return {
    state: "refused",
    problem:
      verdict.line === undefined
        ? { code: "FLOW_MAESTRO_REFUSED_FILE", file, message: verdict.message }
        : {
            code: "FLOW_MAESTRO_REFUSED",
            file,
            line: verdict.line,
            message: verdict.message,
          },
  };
}

async function digestOf(file: string): Promise<string | undefined> {
  try {
    return createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  } catch {
    return undefined;
  }
}
