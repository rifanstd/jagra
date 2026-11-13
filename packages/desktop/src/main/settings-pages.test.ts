import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  fail,
  ok,
  type JagraError,
  type ProcessSpec,
  type Result,
} from "@jagra/core";
import { FakeSecretStore } from "@jagra/core/fakes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bugInfo } from "./bug-info.js";
import { openFile } from "./open-file.js";
import { secretNames } from "./secret-names.js";
import { SettingsFile, settingsSchema } from "./settings.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jagra-settings-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

describe("secretNames (FLOW-7)", () => {
  it("lists every variable of flows and helpers, with stored ones no flow uses", async () => {
    const head = "appId: com.shop\n---\n";
    await write(
      join(dir, ".jagra/flows/login.yaml"),
      `${head}- inputText: \${PASSWORD}\n- runFlow: parts/x.yaml\n`,
    );
    await write(
      join(dir, ".jagra/flows/parts/x.yaml"),
      `${head}- inputText: \${API_TOKEN}\n- inputText: \${MAESTRO_FILENAME}\n`,
    );
    const store = new FakeSecretStore();
    await store.set("p1", "API_TOKEN", "secret-value");
    await store.set("p1", "OLD", "x");
    expect(await secretNames(dir, "p1", store)).toEqual([
      { name: "API_TOKEN", hasValue: true, used: true },
      { name: "OLD", hasValue: true, used: false },
      { name: "PASSWORD", hasValue: false, used: true },
    ]);
  });
});

describe("bugInfo (REL-7)", () => {
  it("has the version, system, tool versions without paths, and the end of the log", async () => {
    const log = join(dir, "jagra.log");
    await writeFile(log, `${"x".repeat(30_000)}\nfirst kept line\nlast line\n`);
    const text = await bugInfo({
      version: "0.1.0",
      system: "Windows_NT 10.0.26200 (x64)",
      electron: "45.2.3",
      tools: [
        {
          tool: "maestro",
          required: true,
          state: "ready",
          version: "2.12.1",
          path: "C:\\Users\\rifan\\maestro",
        },
        { tool: "mockoon", required: false, state: "missing" },
      ],
      logFile: log,
    });
    expect(text).toContain("Jagra 0.1.0");
    expect(text).toContain("- maestro: 2.12.1 (ready)");
    expect(text).toContain("- mockoon: - (missing)");
    expect(text).not.toContain("rifan");
    expect(text).toContain("last line");
    expect(text.length).toBeLessThan(21_000);
  });

  it("says when there is no log yet", async () => {
    const text = await bugInfo({
      version: "0.1.0",
      system: "x",
      electron: "y",
      tools: [],
      logFile: join(dir, "none.log"),
    });
    expect(text).toContain("(no log yet)");
    expect(text).toContain("- not checked yet");
  });
});

describe("openFile (FLOW-5)", () => {
  function setup(launchResult: Result<void, JagraError> = ok(undefined)) {
    const launched: Omit<ProcessSpec, "signal" | "output">[] = [];
    const opened: string[] = [];
    const problems: string[] = [];
    return {
      launched,
      opened,
      problems,
      options: (editor: string | undefined, platform: NodeJS.Platform) => ({
        editor,
        platform,
        launch: (spec: Omit<ProcessSpec, "signal" | "output">) => {
          launched.push(spec);
          return Promise.resolve(launchResult);
        },
        openPath: (path: string) => {
          opened.push(path);
          return Promise.resolve();
        },
        onProblem: (error: { code: string }) => problems.push(error.code),
      }),
    };
  }

  it("uses the system's default app without an editor", async () => {
    const s = setup();
    await openFile("/p/a.yaml", s.options(undefined, "win32"));
    expect(s.opened).toEqual(["/p/a.yaml"]);
    expect(s.launched).toEqual([]);
  });

  it("starts the chosen program with the file, and a macOS app through open -a", async () => {
    const s = setup();
    await openFile("C:\\p\\a.yaml", s.options("C:\\Code\\Code.exe", "win32"));
    await openFile(
      "/p/a.yaml",
      s.options("/Applications/Visual Studio Code.app", "darwin"),
    );
    expect(s.launched).toEqual([
      { program: "C:\\Code\\Code.exe", args: ["C:\\p\\a.yaml"] },
      {
        program: "/usr/bin/open",
        args: ["-a", "/Applications/Visual Studio Code.app", "/p/a.yaml"],
      },
    ]);
    expect(s.opened).toEqual([]);
  });

  it("falls back to the default app when the editor cannot start", async () => {
    const s = setup(
      fail({
        code: "PROGRAM_IS_SCRIPT",
        program: "code",
        path: "C:\\code.cmd",
      }),
    );
    await openFile("C:\\p\\a.yaml", s.options("C:\\code.cmd", "win32"));
    expect(s.problems).toEqual(["PROGRAM_IS_SCRIPT"]);
    expect(s.opened).toEqual(["C:\\p\\a.yaml"]);
  });
});

describe("settings (ENV-6, FLOW-5, SEC-6)", () => {
  it("keeps tool paths and the editor, which the page itself can never set", async () => {
    const file = new SettingsFile(dir, () => ["en-US"]);
    await file.update({
      toolPaths: { maestro: "D:\\tools\\maestro.bat" },
      editor: "C:\\Code.exe",
    });
    expect((await file.view()).settings).toEqual({
      toolPaths: { maestro: "D:\\tools\\maestro.bat" },
      editor: "C:\\Code.exe",
    });
    expect(settingsSchema.safeParse({ editor: "cmd.exe" }).success).toBe(false);
    expect(settingsSchema.safeParse({ toolPaths: { adb: "x" } }).success).toBe(
      false,
    );
  });
});
