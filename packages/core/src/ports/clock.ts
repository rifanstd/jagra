export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  /** Resolves after `ms`, or rejects with the signal's reason when it aborts first. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
