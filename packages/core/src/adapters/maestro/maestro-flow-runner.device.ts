import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { NodeProcessRunner } from "../process/node-process-runner.js";
import { NodeToolProbe } from "../tools/node-tool-probe.js";
import type { ActiveProcessRecord } from "../../process/active-processes.js";
import { MaestroFlowRunner } from "./maestro-flow-runner.js";

const FLOWS = fileURLToPath(
  new URL("../../../../../sample-app/.jagra/flows", import.meta.url),
);

// Runs sample flows on the running emulator, with the sample APK already installed.
// `pnpm --filter @jagra/core test:device maestro`
it("runs a passing flow, the planted bug and a flow with a secret", async () => {
  const records: ActiveProcessRecord[] = [];
  const runner = new NodeProcessRunner({
    store: {
      add: (r) => Promise.resolve(void records.push(r)),
      remove: () => Promise.resolve(),
      list: () => Promise.resolve(records),
    },
  });
  const maestro = await new NodeToolProbe({ runner }).probe("maestro", {
    paths: {},
  });
  if (!maestro.found) throw new Error("Maestro is needed");
  const flows = new MaestroFlowRunner({ runner, maestro: maestro.path });
  const out = await mkdtemp(join(tmpdir(), "jagra-maestro-"));
  const base = {
    deviceId: "emulator-5554",
    appId: "dev.jagra.sample",
    timeoutMs: 180_000,
  };

  const run = async (
    file: string,
    name: string,
    variables: Record<string, string> = {},
  ) => {
    const steps: string[] = [];
    const started = performance.now();
    const result = await flows.run({
      ...base,
      flowFile: join(FLOWS, file),
      name,
      variables,
      outputDir: join(out, file),
      onStep: (s) => steps.push(s),
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(
      file,
      `${seconds}s`,
      JSON.stringify(result),
      "\nsteps:",
      steps.join(" | "),
    );
    return result;
  };

  const passed = await run(
    "item-detail.yaml",
    "Opening an item shows its detail",
  );
  expect(passed.ok && passed.value.status).toBe("passed");

  const failed = await run("save-item.yaml", "Renaming an item and saving it");
  expect(failed.ok && failed.value.status).toBe("failed");
  expect(failed.ok && failed.value.reason).toContain("Save");

  // login-works.yaml calls parts/login.yaml; a value passed as a variable must not leak.
  const secret = await run(
    "login-works.yaml",
    "Signing in with the demo account",
    {
      JAGRA_TEST_SECRET: "s3cr3t-value-123",
    },
  );
  expect(secret.ok && secret.value.status).toBe("passed");
  for (const entry of await readdir(join(out, "login-works.yaml"), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || entry.name.endsWith(".png")) continue;
    const text = await readFile(join(entry.parentPath, entry.name), "utf8");
    expect(text, entry.name).not.toContain("s3cr3t-value-123");
  }
  console.log("output in", out);
}, 600_000);
