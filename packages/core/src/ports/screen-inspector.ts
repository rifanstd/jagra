import type { Result } from "../errors/index.js";

export interface ScreenElement {
  text?: string;
  id?: string;
  description?: string;
}

/** Captures what is on screen right after a failure (AGT-25). The command is confirmed in M5. */
export interface ScreenInspector {
  capture(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<Result<ScreenElement[]>>;
}
