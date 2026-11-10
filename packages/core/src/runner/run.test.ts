import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../fakes/clock.js";
import { FakeDeviceBridge } from "../fakes/devices.js";
import { FakeFlowRunner } from "../fakes/maestro.js";
import { FakeMockServer } from "../fakes/mockoon.js";
import type {
  ReverseRecord,
  RunStateStore,
} from "../process/active-processes.js";
import type { Flow } from "../project/flow.js";
import { loadRun } from "../results/run-store.js";
import type { Device, Run } from "../types/index.js";
import { executeRun, type RunEvent, type RunInput } from "./run.js";

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "jagra-run-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

const emulator: Device = {
  id: "emulator-5554",
  kind: "emulator",
  state: "emulator-running",
  name: "Pixel_8",
};

const flow = (name: string, variables: string[] = []): Flow => ({
  file: `/project/.jagra/flows/${name}.yaml`,
  name,
  isHelper: false,
  properties: {},
  steps: [],
  calls: [],
  variables,
  problems: [],
});

const FIVE = ["a", "b", "c", "d", "e"].map((n) => flow(n));

function setup(flows: Flow[] = FIVE, devices: Device[] = [emulator]) {
  const bridge = new FakeDeviceBridge();
  bridge.setDevices(devices);
  const flowRunner = new FakeFlowRunner();
  const clock = new FakeClock();
  const mockServer = new FakeMockServer();
  const state = new MemoryRunState();
  const events: RunEvent[] = [];
  const controller = new AbortController();
  const input: RunInput = {
    runId: "20261110-183000-123-8000",
    projectId: "p1",
    runFolder: folder,
    appId: "dev.jagra.sample",
    flows,
    needs: {},
    values: {},
    apk: { path: "/apk/app-debug.apk", modifiedAt: 0, handPicked: false },
    apkInfo: {
      packageName: "dev.jagra.sample",
      versionName: "1.0",
      versionCode: 1,
    },
    device: devices[0] ?? emulator,
    flowTimeoutMinutes: 5,
  };
  let answer = true;
  const start = (extra: Partial<RunInput> = {}) =>
    executeRun(
      { ...input, ...extra },
      { bridge, flowRunner, clock, mockServer, state },
      {
        signal: controller.signal,
        onEvent: (e) => events.push(e),
        confirmUninstall: () => Promise.resolve(answer),
      },
    );
  const declineUninstall = () => (answer = false);
  return {
    bridge,
    flowRunner,
    clock,
    mockServer,
    state,
    events,
    controller,
    start,
    declineUninstall,
  };
}

const statuses = (run: Run) => run.flows.map((f) => f.status);
const value = <T>(result: { ok: true; value: T } | { ok: false }): T => {
  if (!result.ok) throw new Error(`expected ok: ${JSON.stringify(result)}`);
  return result.value;
};

