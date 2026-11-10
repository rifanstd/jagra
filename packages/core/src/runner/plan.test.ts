import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flowsFolder } from "../project/flows.js";
import { planRun } from "./plan.js";

let project: string;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "jagra-plan-"));
  await mkdir(join(flowsFolder(project), "parts"), { recursive: true });
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

const write = (path: string, text: string) =>
  writeFile(join(flowsFolder(project), path), text);
const flow = (steps: string) => `appId: dev.jagra.sample\n---\n${steps}\n`;
const secrets =
  (values: Record<string, string>) =>
  (name: string): Promise<string | undefined> =>
    Promise.resolve(values[name]);

describe("planRun (spec section 7, step 1)", () => {
  it("takes every flow that can run, in file name order", async () => {
    await write("b.yaml", flow("- launchApp"));
    await write("a.yaml", flow("- launchApp"));
    await write("broken.yaml", "appId: x\n---\n- [unclosed\n");
    const plan = await planRun({ projectFolder: project, secret: secrets({}) });
    if (!plan.ok) throw new Error(JSON.stringify(plan.error));
    expect(plan.value.flows.map((f) => basename(f.file))).toEqual([
      "a.yaml",
      "b.yaml",
    ]);
    expect(plan.value.skipped.map((f) => basename(f.file))).toEqual([
      "broken.yaml",
    ]);
  });

  it("takes only the chosen flows (RUN-2)", async () => {
    await write("a.yaml", flow("- launchApp"));
    await write("b.yaml", flow("- launchApp"));
    const plan = await planRun({
      projectFolder: project,
      chosen: ["b.yaml"],
      secret: secrets({}),
    });
    expect(plan.ok && plan.value.flows.map((f) => basename(f.file))).toEqual([
      "b.yaml",
    ]);
  });

  it("finds the variables of each flow and its helpers, and their values (RUN-10)", async () => {
    await write("parts/login.yaml", flow("- inputText: ${PASSWORD}"));
    await write(
      "a.yaml",
      flow(
        "- runFlow: parts/login.yaml\n- inputText: ${USER}\n- inputText: ${MAESTRO_FILENAME}",
      ),
    );
    await write("b.yaml", flow("- launchApp"));
    const plan = await planRun({
      projectFolder: project,
      secret: secrets({ PASSWORD: "hunter2", USER: "demo", UNUSED: "x" }),
    });
    if (!plan.ok) throw new Error(JSON.stringify(plan.error));
    const [a, b] = plan.value.flows;
    expect(plan.value.needs[a?.file ?? ""]).toEqual(["PASSWORD", "USER"]);
    expect(plan.value.needs[b?.file ?? ""]).toEqual([]);
    expect(plan.value.values).toEqual({ PASSWORD: "hunter2", USER: "demo" });
  });

  it("refuses to start when a variable has no value", async () => {
    await write(
      "a.yaml",
      flow("- inputText: ${PASSWORD}\n- inputText: ${TOKEN}"),
    );
    expect(
      await planRun({
        projectFolder: project,
        secret: secrets({ TOKEN: "t" }),
      }),
    ).toEqual({
      ok: false,
      error: { code: "SECRETS_MISSING", names: ["PASSWORD"] },
    });
  });

  it("refuses to start with no flow to run", async () => {
    expect(
      await planRun({ projectFolder: project, secret: secrets({}) }),
    ).toEqual({
      ok: false,
      error: { code: "NO_FLOWS" },
    });
  });
});
