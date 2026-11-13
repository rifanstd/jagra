import type { Device, DeviceState, ToolFinding, ToolName } from "@jagra/core";
import { FakeDeviceBridge, FakeToolProbe } from "@jagra/core/fakes";

/**
 * The test mode that Playwright starts the built app in, so the screens can be tested on every CI
 * system without tools or devices (D-81). Only `JAGRA_TEST_MODE=1` turns it on, and a packaged
 * app ignores it.
 */
export function isTestMode(env: NodeJS.ProcessEnv, packaged: boolean): boolean {
  return !packaged && env.JAGRA_TEST_MODE === "1";
}

const VERSIONS: Readonly<Record<ToolName, string>> = {
  java: "17.0.12",
  adb: "37.0.0",
  maestro: "2.12.1",
  emulator: "36.5.11.0",
  mockoon: "9.10.0",
};

/**
 * Every tool found, except those `JAGRA_TEST_TOOLS` changes, for example
 * `maestro=missing,mockoon=9.12.0`.
 */
export function testToolProbe(env: NodeJS.ProcessEnv): FakeToolProbe {
  const probe = new FakeToolProbe();
  for (const [tool, version] of Object.entries(VERSIONS) as [
    ToolName,
    string,
  ][]) {
    probe.set(tool, { found: true, path: `/test/${tool}`, version });
  }
  for (const pair of (env.JAGRA_TEST_TOOLS ?? "").split(",").filter(Boolean)) {
    const [tool, value] = pair.split("=") as [ToolName, string | undefined];
    if (!(tool in VERSIONS) || value === undefined) continue;
    const finding: ToolFinding =
      value === "missing"
        ? { found: false }
        : value === "needs-java"
          ? { found: true, path: `/test/${tool}`, problem: "needs-java" }
          : { found: true, path: `/test/${tool}`, version: value };
    probe.set(tool, finding);
  }
  return probe;
}

const DEVICE_STATES: readonly DeviceState[] = [
  "emulator-running",
  "emulator-starting",
  "emulator-off",
  "phone-ready",
  "phone-not-authorised",
  "phone-not-responding",
];

/**
 * One running emulator by default. `JAGRA_TEST_DEVICES` replaces the list with `id|state|name`
 * entries separated by commas, for example `R58M|phone-not-authorised|SM-A525F`, or `none`.
 */
export function testDeviceBridge(env: NodeJS.ProcessEnv): FakeDeviceBridge {
  const bridge = new FakeDeviceBridge();
  const text =
    env.JAGRA_TEST_DEVICES ?? "emulator-5554|emulator-running|Pixel_8";
  const devices: Device[] = [];
  for (const entry of text.split(",").filter((e) => e && e !== "none")) {
    const [id, state, name] = entry.split("|") as [
      string,
      DeviceState,
      string | undefined,
    ];
    if (!DEVICE_STATES.includes(state) || !name) continue;
    devices.push({
      id,
      state,
      name,
      kind: state.startsWith("phone") ? "phone" : "emulator",
    });
  }
  bridge.setDevices(devices);
  return bridge;
}
