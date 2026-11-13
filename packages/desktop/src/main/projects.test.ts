import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  knownProjects,
  loadLocal,
  runsFolder,
  saveRun,
  type Run,
} from "@jagra/core";
import { FakeApkReader } from "@jagra/core/fakes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Projects, type Dialogs } from "./projects.js";

let root: string;
let appData: string;
let sample: string;
let documents: string;
let answers: (string | undefined)[];
let opened: string[];
let reader: FakeApkReader;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jagra-projects-"));
  appData = join(root, "data");
  documents = join(root, "Documents");
  sample = join(root, "bundled-sample");
  answers = [];
  opened = [];
  reader = new FakeApkReader();
  ids = 0;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Each dialog takes the next answer, as if the user picked it. */
const dialogs: Dialogs = {
  pickFolder: () => Promise.resolve(answers.shift()),
  pickApk: () => Promise.resolve(answers.shift()),
  pickJson: () => Promise.resolve(answers.shift()),
};

let ids = 0;
function projects(): Projects {
  return new Projects({
    appData,
    documents,
    sample,
    apkReader: reader,
    dialogs,
    openPath: (path) => {
      opened.push(path);
      return Promise.resolve();
    },
    newId: () => `p${++ids}`,
  });
}

async function folder(
  name: string,
  files: Record<string, string> = {},
): Promise<string> {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(path, file, ".."), { recursive: true });
    await writeFile(join(path, file), text);
  }
  return path;
}

describe("Create project (PRJ-1 to PRJ-6)", () => {
  it("previews a plain folder, then creates .jagra and adds the project", async () => {
    const app = await folder("toko-kopi", {
      "app/build/outputs/apk/debug/app-debug.apk": "apk",
    });
    const apk = join(app, "app/build/outputs/apk/debug/app-debug.apk");
    reader.set(apk, {
      packageName: "com.kopi",
      versionName: "2.3.1",
      versionCode: 231,
    });
    const list = projects();

    answers.push(app);
    const preview = await list.pickFolder();
    expect(preview).toMatchObject({
      folder: app,
      hasConfig: false,
      name: "toko-kopi",
      flows: 0,
      searchPath: "app/build/outputs/apk/debug",
      apk: {
        ok: true,
        value: {
          fileName: "app-debug.apk",
          handPicked: false,
          info: { ok: true, value: { versionName: "2.3.1" } },
        },
      },
    });

    expect(await list.create({ name: "Toko Kopi", apk: "search" })).toEqual({
      ok: true,
      value: { id: "p1" },
    });
    expect(await readdir(join(app, ".jagra"))).toContain("config.yaml");
    expect(await list.list()).toEqual([
      {
        id: "p1",
        folder: app,
        state: "ready",
        name: "Toko Kopi",
        lastRun: undefined,
      },
    ]);
  });

  it("reports a folder without an APK", async () => {
    answers.push(await folder("empty"));
    expect(await projects().pickFolder()).toMatchObject({
      apk: { ok: false, error: { code: "APK_NOT_FOUND" } },
    });
  });

  it("keeps a hand-picked APK as local data (PRJ-4)", async () => {
    const app = await folder("app");
    const apk = join(await folder("elsewhere", { "my.apk": "apk" }), "my.apk");
    const list = projects();
    answers.push(app, apk);
    await list.pickFolder();
    expect(await list.pickApk()).toMatchObject({
      fileName: "my.apk",
      handPicked: true,
    });
    const created = await list.create({ name: "app", apk: "picked" });
    expect(created.ok && (await loadLocal(appData, created.value.id))).toEqual({
      apk,
    });
  });

  it("takes a Mockoon file only from inside the project folder", async () => {
    const app = await folder("app", { ".jagra/mockoon.json": "{}" });
    const outside = join(
      await folder("other", { "mock.json": "{}" }),
      "mock.json",
    );
    const list = projects();
    answers.push(app, outside, join(app, ".jagra", "mockoon.json"));
    await list.pickFolder();
    expect(await list.pickMockoon()).toMatchObject({
      ok: false,
      error: { code: "MOCKOON_FILE_OUTSIDE_PROJECT" },
    });
    expect(await list.pickMockoon()).toEqual({
      ok: true,
      value: ".jagra/mockoon.json",
    });
    await list.create({ name: "app", apk: "search" });
    expect(
      await readFile(join(app, ".jagra", "config.yaml"), "utf8"),
    ).toContain("file: .jagra/mockoon.json");
  });

  it("reads an existing .jagra as it is (the team case)", async () => {
    const flow = "appId: com.shop\n---\n- launchApp\n";
    const config = "format: 1\nname: shop\nmockoon:\n  file: mock.json\n";
    const app = await folder("shop", {
      ".jagra/config.yaml": config,
      ".jagra/flows/a.yaml": flow,
      ".jagra/flows/parts/login.yaml": flow,
    });
    const list = projects();
    answers.push(app);
    expect(await list.pickFolder()).toMatchObject({
      hasConfig: true,
      name: "shop",
      flows: 1,
      helpers: 1,
      mockoonFile: "mock.json",
    });
    await list.create({ name: "shop", apk: "search" });
    expect(await readFile(join(app, ".jagra", "config.yaml"), "utf8")).toBe(
      config,
    );
  });

  it("adds a folder with a broken config.yaml without touching it (PRJ-10)", async () => {
    const app = await folder("broken", {
      ".jagra/config.yaml": "format: 1\nname: [\n",
    });
    const list = projects();
    answers.push(app);
    expect(await list.pickFolder()).toMatchObject({
      configError: { code: "CONFIG_YAML_INVALID" },
      apk: { ok: false },
    });
    expect((await list.create({ name: "other", apk: "search" })).ok).toBe(true);
    expect(await readFile(join(app, ".jagra", "config.yaml"), "utf8")).toBe(
      "format: 1\nname: [\n",
    );
    expect(await list.list()).toMatchObject([
      { state: "broken", error: { code: "CONFIG_YAML_INVALID" } },
    ]);
  });

  it("refuses to create before a folder is picked, and does nothing when a dialog is cancelled", async () => {
    const list = projects();
    await expect(list.create({ name: "x", apk: "search" })).rejects.toThrow();
    expect(await list.pickFolder()).toBeUndefined();
    expect(await list.pickApk()).toBeUndefined();
    expect(await knownProjects(appData)).toEqual([]);
  });
});

