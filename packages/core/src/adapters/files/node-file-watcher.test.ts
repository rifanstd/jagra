import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFileWatcher } from "./node-file-watcher.js";

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "jagra-watch-"));
  await mkdir(join(folder, "parts"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves on the next change report, or after `ms` with false. */
function nextChange(
  watcher: NodeFileWatcher,
  ms = 3000,
): { reported: Promise<boolean>; stop: () => void } {
  let resolve: (value: boolean) => void = () => undefined;
  const reported = new Promise<boolean>((r) => (resolve = r));
  const stop = watcher.watch(folder, () => resolve(true));
  setTimeout(() => resolve(false), ms);
  return { reported, stop };
}

describe("NodeFileWatcher (FLOW-8)", () => {
  it("reports a file added, changed or removed, also in parts/", async () => {
    const watcher = new NodeFileWatcher(50);
    for (const act of [
      () => writeFile(join(folder, "a.yaml"), "1"),
      () => writeFile(join(folder, "a.yaml"), "2"),
      () => writeFile(join(folder, "parts", "login.yaml"), "x"),
      () => unlink(join(folder, "a.yaml")),
    ]) {
      const { reported, stop } = nextChange(watcher);
      await wait(100);
      await act();
      expect(await reported).toBe(true);
      stop();
    }
  });

  it("reports once for a burst of writes", async () => {
    let count = 0;
    const stop = new NodeFileWatcher(150).watch(folder, () => count++);
    await wait(100);
    for (let i = 0; i < 5; i++)
      await writeFile(join(folder, `f${i}.yaml`), "x");
    await wait(600);
    stop();
    expect(count).toBe(1);
  });

  it("reports nothing after it is stopped, and ignores a folder that does not exist", async () => {
    let count = 0;
    const watcher = new NodeFileWatcher(20);
    watcher.watch(folder, () => count++)();
    await writeFile(join(folder, "b.yaml"), "x");
    await wait(200);
    expect(count).toBe(0);
    expect(() =>
      watcher.watch(join(folder, "missing"), () => count++)(),
    ).not.toThrow();
  });
});
