import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ActiveProcessRecord {
  pid: number;
  program: string;
  /** ISO time. Cleanup after a crash compares it with the live process, since pids get reused. */
  startedAt: string;
  /** The Jagra process that started it, so one Jagra never cleans up after another that runs. */
  owner?: number;
  /** The port a Mockoon process listens on, which proves it is still that process (D-63). */
  port?: number;
}

/** An `adb reverse` rule Jagra added (MCK-4). */
export interface ReverseRecord {
  deviceId: string;
  port: number;
  owner: number;
}

/** What a run adds to `state/active.json` besides processes (REL-2). */
export interface RunStateStore {
  /** Notes the port a recorded process listens on. */
  setPort(pid: number, port: number): Promise<void>;
  addReverse(record: ReverseRecord): Promise<void>;
  removeReverse(record: ReverseRecord): Promise<void>;
  listReverse(): Promise<ReverseRecord[]>;
}

/** The processes Jagra started and has not seen exit (REL-2). */
export interface ActiveProcessStore {
  add(record: ActiveProcessRecord): Promise<void>;
  remove(pid: number): Promise<void>;
  list(): Promise<ActiveProcessRecord[]>;
}

interface StateFile {
  processes?: ActiveProcessRecord[];
  reverse?: ReverseRecord[];
  [other: string]: unknown;
}

/** `state/active.json`. Other top-level fields are kept, so later milestones can add their own. */
export class ActiveProcessFile implements ActiveProcessStore, RunStateStore {
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

  setPort(pid: number, port: number): Promise<void> {
    return this.update((state) => ({
      ...state,
      processes: (state.processes ?? []).map((p) =>
        p.pid === pid ? { ...p, port } : p,
      ),
    }));
  }

  addReverse(record: ReverseRecord): Promise<void> {
    return this.update((state) => ({
      ...state,
      reverse: [
        ...(state.reverse ?? []).filter((r) => !sameRule(r, record)),
        record,
      ],
    }));
  }

  removeReverse(record: ReverseRecord): Promise<void> {
    return this.update((state) => ({
      ...state,
      reverse: (state.reverse ?? []).filter((r) => !sameRule(r, record)),
    }));
  }

  async listReverse(): Promise<ReverseRecord[]> {
    await this.queue.catch(() => undefined);
    return (await this.read()).reverse ?? [];
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

function sameRule(a: ReverseRecord, b: ReverseRecord): boolean {
  return a.deviceId === b.deviceId && a.port === b.port;
}