describe("the project list (PRJ-7, PRJ-8)", () => {
  async function created(
    list: Projects,
    name: string,
  ): Promise<{ id: string; path: string }> {
    const path = await folder(name);
    answers.push(path);
    await list.pickFolder();
    const result = await list.create({ name, apk: "search" });
    if (!result.ok) throw new Error("not created");
    return { id: result.value.id, path };
  }

  it("shows the last run's result", async () => {
    const list = projects();
    const { id } = await created(list, "shop");
    const flow = (status: "passed" | "failed") => ({
      file: "a.yaml",
      name: "a",
      status,
    });
    await saveRun(join(runsFolder(appData, id), "20261111-100000-000-0001"), {
      id: "20261111-100000-000-0001",
      projectId: id,
      status: "completed",
      startedAt: "2026-11-11T10:00:00.000Z",
      flows: [flow("passed"), flow("passed"), flow("failed")],
    } as unknown as Run);
    expect(await list.list()).toMatchObject([
      {
        lastRun: {
          status: "completed",
          passed: 2,
          failed: 1,
          startedAt: "2026-11-11T10:00:00.000Z",
        },
      },
    ]);
  });

  it("says when a folder is gone, and Locate brings it back under the same id", async () => {
    const list = projects();
    const { id, path } = await created(list, "moving");
    await rm(path, { recursive: true });
    expect(await list.list()).toEqual([{ id, folder: path, state: "missing" }]);

    const moved = await folder("moved", {
      ".jagra/config.yaml": "format: 1\nname: moving\n",
    });
    answers.push(moved);
    expect(await list.locate(id)).toMatchObject({
      id,
      folder: moved,
      state: "ready",
    });
  });

  it("removes a project from the list without deleting any file", async () => {
    const list = projects();
    const { id, path } = await created(list, "keep");
    await list.remove(id);
    expect(await list.list()).toEqual([]);
    expect(await readdir(join(path, ".jagra"))).toContain("config.yaml");
  });

  it("opens config.yaml only for a known project", async () => {
    const list = projects();
    const { id, path } = await created(list, "open");
    await list.openConfig(id);
    await list.openConfig("unknown");
    expect(opened).toEqual([join(path, ".jagra", "config.yaml")]);
  });
});

describe("Try the sample app (SMP-6)", () => {
  it("copies the bundled sample to Documents, adds it, and opens the copy next time", async () => {
    await folder("bundled-sample", {
      ".jagra/config.yaml": "format: 1\nname: Jagra sample app\n",
      "app/build/outputs/apk/debug/app-debug.apk": "apk",
    });
    const list = projects();
    const target = join(documents, "Jagra", "sample-app");
    expect(list.sampleFolder()).toBe(target);

    const first = await list.trySample();
    expect(first).toEqual({ ok: true, value: { id: "p1" } });
    expect(
      await readFile(join(target, ".jagra", "config.yaml"), "utf8"),
    ).toContain("sample");

    // The user's own changes to the copy stay.
    await writeFile(join(target, ".jagra", "agent-rules.md"), "mine");
    await utimes(target, new Date(), new Date());
    expect(await list.trySample()).toEqual(first);
    expect(
      await readFile(join(target, ".jagra", "agent-rules.md"), "utf8"),
    ).toBe("mine");
    expect(await knownProjects(appData)).toHaveLength(1);
  });

  it("reports an app built without the sample", async () => {
    expect(await projects().trySample()).toEqual({
      ok: false,
      error: { code: "SAMPLE_NOT_BUNDLED" },
    });
  });
});
