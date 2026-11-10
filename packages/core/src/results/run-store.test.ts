import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Run } from "../types/index.js";
import {
  applyRetention,
  listRuns,
  loadRun,
  markInterruptedRuns,
  newRunId,
  runsFolder,
  saveRun,
} from "./run-store.js";

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "jagra-runs-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

const START = Date.UTC(2026, 10, 10, 18, 30, 0, 123);

function run(id: string, extra: Partial<Run> = {}): Run {
  return {
    id,
    projectId: "p1",
    status: "completed",
    startedAt: "2026-11-10T18:30:00.123Z",
    apk: {
      file: "app-debug.apk",
      packageName: "dev.jagra.sample",
      versionName: "1.0",
      versionCode: 1,
      modifiedAt: 0,
    },
    device: { id: "emulator-5554", name: "Pixel_8", kind: "emulator" },
    flows: [],
    pid: 1,
    ...extra,
  };
}

describe("newRunId", () => {
  it("sorts by start time", () => {
    const ids = [START + 5, START, START + 60_000].map((t) =>
      newRunId(t, () => 0.5),
    );
    expect(ids[1]).toBe("20261110-183000-123-8000");
    expect([...ids].sort()).toEqual([ids[1], ids[0], ids[2]]);
  });
});

describe("runs folder", () => {
  it("lives under the project's data folder", () => {
    expect(runsFolder(join("data"), "p1")).toBe(
      join("data", "projects", "p1", "runs"),
    );
  });

  it("saves and loads a run", async () => {
    const id = newRunId(START);
    await saveRun(join(folder, id), run(id));
    expect(await loadRun(join(folder, id))).toEqual(run(id));
    expect(await readdir(join(folder, id))).toEqual(["run.json"]);
  });

  it("lists runs newest first and skips unreadable ones (RES-9)", async () => {
    const ids = [0, 1, 2].map((i) => newRunId(START + i * 1000));
    for (const id of ids) await saveRun(join(folder, id), run(id));
    await saveRun(join(folder, "not-a-run"), run("not-a-run"));
    await writeFile(join(folder, ids[1] ?? "", "run.json"), "{ broken");
    expect((await listRuns(folder)).map((r) => r.id)).toEqual([ids[2], ids[0]]);
  });

  it("keeps the newest 20 runs and deletes the rest with their files (RES-8)", async () => {
    const ids = Array.from({ length: 21 }, (_, i) =>
      newRunId(START + i * 1000),
    );
    for (const id of ids) {
      await saveRun(join(folder, id), run(id));
      await writeFile(join(folder, id, "index.html"), "report");
    }
    expect(await applyRetention(folder)).toEqual([ids[0]]);
    const left = await readdir(folder);
    expect(left).toHaveLength(20);
    expect(left).not.toContain(ids[0]);
  });
});

describe("markInterruptedRuns (REL-2)", () => {
  it("marks a run whose Jagra process is gone, keeping finished flows", async () => {
    const id = newRunId(START);
    await saveRun(
      join(folder, id),
      run(id, {
        status: "running",
        pid: 4242,
        flows: [
          { file: "a.yaml", name: "a", status: "passed", durationMs: 1000 },
          { file: "b.yaml", name: "b", status: "running" },
          { file: "c.yaml", name: "c", status: "waiting" },
        ],
      }),
    );
    expect(
      await markInterruptedRuns(folder, () => false, START + 60_000),
    ).toEqual([id]);
    const marked = await loadRun(join(folder, id));
    expect(marked?.status).toBe("interrupted");
    expect(marked?.endedAt).toBe("2026-11-10T18:31:00.123Z");
    expect(marked?.flows.map((f) => f.status)).toEqual([
      "passed",
      "not-run",
      "not-run",
    ]);
  });

  it("leaves a run that is still going", async () => {
    const id = newRunId(START);
    await saveRun(
      join(folder, id),
      run(id, { status: "running", pid: process.pid }),
    );
    expect(
      await markInterruptedRuns(folder, (pid) => pid === process.pid, START),
    ).toEqual([]);
  });
});
