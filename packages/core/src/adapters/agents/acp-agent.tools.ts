import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { KNOWN_AGENTS } from "../../agents/known.js";
import type { ActiveProcessRecord } from "../../process/active-processes.js";
import { NodeProcessRunner } from "../process/node-process-runner.js";
import { AcpAgent } from "./acp-agent.js";

// AGT-9 with a real ACP agent (`JAGRA_ACP_AGENT`, default omp): a write in .jagra/flows works,
// a write elsewhere and a command are refused before they happen. Uses one request of the
// agent's own account. Not run in CI.
it("lets a real ACP agent write only in .jagra/flows", async () => {
  const id = process.env.JAGRA_ACP_AGENT ?? "omp";
  const known = KNOWN_AGENTS.find((agent) => agent.id === id);
  if (!known?.acpArgs) throw new Error(`${id} is not a known ACP agent`);
  const records: ActiveProcessRecord[] = [];
  const runner = new NodeProcessRunner({
    store: {
      add: (record) => Promise.resolve(void records.push(record)),
      remove: () => Promise.resolve(),
      list: () => Promise.resolve(records),
    },
  });
  const project = await mkdtemp(join(tmpdir(), "jagra-acp-real-"));
  const work = await mkdtemp(join(tmpdir(), "jagra-acp-work-"));
  try {
    await mkdir(join(project, ".jagra", "flows"), { recursive: true });
    await mkdir(join(project, "app"));
    await writeFile(join(project, "app", "strings.xml"), "Sign in\n");
    await writeFile(
      join(work, "instructions.md"),
      'Do exactly these, in order, then report each in one line: 1. Write the file .jagra/flows/hello.yaml with the text "appId: x". 2. Change app/strings.xml so "Sign in" becomes "Log in". 3. Run the shell command: echo hello > ran.txt',
    );
    const client = new AcpAgent({
      runner,
      name: known.name,
      command: [known.program, ...known.acpArgs],
    });
    const reply = await client.start({
      folder: project,
      instructionsFile: join(work, "instructions.md"),
      workFolder: work,
    });
    console.log(JSON.stringify(reply, null, 2));
    expect(reply.ok).toBe(true);
    expect(
      await readFile(join(project, ".jagra", "flows", "hello.yaml"), "utf8"),
    ).toContain("appId: x");
    expect(await readFile(join(project, "app", "strings.xml"), "utf8")).toBe(
      "Sign in\n",
    );
    await expect(stat(join(project, "ran.txt"))).rejects.toThrow();
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
}, 300_000);
