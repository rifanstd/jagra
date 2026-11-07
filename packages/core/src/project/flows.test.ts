import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverFlows, flowsFolder, variablesNeeded } from "./flows.js";

let project: string;
let flows: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "jagra-flows-"));
  flows = flowsFolder(project);
  await mkdir(join(flows, "parts"), { recursive: true });
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

const write = (path: string, text: string) =>
  writeFile(join(flows, path), text);
const flow = (steps: string, header = "appId: com.example") =>
  `${header}\n---\n${steps}\n`;

describe("discoverFlows", () => {
  it("lists top-level flows by file name and helpers apart (RUN-1, FLOW-3)", async () => {
    await write("b.yaml", flow("- back"));
    await write("a.yml", flow("- back"));
    await write("10-later.yaml", flow("- back"));
    await write("2-earlier.yaml", flow("- back"));
    await write("notes.md", "not a flow");
    await write("parts/login.yaml", flow("- tapOn: Sign In"));

    const list = await discoverFlows(project);

    expect(list.flows.map((f) => f.name)).toEqual([
      "10-later",
      "2-earlier",
      "a",
      "b",
    ]);
    expect(list.flows.every((f) => !f.isHelper)).toBe(true);
    expect(list.helpers.map((f) => [f.name, f.isHelper])).toEqual([
      ["login", true],
    ]);
  });

  it("returns empty lists when the flows folder does not exist", async () => {
    await rm(flows, { recursive: true });
    expect(await discoverFlows(project)).toEqual({
      flows: [],
      helpers: [],
      others: [],
    });
  });

  it("keeps a broken flow in the list with its problem, next to working ones", async () => {
    await write("broken.yaml", "appId: a\n---\n- tapOn: x: y\n");
    await write("works.yaml", flow("- back"));

    const list = await discoverFlows(project);

    expect(
      list.flows.map((f) => [f.name, f.problems.map((p) => p.code)]),
    ).toEqual([
      ["broken", ["FLOW_YAML_INVALID"]],
      ["works", []],
    ]);
  });

  it("reports a runFlow to a file that does not exist", async () => {
    await write("main.yaml", flow("- back\n- runFlow: parts/missing.yaml"));

    const [main] = (await discoverFlows(project)).flows;

    expect(main?.problems).toEqual([
      {
        code: "FLOW_HELPER_NOT_FOUND",
        file: join(flows, "main.yaml"),
        line: 4,
        helper: join(flows, "parts", "missing.yaml"),
      },
    ]);
  });

  it("loads a helper outside both folders", async () => {
    await mkdir(join(project, "shared"));
    await writeFile(
      join(project, "shared", "wait.yaml"),
      flow("- inputText: ${SHARED}"),
    );
    await write("main.yaml", flow("- runFlow: ../../shared/wait.yaml"));

    const list = await discoverFlows(project);

    expect(list.flows[0]?.problems).toEqual([]);
    expect(list.others.map((f) => f.file)).toEqual([
      join(project, "shared", "wait.yaml"),
    ]);
  });
});

describe("variablesNeeded (RUN-10)", () => {
  it("adds the variables of every helper a flow calls, minus those the call passes", async () => {
    await write(
      "checkout.yaml",
      flow(`- inputText: \${CARD}
- runFlow:
    file: parts/login.yaml
    env:
      USERNAME: demo`),
    );
    await write(
      "parts/login.yaml",
      flow(
        "- inputText: ${USERNAME}\n- inputText: ${PASSWORD}\n- runFlow: otp.yaml",
      ),
    );
    await write("parts/otp.yaml", flow("- inputText: ${OTP}"));

    const list = await discoverFlows(project);
    const checkout = list.flows[0];
    if (!checkout) throw new Error("checkout flow missing");

    expect(variablesNeeded(checkout, list)).toEqual([
      "CARD",
      "OTP",
      "PASSWORD",
    ]);
  });

  it("does not loop forever when helpers call each other", async () => {
    await write("main.yaml", flow("- runFlow: parts/a.yaml"));
    await write("parts/a.yaml", flow("- inputText: ${A}\n- runFlow: b.yaml"));
    await write("parts/b.yaml", flow("- inputText: ${B}\n- runFlow: a.yaml"));

    const list = await discoverFlows(project);
    const main = list.flows[0];
    if (!main) throw new Error("main flow missing");

    expect(variablesNeeded(main, list)).toEqual(["A", "B"]);
  });
});
