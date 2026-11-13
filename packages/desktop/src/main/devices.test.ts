import type { Device } from "@jagra/core";
import { FakeDeviceBridge } from "@jagra/core/fakes";
import { describe, expect, it } from "vitest";
import type { DevicesView } from "../shared/api.js";
import { Devices } from "./devices.js";
import { testDeviceBridge } from "./test-mode.js";

const pixel: Device = {
  id: "emulator-5554",
  kind: "emulator",
  state: "emulator-running",
  name: "Pixel_8",
};
const phone: Device = {
  id: "R58M",
  kind: "phone",
  state: "phone-ready",
  name: "SM-A525F",
};

describe("Devices (DEV-1, DEV-2)", () => {
  it("watches once, and sends every change to the windows", () => {
    const bridge = new FakeDeviceBridge();
    bridge.setDevices([pixel]);
    const sent: DevicesView[] = [];
    let made = 0;
    const devices = new Devices(
      () => {
        made++;
        return bridge;
      },
      (view) => sent.push(view),
    );

    expect(devices.watch()).toEqual({ adb: true, devices: [pixel] });
    devices.watch();
    expect(made).toBe(1);
    bridge.setDevices([pixel, phone]);
    expect(sent.at(-1)).toEqual({ adb: true, devices: [pixel, phone] });

    devices.close();
    bridge.setDevices([]);
    expect(sent.at(-1)?.devices).toHaveLength(2);
  });

  it("says when adb is unknown, and starts once a check finds it", () => {
    const bridge = new FakeDeviceBridge();
    bridge.setDevices([phone]);
    let adbFound = false;
    const sent: DevicesView[] = [];
    const devices = new Devices(
      () => (adbFound ? bridge : undefined),
      (view) => sent.push(view),
    );
    expect(devices.watch()).toEqual({ adb: false, devices: [] });
    adbFound = true;
    devices.toolsChanged();
    expect(sent.at(-1)).toEqual({ adb: true, devices: [phone] });
  });

  it("does not start watching on a check when no page asked", () => {
    let made = 0;
    const devices = new Devices(
      () => {
        made++;
        return new FakeDeviceBridge();
      },
      () => undefined,
    );
    devices.toolsChanged();
    expect(made).toBe(0);
  });

  it("lists again on refresh", async () => {
    const bridge = new FakeDeviceBridge();
    const devices = new Devices(
      () => bridge,
      () => undefined,
    );
    devices.watch();
    bridge.setDevices([phone]);
    expect(await devices.refresh()).toEqual({ adb: true, devices: [phone] });
  });
});

describe("testDeviceBridge (D-81)", () => {
  it("has one running emulator by default", async () => {
    expect(await testDeviceBridge({}).list()).toEqual({
      ok: true,
      value: [pixel],
    });
  });

  it("takes devices from JAGRA_TEST_DEVICES, and none for none", async () => {
    const bridge = testDeviceBridge({
      JAGRA_TEST_DEVICES:
        "R58M|phone-not-authorised|2201117TY,avd:Small|emulator-off|Small,bad|nope|x",
    });
    expect(await bridge.list()).toEqual({
      ok: true,
      value: [
        {
          id: "R58M",
          kind: "phone",
          state: "phone-not-authorised",
          name: "2201117TY",
        },
        {
          id: "avd:Small",
          kind: "emulator",
          state: "emulator-off",
          name: "Small",
        },
      ],
    });
    expect(
      await testDeviceBridge({ JAGRA_TEST_DEVICES: "none" }).list(),
    ).toEqual({
      ok: true,
      value: [],
    });
  });
});
