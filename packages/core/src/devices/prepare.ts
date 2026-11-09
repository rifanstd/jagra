import { fail, ok, type JagraError, type Result } from "../errors/index.js";
import type { Clock } from "../ports/clock.js";
import type { DeviceBridge } from "../ports/device-bridge.js";
import type { Device } from "../types/index.js";

/** DEV-4: an emulator that is not ready after this long stops the run. */
export const EMULATOR_READY_MINUTES = 3;
const POLL_MS = 2000;

/** Progress while a device is prepared. The interface shows "Starting emulator" (DEV-4). */
export type PrepareEvent = { stage: "starting-emulator" };

export interface PrepareOptions {
  bridge: DeviceBridge;
  clock: Clock;
  device: Device;
  signal?: AbortSignal;
  onEvent?: (event: PrepareEvent) => void;
}

/**
 * Makes the chosen device ready for a run (DEV-4). An emulator that is off is started and left
 * running afterwards (DEV-5). An emulator counts as ready once Android has booted and its load has
 * settled, because flows started earlier fail on a busy emulator (D-44).
 */
export async function prepareDevice(
  options: PrepareOptions,
): Promise<Result<Device>> {
  const { bridge, clock, device, signal } = options;
  switch (device.state) {
    case "phone-ready":
      return ok(device);
    case "phone-not-authorised":
      return fail({ code: "DEVICE_NOT_AUTHORISED", deviceId: device.id });
    case "phone-not-responding":
      return fail({ code: "DEVICE_NOT_RESPONDING", deviceId: device.id });
    case "emulator-off":
    case "emulator-starting":
    case "emulator-running":
      break;
  }

  const deadline = clock.now() + EMULATOR_READY_MINUTES * 60_000;
  const notReady: JagraError = {
    code: "EMULATOR_NOT_READY",
    name: device.name,
    minutes: EMULATOR_READY_MINUTES,
  };
  let announced = false;
  const announce = () => {
    if (!announced) options.onEvent?.({ stage: "starting-emulator" });
    announced = true;
  };

  let serial = device.id;
  if (device.state === "emulator-off") {
    announce();
    const launched = await bridge.launchEmulator(device.name);
    if (!launched.ok) return launched;
    const found = await waitForSerial(options, deadline);
    if (!found.ok) return found;
    serial = found.value;
  }

  for (;;) {
    if (signal?.aborted) return fail({ code: "CANCELLED" });
    const state = await bridge.bootState(serial, signal);
    if (!state.ok && state.error.code === "CANCELLED") return state;
    // While Android boots, `adb` may call the device offline or fail a command. Keep waiting.
    if (state.ok && state.value.booted) {
      const { load, cores } = state.value;
      const settled = load === undefined || cores === undefined || load < cores;
      // Still busy when time is up: run anyway. Booted is not "not ready" (D-44).
      if (settled || clock.now() >= deadline) {
        return ok({ ...device, id: serial, state: "emulator-running" });
      }
    }
    if (clock.now() >= deadline) return fail(notReady);
    announce();
    const slept = await sleep(clock, signal);
    if (!slept) return fail({ code: "CANCELLED" });
  }
}

/** After launching, waits for `adb` to list an emulator with the same AVD name. */
async function waitForSerial(
  { bridge, clock, device, signal }: PrepareOptions,
  deadline: number,
): Promise<Result<string>> {
  for (;;) {
    const listed = await bridge.list(signal);
    if (!listed.ok && listed.error.code === "CANCELLED") return listed;
    const running = listed.ok
      ? listed.value.find(
          (d) =>
            d.kind === "emulator" &&
            d.name === device.name &&
            d.state !== "emulator-off",
        )
      : undefined;
    if (running) return ok(running.id);
    if (clock.now() >= deadline) {
      return fail({
        code: "EMULATOR_NOT_READY",
        name: device.name,
        minutes: EMULATOR_READY_MINUTES,
      });
    }
    if (!(await sleep(clock, signal))) return fail({ code: "CANCELLED" });
  }
}

async function sleep(clock: Clock, signal?: AbortSignal): Promise<boolean> {
  try {
    await clock.sleep(POLL_MS, signal);
    return true;
  } catch {
    return false;
  }
}
