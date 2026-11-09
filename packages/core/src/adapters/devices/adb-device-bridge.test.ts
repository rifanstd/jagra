import { describe, expect, it, vi } from "vitest";
import { FakeClock } from "../../fakes/clock.js";
import {
  FakeProcessRunner,
  type FakeProgram,
} from "../../fakes/process-runner.js";
import type { Device } from "../../types/index.js";
import { AdbDeviceBridge } from "./adb-device-bridge.js";

const ADB = "/sdk/platform-tools/adb";
const EMULATOR = "/sdk/emulator/emulator";

const out = (...text: string[]): FakeProgram => ({
  lines: text.map((t) => ({ stream: "stdout", text: t })),
  exit: { code: 0, signal: null },
});
const err = (code: number, ...text: string[]): FakeProgram => ({
  lines: text.map((t) => ({ stream: "stderr", text: t })),
  exit: { code, signal: null },
});

/** Answers `adb` calls by their arguments, without the `-s <serial>` part. */
function setup(
  answers: Record<string, FakeProgram>,
  options: { emulator?: boolean; avds?: string[]; timeoutMs?: number } = {},
) {
  const runner = new FakeProcessRunner();
  runner.define(ADB, (args) => {
    const key = (args[0] === "-s" ? args.slice(2) : args).join(" ");
    return answers[key] ?? err(1, `no answer for: ${key}`);
  });
  runner.define(EMULATOR, (args) =>
    args[0] === "-list-avds" ? out(...(options.avds ?? []), "") : out(),
  );
  const clock = new FakeClock();
  const bridge = new AdbDeviceBridge({
    runner,
    clock,
    adb: ADB,
    emulator: options.emulator === false ? undefined : EMULATOR,
    timeoutMs: options.timeoutMs,
  });
  return { runner, clock, bridge };
}

const adbCalls = (runner: FakeProcessRunner) =>
  runner.calls.filter((c) => c.program === ADB).map((c) => c.args.join(" "));

describe("AdbDeviceBridge.list (DEV-1)", () => {
  const devices = out(
    "List of devices attached",
    "emulator-5554          device product:sdk_gphone64 model:sdk_gphone64 transport_id:8",
    "R58N12ABCDE            device usb:1-1 model:SM_A525F transport_id:3",
    "9B021FFAZ001K4         unauthorized usb:1-2 transport_id:4",
    "",
  );

  it("merges running devices with the emulators that are off", async () => {
    const { bridge } = setup(
      { "devices -l": devices, "emu avd name": out("Pixel_8", "OK") },
      { avds: ["Pixel_8", "Small_Phone_API_24"] },
    );
    expect(await bridge.list()).toEqual({
      ok: true,
      value: [
        {
          id: "emulator-5554",
          kind: "emulator",
          state: "emulator-running",
          name: "Pixel_8",
        },
        {
          id: "R58N12ABCDE",
          kind: "phone",
          state: "phone-ready",
          name: "SM A525F",
        },
        {
          id: "9B021FFAZ001K4",
          kind: "phone",
          state: "phone-not-authorised",
          name: "9B021FFAZ001K4",
        },
        {
          id: "avd:Small_Phone_API_24",
          kind: "emulator",
          state: "emulator-off",
          name: "Small_Phone_API_24",
        },
      ] satisfies Device[],
    });
  });

  it("asks an emulator for its AVD name once per connection", async () => {
    const { bridge, runner } = setup(
      { "devices -l": devices, "emu avd name": out("Pixel_8", "OK") },
      { avds: ["Pixel_8"] },
    );
    await bridge.list();
    await bridge.list();
    expect(
      adbCalls(runner).filter((c) => c.endsWith("emu avd name")),
    ).toHaveLength(1);
  });

  it("lists only running devices when the emulator tool is missing", async () => {
    const { bridge } = setup(
      { "devices -l": devices, "emu avd name": out("Pixel_8", "OK") },
      { emulator: false },
    );
    const listed = await bridge.list();
    expect(listed.ok && listed.value.map((d) => d.id)).toEqual([
      "emulator-5554",
      "R58N12ABCDE",
      "9B021FFAZ001K4",
    ]);
  });

  it("stops at the time limit", async () => {
    const { bridge } = setup(
      { "devices -l": { lines: [] } },
      { timeoutMs: 20 },
    );
    expect(await bridge.list()).toEqual({
      ok: false,
      error: { code: "ADB_TIMED_OUT", command: "devices -l" },
    });
  });

  it("stops when cancelled", async () => {
    const { bridge } = setup({ "devices -l": { lines: [] } });
    const controller = new AbortController();
    const listed = bridge.list(controller.signal);
    controller.abort();
    expect(await listed).toEqual({ ok: false, error: { code: "CANCELLED" } });
  });
});

