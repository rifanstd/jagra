import type { Result } from "../errors/index.js";

export interface MockServerHandle {
  readonly port: number;
  stop(): Promise<void>;
}

/** Mockoon CLI (MCK-2, MCK-5). Flags and readiness are confirmed in M6 (to-verify.md). */
export interface MockServer {
  /** Resolves once the port accepts connections. */
  start(
    file: string,
    port: number | undefined,
    signal?: AbortSignal,
  ): Promise<Result<MockServerHandle>>;
}