describe("executeRun (spec section 7)", () => {
  it("installs, clears data before every flow and runs each flow once", async () => {
    const { bridge, flowRunner, start } = setup();
    flowRunner.set(FIVE[2]?.file ?? "", {
      status: "failed",
      reason: "Element not found",
    });

    const run = value(await start());

    expect(run.status).toBe("completed");
    expect(statuses(run)).toEqual([
      "passed",
      "passed",
      "failed",
      "passed",
      "passed",
    ]);
    expect(run.flows[2]).toMatchObject({
      failure: "step",
      reason: "Element not found",
    });
    expect(run.device).toEqual({
      id: "emulator-5554",
      name: "Pixel_8",
      kind: "emulator",
      androidVersion: "15",
    });
    const calls = bridge.calls
      .map((c) => c.call)
      .filter((c) => c !== "bootState");
    expect(calls).toEqual([
      "androidVersion",
      "install",
      ...Array.from({ length: 5 }, () => "clearAppData"),
    ]);
    expect(flowRunner.requests.map((r) => r.outputDir)).toEqual(
      ["01-a", "02-b", "03-c", "04-d", "05-e"].map((d) =>
        join(folder, "flows", d),
      ),
    );
    expect(flowRunner.requests[0]).toMatchObject({
      timeoutMs: 300_000,
      appId: "dev.jagra.sample",
    });
  });

  it("saves each result as soon as its flow ends (REL-1)", async () => {
    const { flowRunner, start } = setup();
    const seen: string[][] = [];
    flowRunner.during = async (request) => {
      if (request.flowFile.endsWith("c.yaml")) {
        const saved = await loadRun(folder);
        seen.push(saved ? statuses(saved) : []);
      }
    };
    await start();
    expect(seen).toEqual([
      ["passed", "passed", "running", "waiting", "waiting"],
    ]);
    expect((await loadRun(folder))?.status).toBe("completed");
  });

  it("passes each flow only the variables it needs", async () => {
    const flows = [flow("a", ["PASSWORD"]), flow("b")];
    const { flowRunner, start } = setup(flows);
    await start({
      needs: { [flows[0]?.file ?? ""]: ["PASSWORD"] },
      values: { PASSWORD: "hunter2", OTHER: "x" },
    });
    expect(flowRunner.requests.map((r) => r.variables)).toEqual([
      { PASSWORD: "hunter2" },
      {},
    ]);
  });

  it("goes on after a timed-out flow and a crashed app (RUN-6, RUN-7)", async () => {
    const { flowRunner, start } = setup();
    flowRunner.set(FIVE[1]?.file ?? "", { status: "timed-out" });
    flowRunner.set(FIVE[3]?.file ?? "", {
      status: "app-crashed",
      crashReport: join(folder, "x", "crash.txt"),
    });
    const run = value(await start());
    expect(run.status).toBe("completed");
    expect(run.flows.map((f) => f.failure)).toEqual([
      undefined,
      "timed-out",
      undefined,
      "app-crashed",
      undefined,
    ]);
    expect(run.flows[3]?.crashReport).toBe("x/crash.txt");
  });

  it("notes a black failure screenshot (RES-5)", async () => {
    const { flowRunner, start } = setup([flow("a")]);
    const screenshot = join(folder, "shot.png");
    await writeFile(screenshot, blackPng());
    flowRunner.set(flow("a").file, { status: "failed", screenshot });
    const run = value(await start());
    expect(run.flows[0]).toMatchObject({
      blackScreenshot: true,
      screenshot: "shot.png",
    });
  });

  it("writes the report index when given words for it (RES-6)", async () => {
    const { start } = setup([flow("a")]);
    const text = {
      title: "Report",
      flow: "Flow",
      status: "Status",
      duration: "Duration",
      reason: "Reason",
      apk: "APK",
      device: "Device",
      started: "Started",
      openReport: "Maestro report",
      runStatus: {
        running: "Running",
        completed: "Completed",
        cancelled: "Cancelled",
        stopped: "Stopped",
        interrupted: "Interrupted",
      },
      flowStatus: {
        waiting: "Waiting",
        running: "Running",
        passed: "Passed",
        failed: "Failed",
        cancelled: "Cancelled",
        "not-run": "Not run",
      },
      failure: {
        step: "Step failed",
        "timed-out": "Timed out",
        "app-crashed": "App crashed",
        "app-not-responding": "App not responding",
        "device-disconnected": "Device disconnected",
        error: "Error",
      },
    };
    await start({ reportText: text });
    expect(await readFile(join(folder, "index.html"), "utf8")).toContain(
      "Completed",
    );
  });
});

