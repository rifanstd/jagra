import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseNetstat } from "../adapters/process/node-process-control.js";
import { FakeDeviceBridge } from "../fakes/devices.js";
import type { ProcessControl } from "../ports/process-control.js";
import { ActiveProcessFile } from "./active-processes.js";
import { cleanUpLeftovers } from "./cleanup.js";

let dir: string;
let store: ActiveProcessFile;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jagra-cleanup-"));
  store = new ActiveProcessFile(join(dir, "state", "active.json"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const DEAD_JAGRA = 999_001;
const LIVE_JAGRA = 999_002;

/** Processes that are alive, and who listens on which port. */
class FakeControl implements ProcessControl {
  readonly alive = new Set<number>([LIVE_JAGRA]);
  readonly listening = new Map<number, number[]>();
  readonly killed: number[] = [];

  isAlive(pid: number): boolean {
    return this.alive.has(pid);
  }
  listeningPids(port: number): Promise<number[]> {
    return Promise.resolve(this.listening.get(port) ?? []);
  }
  kill(pid: number): Promise<void> {
    this.killed.push(pid);
    this.alive.delete(pid);
    return Promise.resolve();
  }
}

const record = (pid: number, owner: number, port?: number) => ({
  pid,
  program: "node",
  startedAt: "2026-11-10T10:00:00.000Z",
  owner,
  ...(port === undefined ? {} : { port }),
});

describe("cleanUpLeftovers (REL-2, MCK-5, D-63)", () => {
  it("stops a leftover Mockoon that still listens on its port and removes its reverse rule", async () => {
    const control = new FakeControl();
    control.alive.add(4100);
    control.listening.set(3000, [4100]);
    const bridge = new FakeDeviceBridge();
    bridge.setDevices([
      {
        id: "emulator-5554",
        kind: "emulator",
        state: "emulator-running",
        name: "Pixel_8",
      },
    ]);
    await store.add(record(4100, DEAD_JAGRA, 3000));
    await store.add(record(4200, DEAD_JAGRA));
    await store.addReverse({
      deviceId: "emulator-5554",
      port: 3000,
      owner: DEAD_JAGRA,
    });

    const left = await cleanUpLeftovers({ store, control, bridge });

    expect(left).toEqual({
      stopped: [4100],
      reverse: ["emulator-5554 tcp:3000"],
    });
    expect(control.killed).toEqual([4100]);
    expect(bridge.calls).toContainEqual({
      call: "removeReverse",
      deviceId: "emulator-5554",
      port: 3000,
    });
    expect(await store.list()).toEqual([]);
    expect(await store.listReverse()).toEqual([]);
  });

  it("never stops a process that took over the pid but not the port", async () => {
    const control = new FakeControl();
    control.alive.add(4100);
    control.listening.set(3000, [5555]);
    await store.add(record(4100, DEAD_JAGRA, 3000));
    expect((await cleanUpLeftovers({ store, control })).stopped).toEqual([]);
    expect(control.killed).toEqual([]);
    expect(await store.list()).toEqual([]);
  });

  it("leaves everything of a Jagra that is still running", async () => {
    const control = new FakeControl();
    control.alive.add(4100);
    control.listening.set(3000, [4100]);
    await store.add(record(4100, LIVE_JAGRA, 3000));
    await store.addReverse({
      deviceId: "emulator-5554",
      port: 3000,
      owner: LIVE_JAGRA,
    });
    expect(await cleanUpLeftovers({ store, control })).toEqual({
      stopped: [],
      reverse: [],
    });
    expect(await store.list()).toHaveLength(1);
    expect(await store.listReverse()).toHaveLength(1);
  });

  it("forgets a rule whose device is gone", async () => {
    const control = new FakeControl();
    const bridge = new FakeDeviceBridge();
    await store.addReverse({ deviceId: "R58", port: 3000, owner: DEAD_JAGRA });
    expect(
      (await cleanUpLeftovers({ store, control, bridge })).reverse,
    ).toEqual(["R58 tcp:3000"]);
    expect(await store.listReverse()).toEqual([]);
  });
});

describe("ActiveProcessFile records for a run", () => {
  it("notes a port and keeps reverse rules apart from processes", async () => {
    await store.add(record(4100, DEAD_JAGRA));
    await store.setPort(4100, 3000);
    await store.addReverse({ deviceId: "a", port: 3000, owner: 1 });
    await store.addReverse({ deviceId: "a", port: 3000, owner: 1 });
    expect((await store.list())[0]?.port).toBe(3000);
    expect(await store.listReverse()).toEqual([
      { deviceId: "a", port: 3000, owner: 1 },
    ]);
  });
});

describe("parseNetstat", () => {
  // Real `netstat -ano -p TCP` lines, 2026-11-10, with Mockoon on 127.0.0.1:3000 and 0.0.0.0:3000.
  const lines = [
    "Active Connections",
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       8584",
    "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12320",
    "  TCP    127.0.0.1:30000        0.0.0.0:0              LISTENING       77",
    "  TCP    127.0.0.1:52144        127.0.0.1:3000         ESTABLISHED     900",
    "  TCP    [::]:3000              [::]:0                 LISTENING       4444",
  ];

  it("finds every process listening on the port, and nothing else", () => {
    expect(parseNetstat(lines, 3000)).toEqual([8584, 12320, 4444]);
  });
});
