import { describe, expect, it } from "vitest";
import { FakeToolFiles } from "../../fakes/tool-files.js";
import { locateTool, type Machine } from "./locate.js";

function windows(files: FakeToolFiles, env: NodeJS.ProcessEnv = {}): Machine {
  return {
    platform: "win32",
    env: { Path: "C:\\scrcpy;C:\\maestro\\bin;C:\\npm", ...env },
    home: "C:\\Users\\dev",
    files,
  };
}

function mac(files: FakeToolFiles, env: NodeJS.ProcessEnv = {}): Machine {
  return {
    platform: "darwin",
    env: { PATH: "/usr/bin:/bin", ...env },
    home: "/Users/dev",
    files,
  };
}

describe("locateTool", () => {
  it("uses the hand-set path first, and reports nothing when that file is gone (ENV-6)", () => {
    const files = new FakeToolFiles()
      .file("C:\\maestro\\bin\\maestro.bat")
      .file("D:\\custom\\maestro.bat");
    const machine = windows(files);

    expect(
      locateTool("maestro", { maestro: "D:\\custom\\maestro.bat" }, machine),
    ).toBe("D:\\custom\\maestro.bat");
    expect(
      locateTool("maestro", { maestro: "D:\\gone\\maestro.bat" }, machine),
    ).toBeUndefined();
  });

  it("finds Java in JAVA_HOME before PATH, like Maestro's launcher", () => {
    const files = new FakeToolFiles()
      .file("C:\\jdk-21\\bin\\java.exe")
      .file("C:\\scrcpy\\java.exe");
    expect(
      locateTool("java", {}, windows(files, { JAVA_HOME: "C:\\jdk-21" })),
    ).toBe("C:\\jdk-21\\bin\\java.exe");
    expect(locateTool("java", {}, windows(files))).toBe("C:\\scrcpy\\java.exe");
  });

  it("prefers the SDK's adb over another adb on PATH", () => {
    const files = new FakeToolFiles()
      .file("C:\\scrcpy\\adb.exe")
      .file("C:\\sdk\\platform-tools\\adb.exe");
    expect(
      locateTool("adb", {}, windows(files, { ANDROID_HOME: "C:\\sdk" })),
    ).toBe("C:\\sdk\\platform-tools\\adb.exe");
    expect(locateTool("adb", {}, windows(files))).toBe("C:\\scrcpy\\adb.exe");
  });

  it("prefers the default SDK folder over another adb on PATH when ANDROID_HOME is not set (D-66)", () => {
    const files = new FakeToolFiles()
      .file("C:\\scrcpy\\adb.exe")
      .file(
        "C:\\Users\\dev\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe",
      );
    expect(locateTool("adb", {}, windows(files))).toBe(
      "C:\\Users\\dev\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe",
    );
  });

  it("falls back to the default SDK folder and the deprecated ANDROID_SDK_ROOT", () => {
    const files = new FakeToolFiles()
      .file(
        "C:\\Users\\dev\\AppData\\Local\\Android\\Sdk\\emulator\\emulator.exe",
      )
      .file("/opt/sdk/emulator/emulator");
    expect(locateTool("emulator", {}, windows(files))).toBe(
      "C:\\Users\\dev\\AppData\\Local\\Android\\Sdk\\emulator\\emulator.exe",
    );
    expect(
      locateTool("emulator", {}, mac(files, { ANDROID_SDK_ROOT: "/opt/sdk" })),
    ).toBe("/opt/sdk/emulator/emulator");
  });

  it("reads variable names without case on Windows", () => {
    const files = new FakeToolFiles().file("C:\\jdk\\bin\\java.exe");
    expect(
      locateTool("java", {}, windows(files, { java_home: "C:\\jdk" })),
    ).toBe("C:\\jdk\\bin\\java.exe");
  });

  it("looks for maestro.bat and mockoon-cli.cmd on Windows", () => {
    const files = new FakeToolFiles()
      .file("C:\\maestro\\bin\\maestro")
      .file("C:\\maestro\\bin\\maestro.bat")
      .file("C:\\npm\\mockoon-cli")
      .file("C:\\npm\\mockoon-cli.cmd");
    expect(locateTool("maestro", {}, windows(files))).toBe(
      "C:\\maestro\\bin\\maestro.bat",
    );
    expect(locateTool("mockoon", {}, windows(files))).toBe(
      "C:\\npm\\mockoon-cli.cmd",
    );
  });

  it("finds tools a Finder-opened macOS app cannot see on its short PATH", () => {
    const files = new FakeToolFiles()
      .file("/Users/dev/.maestro/bin/maestro")
      .file("/opt/homebrew/bin/mockoon-cli");
    expect(locateTool("maestro", {}, mac(files))).toBe(
      "/Users/dev/.maestro/bin/maestro",
    );
    expect(locateTool("mockoon", {}, mac(files))).toBe(
      "/opt/homebrew/bin/mockoon-cli",
    );
  });

  it("reports nothing when a tool is nowhere", () => {
    expect(locateTool("maestro", {}, mac(new FakeToolFiles()))).toBeUndefined();
  });
});
