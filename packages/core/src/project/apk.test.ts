import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAppId, fillAppId, findApk } from "./apk.js";
import { configFile, parseConfig, type ProjectConfig } from "./config.js";

let project: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "jagra-apk-"));
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

function config(text = "format: 1\nappId: dev.jagra.sample\n"): ProjectConfig {
  const parsed = parseConfig(text, "config.yaml", "sample");
  if (!parsed.ok) throw new Error("bad test config");
  return parsed.value;
}

async function apk(path: string, minutesAgo: number): Promise<string> {
  const full = join(project, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, "apk");
  const time = new Date(Date.now() - minutesAgo * 60_000);
  await utimes(full, time, time);
  return full;
}

describe("findApk (PRJ-4)", () => {
  it("takes the newest APK under the search path, in any subfolder", async () => {
    await apk("app/build/outputs/apk/debug/app-debug.apk", 30);
    const newest = await apk(
      "app/build/outputs/apk/debug/free/app-free-debug.apk",
      5,
    );
    await apk("app/build/outputs/apk/debug/older.apk", 60);
    await apk("app/build/outputs/apk/release/app-release.apk", 1);
    await writeFile(
      join(project, "app/build/outputs/apk/debug/output-metadata.json"),
      "{}",
    );

    const found = await findApk(project, config());

    expect(found.ok && found.value.path).toBe(newest);
    expect(found.ok && found.value.handPicked).toBe(false);
  });

  it("uses the search path from config.yaml", async () => {
    const custom = await apk("build/out/app.apk", 10);
    const found = await findApk(
      project,
      config("format: 1\napk:\n  searchPath: build/out\n"),
    );
    expect(found.ok && found.value.path).toBe(custom);
  });

  it("says so when the search path does not exist", async () => {
    expect(await findApk(project, config())).toEqual({
      ok: false,
      error: {
        code: "APK_NOT_FOUND",
        searchPath: "app/build/outputs/apk/debug",
      },
    });
  });

  it("says so when the search path has no APK", async () => {
    await mkdir(join(project, "app/build/outputs/apk/debug"), {
      recursive: true,
    });
    const found = await findApk(project, config());
    expect(found.ok ? undefined : found.error.code).toBe("APK_NOT_FOUND");
  });

  it("prefers a hand-picked APK over a newer one in the search path", async () => {
    const picked = await apk("elsewhere/picked.apk", 120);
    await apk("app/build/outputs/apk/debug/app-debug.apk", 1);
    const found = await findApk(project, config(), picked);
    expect(found.ok && found.value).toMatchObject({
      path: picked,
      handPicked: true,
    });
  });

  it("reports a hand-picked APK that was deleted", async () => {
    const gone = join(project, "gone.apk");
    expect(await findApk(project, config(), gone)).toEqual({
      ok: false,
      error: { code: "FILE_NOT_FOUND", file: gone },
    });
  });
});

describe("checkAppId (PRJ-6)", () => {
  const info = {
    packageName: "dev.jagra.sample",
    versionName: "1.0",
    versionCode: 1,
  };

  it("matches", () => {
    expect(checkAppId(config(), info)).toEqual({ result: "same" });
  });

  it("asks to fill an empty appId", () => {
    expect(checkAppId(config("format: 1\n"), info)).toEqual({
      result: "empty",
      packageName: "dev.jagra.sample",
    });
  });

  it("warns about a different package", () => {
    expect(
      checkAppId(config("format: 1\nappId: com.example.other\n"), info),
    ).toEqual({
      result: "different",
      appId: "com.example.other",
      packageName: "dev.jagra.sample",
    });
  });
});

describe("fillAppId (PRJ-6)", () => {
  async function writeConfig(text: string) {
    await mkdir(join(project, ".jagra"), { recursive: true });
    await writeFile(configFile(project), text);
  }

  it("fills an empty appId and keeps comments and other fields", async () => {
    await writeConfig(
      [
        "format: 1 # format version",
        "name: shop",
        "appId: # filled from the first APK",
        "apk:",
        "  searchPath: app/build/outputs/apk/debug",
        "",
      ].join("\n"),
    );

    expect(await fillAppId(project, "dev.jagra.sample")).toEqual({
      ok: true,
      value: undefined,
    });

    const text = await readFile(configFile(project), "utf8");
    expect(text).toContain("# format version");
    expect(text).toContain("searchPath: app/build/outputs/apk/debug");
    expect(text).toContain("name: shop");
    const parsed = parseConfig(text, "config.yaml", "x");
    expect(parsed.ok && parsed.value.appId).toBe("dev.jagra.sample");
    expect(await readdir(join(project, ".jagra"))).toEqual(["config.yaml"]);
  });

  it("adds appId when the field is missing", async () => {
    await writeConfig("format: 1\n");
    await fillAppId(project, "dev.jagra.sample");
    const parsed = parseConfig(
      await readFile(configFile(project), "utf8"),
      "c",
      "x",
    );
    expect(parsed.ok && parsed.value.appId).toBe("dev.jagra.sample");
  });

  it("never replaces an appId that has a value", async () => {
    await writeConfig("format: 1\nappId: com.example.kept\n");
    await fillAppId(project, "dev.jagra.sample");
    expect(await readFile(configFile(project), "utf8")).toBe(
      "format: 1\nappId: com.example.kept\n",
    );
  });

  it("writes nothing outside .jagra (PRJ-11)", async () => {
    await writeConfig("format: 1\n");
    await fillAppId(project, "dev.jagra.sample");
    expect(await readdir(project)).toEqual([".jagra"]);
  });
});
