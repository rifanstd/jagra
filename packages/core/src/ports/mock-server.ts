import type { Result } from "../errors/index.js";

export interface MockServerRequest {
  /** Full path of the project's Mockoon file. Jagra never changes it (MCK-1). */
  file: string;
  port: number;
  signal?: AbortSignal;
  /** Each line Mockoon prints, for `mockoon.log` (D-64). */
  onLine?: (line: string) => void;
}

export interface MockServerHandle {
  readonly port: number;
  /** The Mockoon process, recorded with its port for cleanup after a crash (REL-2). */
  readonly pid: number;
  /** Stops Mockoon. Resolves once it has exited. */
  stop(): Promise<void>;
}

/** Mockoon CLI (MCK-2, MCK-5). */
export interface MockServer {
  /** Resolves once the port accepts connections, within 30 seconds (MCK-2). */
  start(request: MockServerRequest): Promise<Result<MockServerHandle>>;
}