describe("executeRun when cancelled (RUN-9)", () => {
  it("keeps finished results and marks the current and remaining flows Cancelled", async () => {
    const { flowRunner, controller, start } = setup();
    flowRunner.during = (request) => {
      if (request.flowFile.endsWith("c.yaml")) controller.abort();
    };
    const run = value(await start());
    expect(run.status).toBe("cancelled");
    expect(statuses(run)).toEqual([
      "passed",
      "passed",
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
    expect((await loadRun(folder))?.status).toBe("cancelled");
  });

  it("cancels before the first flow", async () => {
    const { bridge, controller, start } = setup();
    bridge.failNext.set("install", { code: "CANCELLED" });
    controller.abort();
    const run = value(await start());
    expect(run.status).toBe("cancelled");
    expect(statuses(run)).toEqual(Array.from({ length: 5 }, () => "cancelled"));
  });
});

describe("executeRun with a device problem (DEV-4, DEV-9, RUN-12)", () => {
  it("starts an emulator that is off and runs on it", async () => {
    const off: Device = {
      id: "avd:Pixel_8",
      kind: "emulator",
      state: "emulator-off",
      name: "Pixel_8",
    };
    const { events, flowRunner, start } = setup([flow("a")], [off]);
    const run = value(await start());
    expect(events.some((e) => e.type === "starting-emulator")).toBe(true);
    expect(run.device.id).toBe("emulator-5554");
    expect(flowRunner.requests[0]?.deviceId).toBe("emulator-5554");
  });

  it("ends cleanly when the phone is unplugged during a flow", async () => {
    const phone: Device = {
      id: "R58N12ABCDE",
      kind: "phone",
      state: "phone-ready",
      name: "SM A525F",
    };
    const { bridge, flowRunner, start } = setup(FIVE, [phone]);
    flowRunner.during = (request) => {
      if (request.flowFile.endsWith("b.yaml")) bridge.setDevices([]);
    };
    const run = value(await start());
    expect(run.status).toBe("stopped");
    expect(run.stopReason).toEqual({
      code: "DEVICE_NOT_FOUND",
      deviceId: "R58N12ABCDE",
    });
    expect(statuses(run)).toEqual([
      "passed",
      "failed",
      "not-run",
      "not-run",
      "not-run",
    ]);
    expect(run.flows[1]?.failure).toBe("device-disconnected");
    expect(flowRunner.requests).toHaveLength(2);
  });

  it("finds a phone that dropped out when a flow fails", async () => {
    const phone: Device = {
      id: "R58N12ABCDE",
      kind: "phone",
      state: "phone-ready",
      name: "SM A525F",
    };
    const { bridge, flowRunner, start } = setup(FIVE, [phone]);
    // The watcher has not noticed yet, but the list no longer has the phone.
    bridge.watch = () => () => undefined;
    flowRunner.during = (request) => {
      if (request.flowFile.endsWith("a.yaml"))
        bridge.setDevices([{ ...phone, state: "phone-not-responding" }]);
    };
    flowRunner.set(FIVE[0]?.file ?? "", {
      status: "failed",
      reason: "connection closed",
    });
    const run = value(await start());
    expect(run.status).toBe("stopped");
    expect(run.flows[0]?.failure).toBe("device-disconnected");
  });

  it("stops before any flow for a phone that has not accepted USB debugging", async () => {
    const phone: Device = {
      id: "R58N12ABCDE",
      kind: "phone",
      state: "phone-not-authorised",
      name: "SM A525F",
    };
    const { flowRunner, start } = setup([flow("a")], [phone]);
    const run = value(await start());
    expect(run.status).toBe("stopped");
    expect(run.stopReason).toEqual({
      code: "DEVICE_NOT_AUTHORISED",
      deviceId: "R58N12ABCDE",
    });
    expect(statuses(run)).toEqual(["not-run"]);
    expect(flowRunner.requests).toEqual([]);
  });

  it("stops when the user keeps an app signed with another key (RUN-3)", async () => {
    const { bridge, declineUninstall, start } = setup([flow("a")]);
    bridge.installOutcome = "signature-mismatch";
    declineUninstall();
    const run = value(await start());
    expect(run.status).toBe("stopped");
    expect(run.stopReason).toEqual({
      code: "INSTALL_SIGNATURE_MISMATCH",
      packageName: "dev.jagra.sample",
    });
    expect(bridge.calls.some((c) => c.call === "uninstall")).toBe(false);
  });
});

/** A 4 by 4 black PNG. */
function blackPng(): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.from([0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 0, 0, 0]);
  const rows = Buffer.alloc(4 * (1 + 4 * 3));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The run's records in state/active.json, in memory. */
class MemoryRunState implements RunStateStore {
  readonly ports = new Map<number, number>();
  reverse: ReverseRecord[] = [];
  readonly added: ReverseRecord[] = [];

  setPort(pid: number, port: number): Promise<void> {
    this.ports.set(pid, port);
    return Promise.resolve();
  }
  addReverse(record: ReverseRecord): Promise<void> {
    this.reverse.push(record);
    this.added.push(record);
    return Promise.resolve();
  }
  removeReverse(record: ReverseRecord): Promise<void> {
    this.reverse = this.reverse.filter(
      (r) => r.deviceId !== record.deviceId || r.port !== record.port,
    );
    return Promise.resolve();
  }
  listReverse(): Promise<ReverseRecord[]> {
    return Promise.resolve(this.reverse);
  }
}

describe("executeRun with Mockoon (MCK-2, MCK-4, MCK-5)", () => {
  const MOCKOON = { file: "/project/.jagra/mockoon.json", port: 3000 };

  it("starts Mockoon after installing, adds the reverse rule, and removes both at the end", async () => {
    const { bridge, mockServer, state, flowRunner, start } = setup([flow("a")]);
    let during: { running: boolean; rules: number } | undefined;
    flowRunner.during = () => {
      during = {
        running: mockServer.running.has(3000),
        rules: state.reverse.length,
      };
    };
    const run = value(await start({ mockoon: MOCKOON }));

    expect(run.status).toBe("completed");
    expect(during).toEqual({ running: true, rules: 1 });
    expect(mockServer.requests[0]).toMatchObject(MOCKOON);
    const calls = bridge.calls
      .map((c) => c.call)
      .filter((c) => c !== "bootState");
    expect(calls).toEqual([
      "androidVersion",
      "install",
      "addReverse",
      "clearAppData",
      "removeReverse",
    ]);
    expect(mockServer.running.size).toBe(0);
    expect(state.reverse).toEqual([]);
    expect(state.added).toEqual([
      { deviceId: "emulator-5554", port: 3000, owner: process.pid },
    ]);
    expect(state.ports.get(7000)).toBe(3000);
  });

  it("stops Mockoon and removes the rule when cancelled", async () => {
    const { bridge, controller, flowRunner, mockServer, state, start } =
      setup();
    flowRunner.during = (request) => {
      if (request.flowFile.endsWith("b.yaml")) controller.abort();
    };
    const run = value(await start({ mockoon: MOCKOON }));
    expect(run.status).toBe("cancelled");
    expect(mockServer.running.size).toBe(0);
    expect(state.reverse).toEqual([]);
    expect(bridge.calls.some((c) => c.call === "removeReverse")).toBe(true);
  });

  it("stops Mockoon when the phone is lost", async () => {
    const phone: Device = {
      id: "R58",
      kind: "phone",
      state: "phone-ready",
      name: "SM A525F",
    };
    const { bridge, flowRunner, mockServer, state, start } = setup(FIVE, [
      phone,
    ]);
    flowRunner.during = () => bridge.setDevices([]);
    const run = value(await start({ mockoon: MOCKOON }));
    expect(run.status).toBe("stopped");
    expect(mockServer.running.size).toBe(0);
    expect(state.reverse).toEqual([]);
  });

  it("stops the run when Mockoon does not start, before any flow", async () => {
    const { bridge, flowRunner, mockServer, start } = setup([flow("a")]);
    mockServer.failure = { code: "MOCKOON_NOT_READY", port: 3000, seconds: 30 };
    const run = value(await start({ mockoon: MOCKOON }));
    expect(run.status).toBe("stopped");
    expect(run.stopReason).toEqual({
      code: "MOCKOON_NOT_READY",
      port: 3000,
      seconds: 30,
    });
    expect(flowRunner.requests).toEqual([]);
    expect(bridge.calls.some((c) => c.call === "addReverse")).toBe(false);
  });

  it("stops Mockoon when the reverse rule cannot be added", async () => {
    const { bridge, mockServer, state, start } = setup([flow("a")]);
    bridge.failNext.set("addReverse", {
      code: "ADB_FAILED",
      command: "reverse",
      detail: "x",
    });
    const run = value(await start({ mockoon: MOCKOON }));
    expect(run.status).toBe("stopped");
    expect(mockServer.running.size).toBe(0);
    expect(state.reverse).toEqual([]);
  });

  it("keeps Mockoon's log in the run folder, masked (D-64)", async () => {
    const { mockServer, start } = setup([flow("a", ["PASSWORD"])]);
    mockServer.lines = [
      '{"message":"Server started on port 3000"}',
      '{"body":"password=hunter2"}',
    ];
    await start({ mockoon: MOCKOON, values: { PASSWORD: "hunter2" } });
    const log = await readFile(join(folder, "mockoon.log"), "utf8");
    expect(log).toContain("Server started on port 3000");
    expect(log).toContain("password=***");
    expect(log).not.toContain("hunter2");
  });

  it("runs without Mockoon when the project has none", async () => {
    const { bridge, mockServer, start } = setup([flow("a")]);
    await start();
    expect(mockServer.requests).toEqual([]);
    expect(bridge.calls.some((c) => c.call === "addReverse")).toBe(false);
  });
});
