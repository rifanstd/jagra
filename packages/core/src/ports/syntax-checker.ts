import type { Result } from "../errors/index.js";

/** What Maestro said about one flow file. */
export type SyntaxVerdict =
  | { accepted: true }
  | {
      accepted: false;
      /** Maestro's own words, such as `Invalid Command: tapOnn`. */
      message: string;
      /** Missing when Maestro does not say where. */
      line?: number;
    };

/** Maestro's own check of one flow file, without a device (FLOW-6, D-98). */
export interface SyntaxChecker {
  /** Fails only when the check itself could not run. A refused flow is a verdict. */
  check(file: string, signal?: AbortSignal): Promise<Result<SyntaxVerdict>>;
}
