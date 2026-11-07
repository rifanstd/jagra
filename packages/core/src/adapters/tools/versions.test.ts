import { describe, expect, it } from "vitest";
import type { OutputLine } from "../../ports/process-runner.js";
import { readVersion } from "./versions.js";

const out = (...text: string[]): OutputLine[] =>
  text.map((t) => ({ stream: "stdout", text: t }));
const err = (...text: string[]): OutputLine[] =>
  text.map((t) => ({ stream: "stderr", text: t }));

// Samples are real output, recorded on Windows 11 on 2026-11-07.
describe("readVersion", () => {
  it("reads Java from stderr, Oracle and OpenJDK alike", () => {
    expect(
      readVersion(
        "java",
        err(
          'java version "17.0.12" 2024-07-16 LTS',
          "Java(TM) SE Runtime Environment (build 17.0.12+8-LTS-286)",
        ),
      ),
    ).toBe("17.0.12");
    expect(
      readVersion("java", err('openjdk version "21.0.2" 2024-01-16')),
    ).toBe("21.0.2");
    expect(readVersion("java", err('java version "1.8.0_392"'))).toBe(
      "1.8.0_392",
    );
  });

  it("reads adb's platform tools version, not the protocol version", () => {
    expect(
      readVersion(
        "adb",
        out(
          "Android Debug Bridge version 1.0.41",
          "Version 37.0.0-14910828",
          "Installed as C:\\sdk\\platform-tools\\adb.exe",
        ),
      ),
    ).toBe("37.0.0");
  });

  it("reads the emulator version", () => {
    expect(
      readVersion(
        "emulator",
        out(
          "Android emulator version 36.5.11.0 (build_id 15261927) (CL:N/A)",
          "Copyright (C) 2006-2024 The Android Open Source Project and many others.",
        ),
      ),
    ).toBe("36.5.11.0");
  });

  it("reads Maestro's bare version line, past any notice", () => {
    expect(
      readVersion(
        "maestro",
        out(
          "Anonymous analytics enabled. To opt out, set MAESTRO_CLI_NO_ANALYTICS environment variable to any value before running Maestro.",
          "",
          "2.12.1\r",
        ),
      ),
    ).toBe("2.12.1");
  });

  it("reads Mockoon CLI's oclif version line", () => {
    expect(
      readVersion(
        "mockoon",
        out("@mockoon/cli/9.10.0 win32-x64 node-v24.22.1"),
      ),
    ).toBe("9.10.0");
  });

  it("finds nothing in unrelated output", () => {
    expect(
      readVersion("maestro", out("ERROR: Java 17 or higher is required.")),
    ).toBe(undefined);
  });
});
