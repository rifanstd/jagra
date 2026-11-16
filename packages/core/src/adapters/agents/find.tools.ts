import { expect, it } from "vitest";
import type { ActiveProcessRecord } from "../../process/active-processes.js";
import { NodeProcessRunner } from "../process/node-process-runner.js";
import { currentMachine } from "../tools/machine.js";
import { agentLaunch, findAgents } from "./find.js";

// AGT-1, D-104: which agents this machine has, and each one answers --version without a shell.
it("finds the agents on this machine and starts each one", async () => {
  const records: ActiveProcessRecord[] = [];
  const runner = new NodeProcessRunner({
    store: {
      add: (record) => Promise.resolve(void records.push(record)),
      remove: () => Promise.resolve(),
      list: () => Promise.resolve(records),
    },
  });
  const machine = await currentMachine({ runner });
  for (const agent of findAgents(machine)) {
    if (!agent.path) {
      console.log(`${agent.id.padEnd(12)} not installed`);
      continue;
    }
    const launch = agentLaunch(agent.path, ["--version"], machine);
    if (!launch.ok) throw new Error(`${agent.id}: ${launch.problem}`);
    const lines: string[] = [];
    const started = await runner.start(launch.spec, (line) =>
      lines.push(line.text),
    );
    if (!started.ok) throw new Error(`${agent.id}: ${started.error.code}`);
    const exit = await started.value.exited;
    console.log(
      `${agent.id.padEnd(12)} ${launch.spec.program} -> ${lines.join(" ").trim()}`,
    );
    expect(exit.code).toBe(0);
  }
}, 60_000);
