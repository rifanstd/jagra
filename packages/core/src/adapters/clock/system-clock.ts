import { setTimeout as delay } from "node:timers/promises";
import type { Clock } from "../../ports/clock.js";

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    await delay(ms, undefined, { signal });
  }
}
