import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { AdbkitApkReader } from "../adapters/apk/adbkit-apk-reader.js";
import { SystemClock } from "../adapters/clock/system-clock.js";
import { AdbDeviceBridge } from "../adapters/devices/adb-device-bridge.js";
import { NodeProcessRunner } from "../adapters/process/node-process-runner.js";
import { NodeToolProbe } from "../adapters/tools/node-tool-probe.js";
import type { OutputLine } from "../ports/process-runner.js";
import type { ActiveProcessRecord } from "../process/active-processes.js";
import { findApk } from "../project/apk.js";
import { loadConfig } from "../project/config.js";
import type { Device } from "../types/index.js";
import { checkAndroidVersion } from "./android.js";
import { installApk } from "./install.js";
import { prepareDevice } from "./prepare.js";

const SAMPLE = fileURLToPath(
  new URL("../../../../sample-app", import.meta.url),
);

// M4 "Done when", against the sample APK. Build it first (`cd sample-app && ./gradlew
// assembleDebug`) and close every emulator, so one has to be started.
it("finds the APK, starts an emulator, installs, clears data and sets a reverse rule", async () => {
  const records: ActiveProcessRecord[] = [];
  const runner = new NodeProcessRunner({
    store: {
      add: (record) => Promise.resolve(void records.push(record)),
      remove: (pid) => {
        records.splice(
          records.findIndex((r) => r.pid === pid),
          1,
        );
        return Promise.resolve();
      },
      list: () => Promise.resolve(records),
    },
  });
  const clock = new SystemClock();
  const probe = new NodeToolProbe({ runner });
  const adb = await probe.probe("adb", { paths: {} });
  const emulator = await probe.probe("emulator", { paths: {} });
  if (!adb.found || !emulator.found)
    throw new Error("adb and emulator are needed");
  const bridge = new AdbDeviceBridge({
    runner,
    clock,
    adb: adb.path,
    emulator: emulator.path,
  });
  const step = timer();

  const config = await loadConfig(SAMPLE);
  if (!config.ok) throw new Error(JSON.stringify(config.error));
  const apk = await findApk(SAMPLE, config.value);
  if (!apk.ok)
    throw new Error(`build the sample APK first: ${JSON.stringify(apk.error)}`);
  const info = await new AdbkitApkReader().read(apk.value.path);
  step(`APK ${apk.value.path}`, info);
  expect(info.ok && info.value.packageName).toBe("dev.jagra.sample");
  if (!info.ok) return;

  const listed = await bridge.list();
  step("devices", listed);
  if (!listed.ok) throw new Error(JSON.stringify(listed.error));
  const off = listed.value.find((d) => d.state === "emulator-off");
  if (off === undefined)
    throw new Error("close every emulator first, so one has to be started");

  const prepared = await prepareDevice({
    bridge,
    clock,
    device: off,
    onEvent: (event) => step(`event ${event.stage}`),
  });
  step("prepared", prepared);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.error));
  const id = prepared.value.id;

  step("android", await checkAndroidVersion(bridge, id));
  const installed = await installApk({
    bridge,
    deviceId: id,
    apkPath: apk.value.path,
    packageName: info.value.packageName,
    confirmUninstall: () => Promise.resolve(false),
  });
  step("installed", installed);
  expect(installed.ok).toBe(true);

  const cleared = await bridge.clearAppData(id, info.value.packageName);
  step("cleared", cleared);
  expect(cleared.ok).toBe(true);

  const reverseList = async () => {
    const lines: OutputLine[] = [];
    const started = await runner.start(
      { program: adb.path, args: ["-s", id, "reverse", "--list"] },
      (line) => lines.push(line),
    );
    if (started.ok) await started.value.exited;
    return lines.map((l) => l.text).join("\n");
  };
  expect((await bridge.addReverse(id, 3000)).ok).toBe(true);
  const withRule = await reverseList();
  step("reverse added", withRule);
  expect(withRule).toContain("tcp:3000");
  expect((await bridge.removeReverse(id, 3000)).ok).toBe(true);
  const withoutRule = await reverseList();
  step("reverse removed", withoutRule);
  expect(withoutRule).not.toContain("tcp:3000");

  const watched = await new Promise<Device[]>((resolve) => {
    const stop = bridge.watch((devices) => {
      stop();
      resolve(devices);
    });
  });
  step("watch", watched);
  expect(
    watched.some((d) => d.id === id && d.state === "emulator-running"),
  ).toBe(true);
  // The emulator stays running (DEV-5). Only `adb` calls were recorded, and all have ended.
  await clock.sleep(500);
  expect(records).toEqual([]);
}, 300_000);

function timer() {
  const started = performance.now();
  return (label: string, value?: unknown) => {
    const seconds = ((performance.now() - started) / 1000)
      .toFixed(1)
      .padStart(6);
    console.log(
      `${seconds}s ${label}${value === undefined ? "" : ` ${JSON.stringify(value)}`}`,
    );
  };
}
