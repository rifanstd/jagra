import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ActiveProcessRecord {
  pid: number;
  program: string;
  /** ISO time. Cleanup after a crash compares it with the live process, since pids get reused. */
  startedAt: string;
}

/** The processes Jagra started and has not seen exit (REL-2). */
export interface ActiveProcessStore {
  add(record: ActiveProcessRecord): Promise<void>;
  remove(pid: number): Promise<void>;
  list(): Promise<ActiveProcessRecord[]>;
}

interface StateFile {
  processes?: ActiveProcessRecord[];
  [other: string]: unknown;
}

/** `state/active.json`. Other top-level fields are kept, so later milestones can add their own. */
export class ActiveProcessFile implements ActiveProcessStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  add(record: ActiveProcessRecord): Promise<void> {
    return this.update((state) => ({
      ...state,
      processes: [
        ...(state.processes ?? []).filter((p) => p.pid !== record.pid),
        record,
      ],
    }));
  }

  remove(pid: number): Promise<void> {
    return this.update((state) => ({
      ...state,
      processes: (state.processes ?? []).filter((p) => p.pid !== pid),
    }));
  }

  async list(): Promise<ActiveProcessRecord[]> {
    await this.queue.catch(() => undefined);
    return (await this.read()).processes ?? [];
  }

  private update(change: (state: StateFile) => StateFile): Promise<void> {
    const next = this.queue
      .catch(() => undefined)
      .then(async () => this.write(change(await this.read())));
    this.queue = next;
    return next;
  }

  private async read(): Promise<StateFile> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      return parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
        ? (parsed as StateFile)
        : {};
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw e;
    }
  }

  private async write(state: StateFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    // Write then rename, so a crash mid-write never leaves a half-written file behind.
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2) + "\n");
    await rename(temp, this.file);
  }
}