describe("AdbDeviceBridge.watch (DEV-2)", () => {
  it("lists the devices again whenever adb reports a change", async () => {
    const { bridge, runner } = setup({
      "devices -l": out("List of devices attached", ""),
      "track-devices -l": {
        lines: [
          { stream: "stdout", text: "0000" },
          { stream: "stdout", text: "001cR58N12ABCDE\tdevice usb:1-1\n" },
        ],
      },
    });
    const lists: Device[][] = [];
    const stop = bridge.watch((devices) => lists.push(devices));
    await waitUntil(() => lists.length >= 1);
    stop();
    expect(adbCalls(runner)).toContain("track-devices -l");
    expect(
      runner.calls.find((c) => c.args[0] === "track-devices")?.output,
    ).toBe("chunks");
  });

  it("starts tracking again after adb stopped", async () => {
    const { bridge, runner, clock } = setup({
      "devices -l": out("List of devices attached", ""),
      "track-devices -l": out(),
    });
    const stop = bridge.watch(() => undefined);
    const tracks = () =>
      adbCalls(runner).filter((c) => c.startsWith("track")).length;
    await waitUntil(() => tracks() === 1);
    await settle();
    clock.advance(2000);
    await waitUntil(() => tracks() === 2);
    stop();
    await settle();
    clock.advance(2000);
    await settle();
    expect(tracks()).toBe(2);
  });
});

describe("AdbDeviceBridge.install (RUN-3)", () => {
  it("installs over the existing app and allows an older version", async () => {
    const { bridge, runner } = setup({
      "install -r -d /apk/app.apk": out(
        "Performing Streamed Install",
        "Success",
      ),
    });
    expect(await bridge.install("emulator-5554", "/apk/app.apk")).toEqual({
      ok: true,
      value: "installed",
    });
    expect(adbCalls(runner)).toEqual([
      "-s emulator-5554 install -r -d /apk/app.apk",
    ]);
  });

  it("recognises an app signed with another key", async () => {
    // Real output, 2026-11-09, adb 37.0.0.
    const { bridge } = setup({
      "install -r -d /apk/app.apk": err(
        1,
        "adb.exe: failed to install other.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package dev.jagra.sample signatures do not match newer version; ignoring!]",
      ),
    });
    expect(await bridge.install("emulator-5554", "/apk/app.apk")).toEqual({
      ok: true,
      value: "signature-mismatch",
    });
  });

  it("reports an unplugged phone", async () => {
    const { bridge } = setup({
      "install -r -d /apk/app.apk": err(
        1,
        "adb.exe: device 'R58N12ABCDE' not found",
      ),
    });
    expect(await bridge.install("R58N12ABCDE", "/apk/app.apk")).toEqual({
      ok: false,
      error: { code: "DEVICE_NOT_FOUND", deviceId: "R58N12ABCDE" },
    });
  });

  it("keeps the last lines of any other failure", async () => {
    const { bridge } = setup({
      "install -r -d /apk/app.apk": err(
        1,
        "Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]",
      ),
    });
    expect(await bridge.install("emulator-5554", "/apk/app.apk")).toEqual({
      ok: false,
      error: {
        code: "INSTALL_FAILED",
        detail: "Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]",
      },
    });
  });
});

