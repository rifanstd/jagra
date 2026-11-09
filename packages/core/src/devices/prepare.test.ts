import { describe, expect, it } from "vitest";
import type { Result } from "../errors/index.js";
import { FakeClock } from "../fakes/clock.js";
import { FakeDeviceBridge } from "../fakes/devices.js";
import type { Device } from "../types/index.js";
import { prepareDevice, type PrepareEvent } from "./prepare.js";

const pixelOff: Device = {
  id: "avd:Pixel_8",
  kind: "emulator",
  state: "emulator-off",
  name: "Pixel_8",
};
const phone: Device = {
  id: "R58N12ABCDE",
  kind: "phone",
  state: "phone-ready",
  name: "SM A525F",
};

/** Moves the fake clock 2 seconds at a time until the promise settles. */
async function drive<T>(
  clock: FakeClock,
  promise: Promise<T>,
  maxMs = 10 * 60_000,
) {
  let done = false;
  void promise.finally(() => (done = true));
  for (let waited = 0; !done && waited <= maxMs; waited += 2000) {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    if (!done) clock.advance(2000);
  }
  return promise;
}

function setup(devices: Device[]) {
  const bridge = new FakeDeviceBridge();
  bridge.setDevices(devices);
  const clock = new FakeClock();
  const events: PrepareEvent[] = [];
  const prepare = (
    device: Device,
    signal?: AbortSignal,
  ): Promise<Result<Device>> =>
    drive(
      clock,
      prepareDevice({
        bridge,
        clock,
        device,
        signal,
        onEvent: (e) => events.push(e),
      }),
    );
  return { bridge, clock, events, prepare };
}

describe("prepareDevice with an emulator that is off (DEV-4)", () => {
  it("starts it, says so, and waits until it has booted and settled", async () => {
    const { bridge, clock, events, prepare } = setup([pixelOff]);
    bridge.bootStates = [
      { booted: false },
      { booted: false },
      { booted: true, load: 11, cores: 4 },
      { booted: true, load: 6, cores: 4 },
      { booted: true, load: 2.5, cores: 4 },
    ];
    const started = clock.now();

    const prepared = await prepare(pixelOff);

    expect(prepared).toEqual({
      ok: true,
      value: {
        id: "emulator-5554",
        kind: "emulator",
        state: "emulator-running",
        name: "Pixel_8",
      },
    });
    expect(events).toEqual([{ stage: "starting-emulator" }]);
    expect(bridge.calls[0]).toEqual({
      call: "launchEmulator",
      name: "Pixel_8",
    });
    expect(bridge.calls.filter((c) => c.call === "bootState")).toHaveLength(5);
    expect(clock.now() - started).toBe(8000);
  });

  it("stops with a clear code when Android has not booted after 3 minutes", async () => {
    const { bridge, clock, prepare } = setup([pixelOff]);
    bridge.bootStates = [{ booted: false }];
    const started = clock.now();

    expect(await prepare(pixelOff)).toEqual({
      ok: false,
      error: { code: "EMULATOR_NOT_READY", name: "Pixel_8", minutes: 3 },
    });
    expect(clock.now() - started).toBe(3 * 60_000);
  });

  it("goes ahead with a booted emulator that is still busy after 3 minutes (D-44)", async () => {
    const { bridge, prepare } = setup([pixelOff]);
    bridge.bootStates = [{ booted: true, load: 9, cores: 4 }];
    const prepared = await prepare(pixelOff);
    expect(prepared.ok && prepared.value.state).toBe("emulator-running");
  });

  it("keeps waiting while adb calls the booting emulator offline", async () => {
    const { bridge, prepare } = setup([pixelOff]);
    bridge.failNext.set("bootState", {
      code: "DEVICE_NOT_RESPONDING",
      deviceId: "emulator-5554",
    });
    const prepared = await prepare(pixelOff);
    expect(prepared.ok).toBe(true);
  });

  it("reports an emulator that never shows up in adb", async () => {
    const { bridge, prepare } = setup([pixelOff]);
    // Launching works, but the emulator exits at once (a locked AVD, say).
    bridge.launchEmulator = () =>
      Promise.resolve({ ok: true, value: undefined });
    expect(await prepare(pixelOff)).toEqual({
      ok: false,
      error: { code: "EMULATOR_NOT_READY", name: "Pixel_8", minutes: 3 },
    });
  });

  it("reports a missing emulator tool", async () => {
    const { bridge, prepare } = setup([pixelOff]);
    bridge.failNext.set("launchEmulator", {
      code: "PROGRAM_NOT_FOUND",
      program: "emulator",
    });
    expect(await prepare(pixelOff)).toEqual({
      ok: false,
      error: { code: "PROGRAM_NOT_FOUND", program: "emulator" },
    });
  });

  it("stops at once when cancelled while waiting", async () => {
    const { bridge, clock } = setup([pixelOff]);
    bridge.bootStates = [{ booted: false }];
    const controller = new AbortController();
    const preparing = prepareDevice({
      bridge,
      clock,
      device: pixelOff,
      signal: controller.signal,
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    controller.abort();
    expect(await preparing).toEqual({
      ok: false,
      error: { code: "CANCELLED" },
    });
  });
});

describe("prepareDevice with a running emulator", () => {
  it("uses a ready emulator without saying it is starting", async () => {
    const running: Device = {
      ...pixelOff,
      id: "emulator-5554",
      state: "emulator-running",
    };
    const { bridge, events, prepare } = setup([running]);
    expect(await prepare(running)).toEqual({ ok: true, value: running });
    expect(events).toEqual([]);
    expect(bridge.calls.some((c) => c.call === "launchEmulator")).toBe(false);
  });

  it("waits for an emulator the user just started", async () => {
    const starting: Device = {
      ...pixelOff,
      id: "emulator-5554",
      state: "emulator-starting",
    };
    const { bridge, events, prepare } = setup([starting]);
    bridge.bootStates = [
      { booted: false },
      { booted: true, load: 1, cores: 4 },
    ];
    const prepared = await prepare(starting);
    expect(prepared.ok && prepared.value.state).toBe("emulator-running");
    expect(events).toEqual([{ stage: "starting-emulator" }]);
  });
});

describe("prepareDevice with a phone", () => {
  it("uses a ready phone as it is", async () => {
    const { prepare } = setup([phone]);
    expect(await prepare(phone)).toEqual({ ok: true, value: phone });
  });

  it("refuses a phone that has not accepted USB debugging", async () => {
    const unauthorised: Device = { ...phone, state: "phone-not-authorised" };
    const { prepare } = setup([unauthorised]);
    expect(await prepare(unauthorised)).toEqual({
      ok: false,
      error: { code: "DEVICE_NOT_AUTHORISED", deviceId: "R58N12ABCDE" },
    });
  });

  it("refuses a phone that does not respond", async () => {
    const offline: Device = { ...phone, state: "phone-not-responding" };
    const { prepare } = setup([offline]);
    expect(await prepare(offline)).toEqual({
      ok: false,
      error: { code: "DEVICE_NOT_RESPONDING", deviceId: "R58N12ABCDE" },
    });
  });
});
