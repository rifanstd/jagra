import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { CliAgent } from "../adapters/agents/cli-agent.js";
import { detectAgents } from "../adapters/agents/find.js";
import { NodeProcessRunner } from "../adapters/process/node-process-runner.js";
import type { ActiveProcessRecord } from "../process/active-processes.js";
import { askForFlow } from "./ask.js";

const SAMPLE = fileURLToPath(
  new URL("../../../../sample-app", import.meta.url),
);

// M10 part 3 with the real Claude Code on a copy of the sample app: the instructions, the report
// and the session. Uses one request of the user's Claude Code. Not run in CI.
it("asks Claude Code for a flow on the sample app", async () => {
  const records: ActiveProcessRecord[] = [];
  const runner = new NodeProcessRunner({
    store: {
      add: (record) => Promise.resolve(void records.push(record)),
      remove: () => Promise.resolve(),
      list: () => Promise.resolve(records),
    },
  });
  const claude = (await detectAgents({ runner })).find(
    (agent) => agent.id === "claude-code",
  )?.path;
  if (!claude) throw new Error("Claude Code is not installed");
  const root = await mkdtemp(join(tmpdir(), "jagra-ask-real-"));
  const folder = join(root, "sample-app");
  try {
    await cp(SAMPLE, folder, {
      recursive: true,
      filter: (path) => !/[\\/](build|\.gradle)([\\/]|$)/.test(path),
    });
    const outcome = await askForFlow(
      {
        client: new CliAgent({
          runner,
          agent: { kind: "claude-code", program: claude },
        }),
        agent: "claude-code",
        agentName: "Claude Code",
      },
      {
        appData: join(root, "data"),
        projectId: "p1",
        folder,
        scenario: "log in with a wrong password, an error must appear",
        appId: "dev.jagra.sample",
      },
    );
    console.log(JSON.stringify(outcome, null, 2));
    if (!outcome.ok) throw new Error(outcome.error.code);
    expect(outcome.value.report).toBeDefined();
    const flow = outcome.value.session.flow;
    expect(flow).toBeDefined();
    const text = await readFile(
      join(folder, ".jagra", "flows", flow ?? ""),
      "utf8",
    );
    console.log(text);
    expect(text).toContain("clearState: true");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 600_000);