describe("AdbDeviceBridge app data and package names", () => {
  it("clears app data", async () => {
    const { bridge } = setup({
      "shell pm clear dev.jagra.sample": out("Success"),
    });
    expect(
      await bridge.clearAppData("emulator-5554", "dev.jagra.sample"),
    ).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("reports a clear that failed", async () => {
    const { bridge } = setup({
      "shell pm clear dev.jagra.other": err(1, "Failed"),
    });
    const cleared = await bridge.clearAppData(
      "emulator-5554",
      "dev.jagra.other",
    );
    expect(cleared.ok ? undefined : cleared.error.code).toBe("ADB_FAILED");
  });

  it("refuses a package name that is not one, without calling adb", async () => {
    const { bridge, runner } = setup({});
    expect(await bridge.clearAppData("emulator-5554", "x.y; reboot")).toEqual({
      ok: false,
      error: { code: "PACKAGE_NAME_INVALID", packageName: "x.y; reboot" },
    });
    expect(await bridge.uninstall("emulator-5554", "x.y; reboot")).toEqual({
      ok: false,
      error: { code: "PACKAGE_NAME_INVALID", packageName: "x.y; reboot" },
    });
    expect(runner.calls).toEqual([]);
  });
});

describe("AdbDeviceBridge reverse rules (MCK-4)", () => {
  it("adds and removes a rule for one port", async () => {
    const { bridge, runner } = setup({
      "reverse tcp:3000 tcp:3000": out("3000"),
      "reverse --remove tcp:3000": out(),
    });
    expect((await bridge.addReverse("emulator-5554", 3000)).ok).toBe(true);
    expect((await bridge.removeReverse("emulator-5554", 3000)).ok).toBe(true);
    expect(adbCalls(runner)).toEqual([
      "-s emulator-5554 reverse tcp:3000 tcp:3000",
      "-s emulator-5554 reverse --remove tcp:3000",
    ]);
  });

  it("treats removing a rule that is already gone as done", async () => {
    // Real output, 2026-11-09.
    const { bridge } = setup({
      "reverse --remove tcp:3999": err(
        1,
        "adb.exe: error: listener 'tcp:3999' not found",
      ),
    });
    expect((await bridge.removeReverse("emulator-5554", 3999)).ok).toBe(true);
  });
});

describe("AdbDeviceBridge boot and version", () => {
  it("reports an emulator that has not finished booting", async () => {
    const { bridge } = setup({ "shell getprop sys.boot_completed": out("") });
    expect(await bridge.bootState("emulator-5554")).toEqual({
      ok: true,
      value: { booted: false },
    });
  });

  it("reports the load and the cores once booted", async () => {
    const { bridge } = setup({
      "shell getprop sys.boot_completed": out("1"),
      "shell cat /proc/loadavg": out("11.02 6.40 2.71 3/1871 23741"),
      "shell nproc": out("4"),
    });
    expect(await bridge.bootState("emulator-5554")).toEqual({
      ok: true,
      value: { booted: true, load: 11.02, cores: 4 },
    });
  });

  it("reads the Android version and API level", async () => {
    const { bridge } = setup({
      "shell getprop ro.build.version.release": out("15"),
      "shell getprop ro.build.version.sdk": out("35"),
    });
    expect(await bridge.androidVersion("emulator-5554")).toEqual({
      ok: true,
      value: { release: "15", sdk: 35 },
    });
  });

  it("reports a phone that went offline", async () => {
    const { bridge } = setup({
      "shell getprop ro.build.version.release": err(1, "adb: device offline"),
    });
    expect(await bridge.androidVersion("R58N12ABCDE")).toEqual({
      ok: false,
      error: { code: "DEVICE_NOT_RESPONDING", deviceId: "R58N12ABCDE" },
    });
  });
});

describe("AdbDeviceBridge.launchEmulator (DEV-4, DEV-5)", () => {
  it("launches the emulator so it outlives Jagra", async () => {
    const { bridge, runner } = setup({});
    expect(await bridge.launchEmulator("Pixel_8")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(runner.launched).toEqual([
      { program: EMULATOR, args: ["-avd", "Pixel_8"] },
    ]);
  });

  it("reports a missing emulator tool", async () => {
    const { bridge } = setup({}, { emulator: false });
    expect(await bridge.launchEmulator("Pixel_8")).toEqual({
      ok: false,
      error: { code: "PROGRAM_NOT_FOUND", program: "emulator" },
    });
  });
});

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function waitUntil(condition: () => boolean): Promise<void> {
  return vi.waitFor(() => expect(condition()).toBe(true));
}
