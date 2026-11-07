import { describe, expect, it } from "vitest";
import { FakeToolFiles } from "../../fakes/tool-files.js";
import { MAESTRO_ENV, maestroLaunch, mockoonLaunch } from "./launch.js";
import type { Machine } from "./locate.js";

const PACKAGE = JSON.stringify({ bin: { "mockoon-cli": "./bin/run.js" } });

function windows(files: FakeToolFiles): Machine {
  return {
    platform: "win32",
    env: { Path: "C:\\Program Files\\nodejs;C:\\javapath" },
    home: "C:\\Users\\dev",
    files,
  };
}

function mac(files: FakeToolFiles): Machine {
  return {
    platform: "darwin",
    env: { PATH: "/usr/bin" },
    home: "/Users/dev",
    files,
  };
}

describe("maestroLaunch (D-34)", () => {
  it("runs Java with Maestro's jars on Windows, as maestro.bat does", () => {
    const files = new FakeToolFiles()
      .folder("C:\\maestro\\lib")
      .file("C:\\javapath\\java.exe");

    const launch = maestroLaunch(
      "C:\\maestro\\bin\\maestro.bat",
      ["--version"],
      {},
      windows(files),
    );

    expect(launch).toEqual({
      ok: true,
      spec: {
        program: "C:\\javapath\\java.exe",
        args: [
          "--enable-native-access=ALL-UNNAMED",
          "-classpath",
          "C:\\maestro\\lib\\*",
          "maestro.cli.AppKt",
          "--version",
        ],
        env: MAESTRO_ENV,
      },
    });
  });

  it("uses the hand-set Java", () => {
    const files = new FakeToolFiles()
      .folder("C:\\maestro\\lib")
      .file("C:\\javapath\\java.exe")
      .file("D:\\jdk\\bin\\java.exe");

    const launch = maestroLaunch(
      "C:\\maestro\\bin\\maestro.bat",
      [],
      { java: "D:\\jdk\\bin\\java.exe" },
      windows(files),
    );

    expect(launch.ok && launch.spec.program).toBe("D:\\jdk\\bin\\java.exe");
  });

  it("needs Java on Windows", () => {
    const files = new FakeToolFiles().folder("C:\\maestro\\lib");
    expect(
      maestroLaunch("C:\\maestro\\bin\\maestro.bat", [], {}, windows(files)),
    ).toEqual({ ok: false, problem: "needs-java" });
  });

  it("cannot start without the lib folder next to bin", () => {
    const files = new FakeToolFiles().file("C:\\javapath\\java.exe");
    const launch = maestroLaunch(
      "C:\\maestro\\bin\\maestro.bat",
      [],
      {},
      windows(files),
    );
    expect(launch.ok).toBe(false);
    expect(!launch.ok && launch.problem).toBe("failed");
  });

  it("starts the script directly on macOS, passing a hand-set Java as JAVA_HOME", () => {
    const files = new FakeToolFiles().file("/opt/jdk/bin/java");

    expect(
      maestroLaunch(
        "/Users/dev/.maestro/bin/maestro",
        ["test"],
        {},
        mac(files),
      ),
    ).toEqual({
      ok: true,
      spec: {
        program: "/Users/dev/.maestro/bin/maestro",
        args: ["test"],
        env: MAESTRO_ENV,
      },
    });
    const custom = maestroLaunch(
      "/Users/dev/.maestro/bin/maestro",
      [],
      { java: "/opt/jdk/bin/java" },
      mac(files),
    );
    expect(custom.ok && custom.spec.env).toEqual({
      ...MAESTRO_ENV,
      JAVA_HOME: "/opt/jdk",
    });
  });

  it("turns analytics, the update check and the AI notice off", () => {
    expect(MAESTRO_ENV).toEqual({
      MAESTRO_CLI_NO_ANALYTICS: "1",
      MAESTRO_DISABLE_UPDATE_CHECK: "true",
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
    });
  });
});

describe("mockoonLaunch (D-34)", () => {
  it("runs Node with the entry named in the package's bin field on Windows", () => {
    const files = new FakeToolFiles()
      .file("C:\\npm\\node_modules\\@mockoon\\cli\\package.json", PACKAGE)
      .file("C:\\Program Files\\nodejs\\node.exe");

    expect(
      mockoonLaunch("C:\\npm\\mockoon-cli.cmd", ["--version"], windows(files)),
    ).toEqual({
      ok: true,
      spec: {
        program: "C:\\Program Files\\nodejs\\node.exe",
        args: [
          "C:\\npm\\node_modules\\@mockoon\\cli\\bin\\run.js",
          "--version",
        ],
      },
    });
  });

  it("prefers a node.exe next to the shim, as npm's shim does", () => {
    const files = new FakeToolFiles()
      .file("C:\\npm\\node_modules\\@mockoon\\cli\\package.json", PACKAGE)
      .file("C:\\npm\\node.exe")
      .file("C:\\Program Files\\nodejs\\node.exe");

    const launch = mockoonLaunch(
      "C:\\npm\\mockoon-cli.cmd",
      [],
      windows(files),
    );
    expect(launch.ok && launch.spec.program).toBe("C:\\npm\\node.exe");
  });

  it("needs Node", () => {
    const files = new FakeToolFiles().file(
      "C:\\npm\\node_modules\\@mockoon\\cli\\package.json",
      PACKAGE,
    );
    expect(
      mockoonLaunch("C:\\npm\\mockoon-cli.cmd", [], windows(files)),
    ).toEqual({ ok: false, problem: "needs-node" });
  });

  it("cannot start when the package is missing or broken", () => {
    const broken = new FakeToolFiles()
      .file("C:\\npm\\node_modules\\@mockoon\\cli\\package.json", "{")
      .file("C:\\Program Files\\nodejs\\node.exe");
    expect(
      mockoonLaunch("C:\\npm\\mockoon-cli.cmd", [], windows(broken)).ok,
    ).toBe(false);
    expect(
      mockoonLaunch(
        "C:\\npm\\mockoon-cli.cmd",
        [],
        windows(new FakeToolFiles()),
      ).ok,
    ).toBe(false);
  });

  it("follows the npm link to the entry on macOS", () => {
    const files = new FakeToolFiles()
      .link(
        "/opt/homebrew/bin/mockoon-cli",
        "/opt/homebrew/lib/node_modules/@mockoon/cli/bin/run.js",
      )
      .file("/opt/homebrew/bin/node");

    expect(
      mockoonLaunch("/opt/homebrew/bin/mockoon-cli", ["--version"], mac(files)),
    ).toEqual({
      ok: true,
      spec: {
        program: "/opt/homebrew/bin/node",
        args: [
          "/opt/homebrew/lib/node_modules/@mockoon/cli/bin/run.js",
          "--version",
        ],
      },
    });
  });
});
