import { describe, expect, it } from "vitest";
import { FakeProcessRunner } from "../../fakes/process-runner.js";
import {
  freshWindowsEnvironment,
  mergeEnvironment,
  parseRegQuery,
} from "./windows-environment.js";

const REG = "C:\\Windows\\System32\\reg.exe";

describe("parseRegQuery", () => {
  it("reads string values and skips the key line and other types", () => {
    const values = parseRegQuery([
      "",
      "HKEY_CURRENT_USER\\Environment",
      "    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\npm",
      "    JAVA_HOME    REG_SZ    C:\\jdk-21",
      "    Count    REG_DWORD    0x1",
      "",
    ]);
    expect([...values]).toEqual([
      ["Path", { value: "%USERPROFILE%\\bin;C:\\npm", expand: true }],
      ["JAVA_HOME", { value: "C:\\jdk-21", expand: false }],
    ]);
  });
});

describe("mergeEnvironment", () => {
  const base = {
    Path: "C:\\stale",
    USERPROFILE: "C:\\Users\\dev",
    SystemRoot: "C:\\Windows",
  };

  it("builds PATH as machine then user, expanding %NAME%", () => {
    const env = mergeEnvironment(
      base,
      new Map([["Path", { value: "%SystemRoot%\\system32", expand: true }]]),
      new Map([["PATH", { value: "%USERPROFILE%\\bin", expand: true }]]),
    );
    expect(env.Path).toBe("C:\\Windows\\system32;C:\\Users\\dev\\bin");
    expect(Object.keys(env).filter((k) => k.toUpperCase() === "PATH")).toEqual([
      "Path",
    ]);
  });

  it("lets user values win and picks up variables set after Jagra started", () => {
    const env = mergeEnvironment(
      { ...base, java_home: "C:\\old" },
      new Map([["JAVA_HOME", { value: "C:\\jdk-17", expand: false }]]),
      new Map([
        ["JAVA_HOME", { value: "C:\\jdk-21", expand: false }],
        ["ANDROID_HOME", { value: "C:\\sdk", expand: false }],
      ]),
    );
    expect(env.JAVA_HOME).toBe("C:\\jdk-21");
    expect(env.java_home).toBeUndefined();
    expect(env.ANDROID_HOME).toBe("C:\\sdk");
  });

  it("leaves unknown %NAME% as written, as Windows does", () => {
    const env = mergeEnvironment(
      base,
      new Map(),
      new Map([["Path", { value: "%NOPE%\\bin", expand: true }]]),
    );
    expect(env.Path).toBe("%NOPE%\\bin");
  });
});

describe("freshWindowsEnvironment", () => {
  it("asks reg.exe for both keys, without a shell", async () => {
    const runner = new FakeProcessRunner();
    runner.define(REG, {
      lines: [
        {
          stream: "stdout",
          text: "    Path    REG_EXPAND_SZ    C:\\maestro\\bin",
        },
      ],
      exit: { code: 0, signal: null },
    });

    const env = await freshWindowsEnvironment(runner, {
      SystemRoot: "C:\\Windows",
      Path: "C:\\stale",
    });

    expect(runner.calls.map((c) => c.args)).toEqual([
      [
        "query",
        "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
      ],
      ["query", "HKCU\\Environment"],
    ]);
    expect(env.Path).toBe("C:\\maestro\\bin;C:\\maestro\\bin");
  });

  it("keeps the starting environment when reg.exe cannot run", async () => {
    const env = await freshWindowsEnvironment(new FakeProcessRunner(), {
      SystemRoot: "C:\\Windows",
      Path: "C:\\stale",
    });
    expect(env.Path).toBe("C:\\stale");
  });
});
