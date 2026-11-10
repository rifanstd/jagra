import type { DeviceBridge } from "../ports/device-bridge.js";
import type { ProcessControl } from "../ports/process-control.js";
import type { ActiveProcessStore, RunStateStore } from "./active-processes.js";

export interface Leftovers {
  /** Mockoon processes that were stopped. */
  stopped: number[];
  /** Reverse rules that were removed, as `<device> tcp:<port>`. */
  reverse: string[];
}

/**
 * After a crash, stops what a Jagra that is gone left behind (REL-2, MCK-5): a Mockoon process is
 * stopped only while it still listens on the port it was started with, since pids get reused
 * (D-63). Other leftover processes, such as Maestro, end on their own and are only forgotten.
 * Reverse rules are removed. Records of a Jagra that is still running are left alone.
 */
export async function cleanUpLeftovers(options: {
  store: ActiveProcessStore & RunStateStore;
  control: ProcessControl;
  bridge?: DeviceBridge;
}): Promise<Leftovers> {
  const { store, control, bridge } = options;
  const gone = (owner: number | undefined) =>
    owner === undefined || (owner !== process.pid && !control.isAlive(owner));
  const left: Leftovers = { stopped: [], reverse: [] };

  for (const record of await store.list()) {
    if (!gone(record.owner)) continue;
    if (
      record.port !== undefined &&
      control.isAlive(record.pid) &&
      (await control.listeningPids(record.port)).includes(record.pid)
    ) {
      await control.kill(record.pid);
      left.stopped.push(record.pid);
    }
    await store.remove(record.pid);
  }

  for (const rule of await store.listReverse()) {
    if (!gone(rule.owner)) continue;
    // A device that is no longer connected lost the rule already.
    if (bridge) await bridge.removeReverse(rule.deviceId, rule.port);
    await store.removeReverse(rule);
    left.reverse.push(`${rule.deviceId} tcp:${rule.port}`);
  }
  return left;
}
