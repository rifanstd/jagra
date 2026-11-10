import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { AdbkitApkReader } from "../adapters/apk/adbkit-apk-reader.js";
import { SystemClock } from "../adapters/clock/system-clock.js";
import { AdbDeviceBridge } from "../adapters/devices/adb-device-bridge.js";
import { MaestroFlowRunner } from "../adapters/maestro/maestro-flow-runner.js";
import { MockoonServer } from "../adapters/mockoon/mockoon-server.js";
import { NodePortChecker } from "../adapters/mockoon/node-port-checker.js";
import { NodeProcessControl } from "../adapters/process/node-process-control.js";
import { NodeProcessRunner } from "../adapters/process/node-process-runner.js";
import { NodeToolProbe } from "../adapters/tools/node-tool-probe.js";
import { projectMockoon } from "../mockoon/project.js";
import { ActiveProcessFile } from "../process/active-processes.js";
import { findApk } from "../project/apk.js";
import { loadConfig } from "../project/config.js";
import type { OutputLine } from "../ports/process-runner.js";
import { planRun } from "./plan.js";
import { executeRun } from "./run.js";

const SAMPLE = fileURLToPath(
  new URL("../../../../sample-app", import.meta.url),
);

// MCK-5 and RUN-9 on a real emulator: Cancel during the second flow leaves no Mockoon process
// and no reverse rule. Needs a running emulator and the sample APK.
// `pnpm --filter @jagra/core test:device cancel`
it("cancels mid-run and leaves no Mockoon and no reverse rule", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jagra-cancel-"));
  const state = new ActiveProcessFile(join(dir, "state", "active.json"));
  const runner = new NodeProcessRunner({ store: state });
  const clock = new SystemClock();
  const probe = new NodeToolProbe({ runner });
  const path = async (tool: "adb" | "maestro" | "mockoon") => {
    const found = await probe.probe(tool, { paths: {} });
    if (!found.found) throw new Error(`${tool} is needed`);
    return found.path;
  };
  const adb = await path("adb");
  const bridge = new AdbDeviceBridge({ runner, clock, adb });
  const ports = new NodePortChecker();

  const config = await loadConfig(SAMPLE);
  if (!config.ok) throw new Error("config");
  const apk = await findApk(SAMPLE, config.value);
  if (!apk.ok) throw new Error("build the sample APK first");
  const info = await new AdbkitApkReader().read(apk.value.path);
  if (!info.ok) throw new Error("apk");
  const plan = await planRun({
    projectFolder: SAMPLE,
    secret: () => Promise.resolve(undefined),
  });
  if (!plan.ok) throw new Error("plan");
  const mockoon = await projectMockoon(SAMPLE, config.value, ports);
  if (!mockoon.ok || !mockoon.value) throw new Error(JSON.stringify(mockoon));
  const listed = await bridge.list();
  const device = listed.ok
    ? listed.value.find((d) => d.state === "emulator-running")
    : undefined;
  if (!device) throw new Error("start an emulator first");

  const cancel = new AbortController();
  const result = await executeRun(
    {
      runId: "cancel-test",
      projectId: "cancel-test",
      runFolder: join(dir, "run"),
      appId: info.value.packageName,
      flows: plan.value.flows,
      needs: plan.value.needs,
      values: plan.value.values,
      apk: apk.value,
      apkInfo: info.value,
      device,
      flowTimeoutMinutes: 5,
      mockoon: mockoon.value,
    },
    {
      bridge,
      clock,
      flowRunner: new MaestroFlowRunner({
        runner,
        clock,
        maestro: await path("maestro"),
      }),
      mockServer: new MockoonServer({
        runner,
        clock,
        ports,
        mockoon: await path("mockoon"),
      }),
      state,
    },
    {
      signal: cancel.signal,
      confirmUninstall: () => Promise.resolve(false),
      onEvent: (event) => {
        // Cancel a few seconds into the second flow.
        if (event.type === "flow-started" && event.index === 1) {
          setTimeout(() => cancel.abort(), 8000);
        }
      },
    },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  console.log(
    result.value.flows.map((f) => `${f.name}: ${f.status}`).join("\n"),
  );

  expect(result.value.status).toBe("cancelled");
  expect(result.value.flows.map((f) => f.status)).toEqual([
    "passed",
    "cancelled",
    "cancelled",
    "cancelled",
    "cancelled",
  ]);
  expect(await ports.accepts(mockoon.value.port)).toBe(false);
  expect(
    await new NodeProcessControl({ runner }).listeningPids(mockoon.value.port),
  ).toEqual([]);
  const rules: OutputLine[] = [];
  const reverse = await runner.start(
    { program: adb, args: ["-s", device.id, "reverse", "--list"] },
    (line) => rules.push(line),
  );
  if (reverse.ok) await reverse.value.exited;
  expect(rules.map((l) => l.text).join("")).not.toContain(
    `tcp:${mockoon.value.port}`,
  );
  expect(await state.listReverse()).toEqual([]);
}, 600_000);
