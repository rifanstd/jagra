import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsFile, systemLanguage } from "./settings.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jagra-settings-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("systemLanguage (LNG-1)", () => {
  it.each([
    [["id-ID", "en-US"], "id"],
    [["id"], "id"],
    [["in-ID"], "id"],
    [["en-US", "id-ID"], "en"],
    [["ja-JP"], "en"],
    [["ind"], "en"],
    [[], "en"],
  ])("%j gives %s", (preferred, language) => {
    expect(systemLanguage(preferred)).toBe(language);
  });
});

describe("SettingsFile", () => {
  it("follows the operating system until the user chooses, and keeps the choice", async () => {
    const settings = new SettingsFile(dir, () => ["id-ID"]);
    expect(await settings.view()).toEqual({ settings: {}, language: "id" });

    expect(await settings.update({ language: "en" })).toEqual({
      settings: { language: "en" },
      language: "en",
    });
    expect(await new SettingsFile(dir, () => ["id-ID"]).view()).toEqual({
      settings: { language: "en" },
      language: "en",
    });
    expect(
      JSON.parse(await readFile(join(dir, "settings.json"), "utf8")),
    ).toEqual({
      language: "en",
    });
  });

  it("goes back to the system language when the choice is cleared", async () => {
    const settings = new SettingsFile(dir, () => ["id-ID"]);
    await settings.update({ language: "en" });
    expect((await settings.update({ language: undefined })).language).toBe(
      "id",
    );
  });

  it("uses the defaults when settings.json is broken (REL-6)", async () => {
    await writeFile(join(dir, "settings.json"), "{ broken");
    expect(await new SettingsFile(dir, () => ["en-US"]).view()).toEqual({
      settings: {},
      language: "en",
    });
    await writeFile(
      join(dir, "settings.json"),
      JSON.stringify({ language: "fr" }),
    );
    expect(
      (await new SettingsFile(dir, () => ["en-US"]).view()).settings,
    ).toEqual({});
  });
});
