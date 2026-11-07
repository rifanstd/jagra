import type { Clock } from "../ports/clock.js";

interface Sleeper {
  until: number;
  resolve: () => void;
}

/** Time only moves when a test calls `advance`. */
export class FakeClock implements Clock {
  private time: number;
  private sleepers: Sleeper[] = [];

  constructor(start = Date.UTC(2026, 0, 1)) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason as Error);
        return;
      }
      const sleeper: Sleeper = { until: this.time + ms, resolve };
      this.sleepers.push(sleeper);
      signal?.addEventListener(
        "abort",
        () => {
          this.sleepers = this.sleepers.filter((s) => s !== sleeper);
          reject(signal.reason as Error);
        },
        { once: true },
      );
    });
  }

  advance(ms: number): void {
    this.time += ms;
    const due = this.sleepers.filter((s) => s.until <= this.time);
    this.sleepers = this.sleepers.filter((s) => s.until > this.time);
    for (const sleeper of due) sleeper.resolve();
  }
}
