import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkEnvironment } from "../../environment/check.js";
import type { ActiveProcessRecord } from "../../process/active-processes.js";
import { NodeProcessRunner } from "../process/node-process-runner.js";
import { NodeToolProbe } from "../tools/node-tool-probe.js";
import { MaestroSyntaxChecker } from "./maestro-syntax-checker.js";

// D-98: what the real `maestro check-syntax` on this machine says about a few flows.
it("reads the real Maestro's verdicts", async () => {
  const records: ActiveProcessRecord[] = [];
  const runner = new NodeProcessRunner({
    store: {
      add: (record) => Promise.resolve(void records.push(record)),
      remove: () => Promise.resolve(),
      list: () => Promise.resolve(records),
    },
  });
  const statuses = await checkEnvironment(new NodeToolProbe({ runner }));
  const maestro = statuses.find((s) => s.tool === "maestro")?.path;
  if (!maestro) throw new Error("Maestro was not found on this machine");
  const checker = new MaestroSyntaxChecker({ runner, maestro });

  const folder = await mkdtemp(join(tmpdir(), "jagra-syntax-"));
  const flows = {
    "good.yaml": "appId: com.x\n---\n- launchApp\n- tapOn: Save\n",
    "typo.yaml": "appId: com.x\n---\n- launchApp\n- tapOnn: Save\n",
    "property.yaml": "appId: com.x\n---\n- tapOn:\n    idd: save\n",
  };
  try {
    const verdicts = await Promise.all(
      Object.entries(flows).map(async ([name, text]) => {
        await writeFile(join(folder, name), text);
        return checker.check(join(folder, name));
      }),
    );
    console.log(JSON.stringify(verdicts, null, 2));
    expect(verdicts).toEqual([
      { ok: true, value: { accepted: true } },
      {
        ok: true,
        value: { accepted: false, message: "Invalid Command: tapOnn", line: 4 },
      },
      {
        ok: true,
        value: { accepted: false, message: "Unknown Property: idd" },
      },
    ]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}, 120_000);
