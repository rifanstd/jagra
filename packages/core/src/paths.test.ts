import { describe, expect, it } from "vitest";
import { activeProcessesFile, appDataFolder, logsFolder } from "./paths.js";

describe("appDataFolder", () => {
  it("uses the local profile on Windows", () => {
    expect(
      appDataFolder(
        "win32",
        { LOCALAPPDATA: "C:\\Users\\rifan\\AppData\\Local" },
        "C:\\Users\\rifan",
      ),
    ).toBe("C:\\Users\\rifan\\AppData\\Local\\jagra");
  });

  it("falls back to the home folder on Windows when LOCALAPPDATA is not set", () => {
    expect(appDataFolder("win32", {}, "C:\\Users\\rifan")).toBe(
      "C:\\Users\\rifan\\AppData\\Local\\jagra",
    );
  });

  it("uses Application Support on macOS", () => {
    expect(appDataFolder("darwin", {}, "/Users/rifan")).toBe(
      "/Users/rifan/Library/Application Support/jagra",
    );
  });

  it("uses ~/.config on Linux, or XDG_CONFIG_HOME when set", () => {
    expect(appDataFolder("linux", {}, "/home/ci")).toBe(
      "/home/ci/.config/jagra",
    );
    expect(
      appDataFolder("linux", { XDG_CONFIG_HOME: "/xdg" }, "/home/ci"),
    ).toBe("/xdg/jagra");
  });
});

describe("files inside the data folder", () => {
  it("follow the layout in architecture.md section 4", () => {
    expect(activeProcessesFile("/data/jagra")).toBe(
      "/data/jagra/state/active.json",
    );
    expect(logsFolder("C:\\data\\jagra")).toBe("C:\\data\\jagra\\logs");
  });
});
