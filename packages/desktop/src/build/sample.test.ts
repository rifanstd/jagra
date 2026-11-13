import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleSample, keepSampleFile } from "./sample.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jagra-sample-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function files(base: string, list: string[]): Promise<void> {
  for (const file of list) {
    await mkdir(dirname(join(base, file)), { recursive: true });
    await writeFile(join(base, file), "x");
  }
}

async function tree(base: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(base, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await tree(base, path)));
    else out.push(path);
  }
  return out.sort();
}

describe("bundleSample (SMP-5, D-85)", () => {
  it("copies the sources, .jagra and the debug APK, without build output or local files", async () => {
    const from = join(root, "sample-app");
    await files(from, [
      ".jagra/config.yaml",
      ".jagra/flows/login.yaml",
      ".gitignore",
      "README.md",
      "app/src/main/MainActivity.kt",
      "app/build/outputs/apk/debug/app-debug.apk",
      "app/build/intermediates/classes.jar",
      "app/app.iml",
      ".gradle/cache.bin",
      ".kotlin/session",
      ".idea/workspace.xml",
      "local.properties",
    ]);
    const to = join(root, "out", "sample");
    expect(bundleSample(from, to)).toEqual({ apk: true });
    expect(await tree(to)).toEqual([
      ".gitignore",
      ".jagra/config.yaml",
      ".jagra/flows/login.yaml",
      "README.md",
      "app/build/outputs/apk/debug/app-debug.apk",
      "app/src/main/MainActivity.kt",
    ]);
  });

  it("says when there is no APK, and replaces an older copy", async () => {
    const from = join(root, "sample-app");
    const to = join(root, "out", "sample");
    await files(from, ["README.md"]);
    await files(to, ["stale.txt"]);
    expect(bundleSample(from, to)).toEqual({ apk: false });
    expect(await tree(to)).toEqual(["README.md"]);
  });

  it("keeps only what belongs to the project", () => {
    expect(keepSampleFile("")).toBe(true);
    expect(keepSampleFile("app\\src\\Main.kt")).toBe(true);
    expect(keepSampleFile("app\\build")).toBe(false);
  });
});
