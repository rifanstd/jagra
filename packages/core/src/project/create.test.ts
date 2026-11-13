import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { inspectFolder, projectRelative, setUpProject } from "./create.js";

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "jagra-create-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

const jagra = (...parts: string[]) => join(folder, ".jagra", ...parts);

describe("setUpProject (PRJ-1, PRJ-2, PRJ-11)", () => {
  it("creates the starter files in a folder without .jagra, and nothing else", async () => {
    await writeFile(join(folder, "build.gradle.kts"), "// app");
    expect(await setUpProject(folder, { name: "toko kopi: v2" })).toEqual({
      ok: true,
      value: undefined,
    });

    expect((await readdir(folder)).sort()).toEqual([
      ".jagra",
      "build.gradle.kts",
    ]);
    expect((await readdir(jagra())).sort()).toEqual([
      "agent-rules.md",
      "config.yaml",
      "flows",
    ]);
    expect(await readdir(jagra("flows"))).toEqual(["parts"]);
    expect(await readFile(jagra("agent-rules.md"), "utf8")).toBe("");
    expect(await readFile(join(folder, "build.gradle.kts"), "utf8")).toBe(
      "// app",
    );

    expect(await loadConfig(folder)).toMatchObject({
      ok: true,
      value: {
        format: 1,
        name: "toko kopi: v2",
        appId: "",
        apk: { searchPath: "app/build/outputs/apk/debug" },
        run: { flowTimeoutMinutes: 5 },
      },
    });
  });

  it("writes the Mockoon file into a new config.yaml", async () => {
    await setUpProject(folder, {
      name: "shop",
      mockoonFile: ".jagra/mockoon.json",
    });
    expect(await loadConfig(folder)).toMatchObject({
      value: { mockoon: { file: ".jagra/mockoon.json" } },
    });
  });

  it("keeps an existing config.yaml as it is when nothing changes", async () => {
    await mkdir(jagra("flows"), { recursive: true });
    const text = "# team settings\nformat: 1\nname: shop\nappId: com.shop\n";
    await writeFile(jagra("config.yaml"), text);
    await writeFile(jagra("agent-rules.md"), "Use English.");

    await setUpProject(folder, { name: "shop" });
    expect(await readFile(jagra("config.yaml"), "utf8")).toBe(text);
    expect(await readFile(jagra("agent-rules.md"), "utf8")).toBe(
      "Use English.",
    );
    expect(await readdir(jagra("flows"))).toEqual(["parts"]);
  });

  it("changes the name and Mockoon file of an existing config.yaml, keeping comments", async () => {
    await mkdir(jagra(), { recursive: true });
    await writeFile(
      jagra("config.yaml"),
      "# team settings\nformat: 1\nappId: com.shop # the app\n",
    );
    await setUpProject(folder, { name: "Shop", mockoonFile: "mocks/api.json" });
    const text = await readFile(jagra("config.yaml"), "utf8");
    expect(text).toContain("# team settings");
    expect(text).toContain("appId: com.shop # the app");
    expect(await loadConfig(folder)).toMatchObject({
      value: {
        name: "Shop",
        appId: "com.shop",
        mockoon: { file: "mocks/api.json" },
      },
    });
  });

  it.each([
    ["format: 2\nname: future\n", "CONFIG_FORMAT_UNSUPPORTED"],
    ["format: 1\nname: [broken\n", "CONFIG_YAML_INVALID"],
  ])(
    "never touches a config.yaml it cannot read: %j (PRJ-9, PRJ-10)",
    async (text, code) => {
      await mkdir(jagra(), { recursive: true });
      await writeFile(jagra("config.yaml"), text);
      expect(await setUpProject(folder, { name: "other" })).toMatchObject({
        ok: false,
        error: { code },
      });
      expect(await readFile(jagra("config.yaml"), "utf8")).toBe(text);
      expect(await readdir(jagra())).toEqual(["config.yaml"]);
    },
  );

  it("reports a folder it cannot write to", async () => {
    const file = join(folder, "not-a-folder");
    await writeFile(file, "");
    expect(await setUpProject(file, { name: "x" })).toMatchObject({
      ok: false,
      error: { code: "PROJECT_SETUP_FAILED", folder: file },
    });
  });
});

describe("inspectFolder", () => {
  it("describes a folder without .jagra with the folder name and no flows", async () => {
    expect(await inspectFolder(folder)).toMatchObject({
      ok: true,
      value: {
        hasConfig: false,
        config: { ok: true, value: { name: basename(folder) } },
        flows: 0,
        helpers: 0,
      },
    });
  });

  it("counts the flows and helper flows of an existing project", async () => {
    await mkdir(jagra("flows", "parts"), { recursive: true });
    await writeFile(jagra("config.yaml"), "format: 1\nname: shop\n");
    const flow = "appId: com.shop\n---\n- launchApp\n";
    await writeFile(jagra("flows", "a.yaml"), flow);
    await writeFile(jagra("flows", "b.yaml"), flow);
    await writeFile(jagra("flows", "parts", "login.yaml"), flow);
    expect(await inspectFolder(folder)).toMatchObject({
      ok: true,
      value: {
        hasConfig: true,
        config: { ok: true, value: { name: "shop" } },
        flows: 2,
        helpers: 1,
      },
    });
  });

  it("returns the problem of a config.yaml it cannot read", async () => {
    await mkdir(jagra(), { recursive: true });
    await writeFile(jagra("config.yaml"), "name: no format\n");
    expect(await inspectFolder(folder)).toMatchObject({
      ok: true,
      value: {
        hasConfig: true,
        config: { ok: false, error: { code: "CONFIG_FORMAT_MISSING" } },
      },
    });
  });

  it("refuses something that is not a folder", async () => {
    expect(await inspectFolder(join(folder, "nope"))).toMatchObject({
      ok: false,
      error: { code: "FILE_NOT_FOUND" },
    });
  });
});

describe("projectRelative", () => {
  it("gives a path inside the project with /", () => {
    expect(
      projectRelative(folder, join(folder, ".jagra", "mockoon.json")),
    ).toEqual({
      ok: true,
      value: ".jagra/mockoon.json",
    });
  });

  it.each([
    ["a file outside", (f: string) => join(f, "..", "other.json")],
    ["the folder itself", (f: string) => f],
  ])("refuses %s", (_name, path) => {
    expect(projectRelative(folder, path(folder))).toMatchObject({
      ok: false,
      error: { code: "MOCKOON_FILE_OUTSIDE_PROJECT" },
    });
  });
});
