import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLocal, localFile, updateLocal } from "./local.js";

let appData: string;
beforeEach(async () => {
  appData = await mkdtemp(join(tmpdir(), "jagra-local-"));
});
afterEach(async () => {
  await rm(appData, { recursive: true, force: true });
});

describe("local data per project", () => {
  it("is empty before anything is saved", async () => {
    expect(await loadLocal(appData, "p1")).toEqual({});
  });

  it("merges changes, and removes a field set to undefined", async () => {
    await updateLocal(appData, "p1", {
      apk: "D:/apk/app.apk",
      device: "emulator-5554",
    });
    await updateLocal(appData, "p1", { apk: undefined, flows: ["login.yaml"] });
    expect(await loadLocal(appData, "p1")).toEqual({
      device: "emulator-5554",
      flows: ["login.yaml"],
    });
    expect(await loadLocal(appData, "p2")).toEqual({});
  });

  it("reads a broken file as empty", async () => {
    await mkdir(dirname(localFile(appData, "p1")), { recursive: true });
    await writeFile(localFile(appData, "p1"), "{ not json");
    expect(await loadLocal(appData, "p1")).toEqual({});
  });
});
