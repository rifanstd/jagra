import { expect, it } from "vitest";
import { NodeProcessRunner } from "../adapters/process/node-process-runner.js";
import { NodeToolProbe } from "../adapters/tools/node-tool-probe.js";
import type { ActiveProcessRecord } from "../process/active-processes.js";
import type { ToolStatus } from "../types/index.js";
import { checkEnvironment } from "./check.js";

// M2 "Done when": print every tool's state on this machine, in under 5 seconds (ENV-1).
it("checks the tools on this machine in under 5 seconds", async () => {
  const records: ActiveProcessRecord[] = [];
  const runner = new NodeProcessRunner({
    store: {
      add: (record) => Promise.resolve(void records.push(record)),
      remove: () => Promise.resolve(),
      list: () => Promise.resolve(records),
    },
  });

  const started = performance.now();
  const statuses = await checkEnvironment(new NodeToolProbe({ runner }));
  const elapsed = Math.round(performance.now() - started);

  console.log([...statuses.map(row), `\nChecked in ${elapsed} ms`].join("\n"));
  expect(elapsed).toBeLessThan(5000);
}, 30_000);

function row(s: ToolStatus): string {
  const state = s.problem ? `${s.state} (${s.problem})` : s.state;
  return [
    s.tool.padEnd(9),
    state.padEnd(24),
    (s.version ?? "").padEnd(12),
    s.path ?? (s.required ? "" : "optional"),
  ].join(" ");
}
