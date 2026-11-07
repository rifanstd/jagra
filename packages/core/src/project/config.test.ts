import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configFile, loadConfig, parseConfig } from "./config.js";

const FILE = "/repo/.jagra/config.yaml";
const parse = (text: string) => parseConfig(text, FILE, "aplikasi-a");

describe("parseConfig", () => {
  it("reads the example from the spec", () => {
    const result = parse(`
format: 1
name: aplikasi-a
appId: com.company.appa
apk:
  searchPath: app/build/outputs/apk/debug
mockoon:
  file: .jagra/mockoon.json
  port: 3000
run:
  flowTimeoutMinutes: 5
`);
    expect(result).toEqual({
      ok: true,
      value: {
        format: 1,
        name: "aplikasi-a",
        appId: "com.company.appa",
        apk: { searchPath: "app/build/outputs/apk/debug" },
        mockoon: { file: ".jagra/mockoon.json", port: 3000 },
        run: { flowTimeoutMinutes: 5 },
      },
    });
  });

  it("fills every default when only format is given", () => {
    expect(parse("format: 1\n")).toEqual({
      ok: true,
      value: {
        format: 1,
        name: "aplikasi-a",
        appId: "",
        apk: { searchPath: "app/build/outputs/apk/debug" },
        mockoon: undefined,
        run: { flowTimeoutMinutes: 5 },
      },
    });
  });

  it("allows an empty appId until the first APK is read (PRJ-6)", () => {
    const result = parse("format: 1\nappId:\n");
    expect(result.ok && result.value.appId).toBe("");
  });

  it("keeps unknown fields, at the top and inside blocks", () => {
    const result = parse("format: 1\nfutureField: true\nrun:\n  retries: 2\n");
    expect(result.ok && result.value).toMatchObject({
      futureField: true,
      run: { retries: 2, flowTimeoutMinutes: 5 },
    });
  });

  it("treats a mockoon key with no value as no Mockoon", () => {
    const result = parse("format: 1\nmockoon:\n");
    expect(result.ok && result.value.mockoon).toBeUndefined();
  });

  describe("format (PRJ-9)", () => {
    it("is required", () => {
      expect(parse("name: x\n")).toEqual({
        ok: false,
        error: { code: "CONFIG_FORMAT_MISSING", file: FILE },
      });
    });

    it("refuses a newer format before looking at any other field", () => {
      expect(parse("format: 2\nrun: not-a-block\n")).toEqual({
        ok: false,
        error: {
          code: "CONFIG_FORMAT_UNSUPPORTED",
          file: FILE,
          found: 2,
          supported: 1,
        },
      });
    });

    it("must be a number", () => {
      const result = parse('format: "1"\n');
      expect(result.ok ? null : result.error).toMatchObject({
        code: "CONFIG_FIELD_INVALID",
        field: "format",
        line: 1,
      });
    });
  });

  describe("errors point at the file and line (PRJ-10)", () => {
    it("for broken YAML", () => {
      const result = parse("format: 1\nname: a: b\nappId: x\n");
      expect(result.ok ? null : result.error).toMatchObject({
        code: "CONFIG_YAML_INVALID",
        file: FILE,
        line: 2,
      });
    });

    it("for a duplicate key", () => {
      const result = parse("format: 1\nname: a\nname: b\n");
      expect(result.ok ? null : result.error).toMatchObject({
        code: "CONFIG_YAML_INVALID",
        line: 3,
      });
    });

    it("for a field of the wrong type", () => {
      const result = parse("format: 1\nrun:\n  flowTimeoutMinutes: five\n");
      expect(result.ok ? null : result.error).toMatchObject({
        code: "CONFIG_FIELD_INVALID",
        field: "run.flowTimeoutMinutes",
        line: 3,
        column: 23,
      });
    });

    it("for a missing required field, at its block", () => {
      const result = parse("format: 1\nmockoon:\n  port: 3000\n");
      expect(result.ok ? null : result.error).toMatchObject({
        code: "CONFIG_FIELD_INVALID",
        field: "mockoon.file",
        line: 3,
      });
    });

    it("for a port out of range", () => {
      const result = parse(
        "format: 1\nmockoon:\n  file: m.json\n  port: 70000\n",
      );
      expect(result.ok ? null : result.error).toMatchObject({
        field: "mockoon.port",
        line: 4,
      });
    });

    it("for a file that is not a map", () => {
      expect(parse("- format: 1\n")).toEqual({
        ok: false,
        error: { code: "CONFIG_NOT_A_MAP", file: FILE },
      });
    });
  });
});

describe("loadConfig", () => {
  it("reads .jagra/config.yaml and defaults the name to the folder name (PRJ-2)", async () => {
    const root = await mkdtemp(join(tmpdir(), "jagra-config-"));
    try {
      const folder = join(root, "shop-app");
      await mkdir(join(folder, ".jagra"), { recursive: true });
      await writeFile(configFile(folder), "format: 1\n");
      const result = await loadConfig(folder);
      expect(result.ok && result.value.name).toBe("shop-app");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a missing file", async () => {
    const result = await loadConfig(join(tmpdir(), "jagra-no-such-project"));
    expect(result.ok ? null : result.error.code).toBe("FILE_NOT_FOUND");
  });
});
