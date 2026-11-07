import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "../ports/clock.js";
import type { Masker } from "./masker.js";

export type LogLevel = "info" | "warn" | "error";

export interface LogSink {
  write(line: string): Promise<void>;
}

/** Technical log in English (LNG-2). Every entry is masked before it reaches the sink (REL-7, SEC-4). */
export class Logger {
  constructor(
    private readonly sink: LogSink,
    private readonly masker: Masker,
    private readonly clock: Clock,
  ) {}

  info(event: string, fields: Record<string, unknown> = {}): Promise<void> {
    return this.log("info", event, fields);
  }

  warn(event: string, fields: Record<string, unknown> = {}): Promise<void> {
    return this.log("warn", event, fields);
  }

  error(event: string, fields: Record<string, unknown> = {}): Promise<void> {
    return this.log("error", event, fields);
  }

  private log(
    level: LogLevel,
    event: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const entry = {
      ...fields,
      time: new Date(this.clock.now()).toISOString(),
      level,
      event,
    };
    return this.sink.write(JSON.stringify(this.masker.maskDeep(entry)) + "\n");
  }
}

export interface RotationLimits {
  maxFileBytes: number;
  maxFiles: number;
}

// REL-7: about 15 MB of logs at most, oldest file removed first.
export const DEFAULT_ROTATION: RotationLimits = {
  maxFileBytes: 5 * 1024 * 1024,
  maxFiles: 3,
};

/** Writes `jagra.log` in `dir`, rotating to `jagra.1.log`, `jagra.2.log`, ... */
export class RotatingFileSink implements LogSink {
  private size: number | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly limits: RotationLimits = DEFAULT_ROTATION,
  ) {}

  write(line: string): Promise<void> {
    const next = this.queue.then(() => this.append(line));
    // A failed write must not block every later one.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private file(index: number): string {
    return join(this.dir, index === 0 ? "jagra.log" : `jagra.${index}.log`);
  }

  private async append(line: string): Promise<void> {
    const bytes = Buffer.byteLength(line);
    if (this.size === undefined) {
      await mkdir(this.dir, { recursive: true });
      this.size = await stat(this.file(0)).then(
        (s) => s.size,
        () => 0,
      );
    }
    if (this.size > 0 && this.size + bytes > this.limits.maxFileBytes) {
      await this.rotate();
      this.size = 0;
    }
    await appendFile(this.file(0), line);
    this.size += bytes;
  }

  private async rotate(): Promise<void> {
    await rm(this.file(this.limits.maxFiles - 1), { force: true });
    for (let i = this.limits.maxFiles - 2; i >= 0; i--) {
      await rename(this.file(i), this.file(i + 1)).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT") throw e;
        },
      );
    }
  }
}
