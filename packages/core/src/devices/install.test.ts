import { describe, expect, it } from "vitest";
import { FakeDeviceBridge } from "../fakes/devices.js";
import type { Device } from "../types/index.js";
import { checkAndroidVersion } from "./android.js";
import { installApk } from "./install.js";

const phone: Device = {
  id: "R58N12ABCDE",
  kind: "phone",
  state: "phone-ready",
  name: "SM A525F",
};

function setup(devices: Device[] = [phone]) {
  const bridge = new FakeDeviceBridge();
  bridge.setDevices(devices);
  const questions: string[] = [];
  const install = (answer: boolean) =>
    installApk({
      bridge,
      deviceId: phone.id,
      apkPath: "/apk/app-debug.apk",
      packageName: "dev.jagra.sample",
      confirmUninstall: () => {
        questions.push("uninstall?");
        return Promise.resolve(answer);
      },
    });
  return { bridge, questions, install };
}

describe("installApk (RUN-3)", () => {
  it("installs without asking anything", async () => {
    const { bridge, questions, install } = setup();
    expect(await install(true)).toEqual({ ok: true, value: undefined });
    expect(questions).toEqual([]);
    expect(bridge.calls.map((c) => c.call)).toEqual(["install"]);
  });

  it("asks before uninstalling an app signed with another key, then installs again", async () => {
    const { bridge, questions, install } = setup();
    bridge.installOutcome = "signature-mismatch";
    expect(await install(true)).toEqual({ ok: true, value: undefined });
    expect(questions).toEqual(["uninstall?"]);
    expect(bridge.calls.map((c) => c.call)).toEqual([
      "install",
      "uninstall",
      "install",
    ]);
  });

  it("never uninstalls when the user says no", async () => {
    const { bridge, install } = setup();
    bridge.installOutcome = "signature-mismatch";
    expect(await install(false)).toEqual({
      ok: false,
      error: {
        code: "INSTALL_SIGNATURE_MISMATCH",
        packageName: "dev.jagra.sample",
      },
    });
    expect(bridge.calls.some((c) => c.call === "uninstall")).toBe(false);
  });

  it("reports an unplugged phone", async () => {
    const { install } = setup([]);
    expect(await install(true)).toEqual({
      ok: false,
      error: { code: "DEVICE_NOT_FOUND", deviceId: "R58N12ABCDE" },
    });
  });

  it("reports a phone that has not accepted USB debugging", async () => {
    const { install } = setup([{ ...phone, state: "phone-not-authorised" }]);
    expect(await install(true)).toEqual({
      ok: false,
      error: { code: "DEVICE_NOT_AUTHORISED", deviceId: "R58N12ABCDE" },
    });
  });
});

describe("checkAndroidVersion (DEV-7)", () => {
  it.each([
    [23, false],
    [24, true],
    [35, true],
  ])("API %i supported: %s", async (sdk, supported) => {
    const bridge = new FakeDeviceBridge();
    bridge.setDevices([phone]);
    bridge.versions.set(phone.id, { release: "x", sdk });
    const checked = await checkAndroidVersion(bridge, phone.id);
    expect(checked.ok && checked.value.supported).toBe(supported);
  });

  it("reports an unplugged phone", async () => {
    const bridge = new FakeDeviceBridge();
    const checked = await checkAndroidVersion(bridge, phone.id);
    expect(checked.ok ? undefined : checked.error.code).toBe(
      "DEVICE_NOT_FOUND",
    );
  });
});
