import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActiveProcessFile } from "./active-processes.js";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jagra-state-"));
  file = join(dir, "state", "active.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const record = (pid: number) => ({
  pid,
  program: "maestro",
  startedAt: "2026-11-07T09:30:00.000Z",
});

describe("ActiveProcessFile (REL-2)", () => {
  it("starts empty when the file does not exist", async () => {
    expect(await new ActiveProcessFile(file).list()).toEqual([]);
  });

  it("adds and removes records, also when calls overlap", async () => {
    const store = new ActiveProcessFile(file);
    await Promise.all([
      store.add(record(1)),
      store.add(record(2)),
      store.add(record(3)),
    ]);
    await store.remove(2);
    expect((await store.list()).map((r) => r.pid)).toEqual([1, 3]);
    expect(
      (await new ActiveProcessFile(file).list()).map((r) => r.pid),
    ).toEqual([1, 3]);
  });

  it("keeps fields it does not own, such as reverse rules added later", async () => {
    await new ActiveProcessFile(file).add(record(1));
    const written = JSON.parse(await readFile(file, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      file,
      JSON.stringify({ ...written, reverseRules: [{ port: 3000 }] }),
    );

    await new ActiveProcessFile(file).remove(1);

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      processes: [],
      reverseRules: [{ port: 3000 }],
    });
  });
});
