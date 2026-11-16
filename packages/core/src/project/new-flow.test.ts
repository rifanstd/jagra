import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFlow } from "./flow.js";
import { createFlow, flowFileName, flowTemplate } from "./new-flow.js";

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "jagra-new-flow-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("flowFileName (FLOW-4)", () => {
  it.each([
    ["Login wrong password", "login-wrong-password.yaml"],
    ["  Simpan   item  ", "simpan-item.yaml"],
    ["Café order: 2 items!", "cafe-order-2-items.yaml"],
    ["save-item", "save-item.yaml"],
    ["???", undefined],
    ["", undefined],
  ])("%j gives %j", (name, file) => {
    expect(flowFileName(name)).toBe(file);
  });
});

describe("flowTemplate (FLOW-4)", () => {
  it("is the template of the spec", () => {
    expect(flowTemplate("com.company.appa", "Login wrong password")).toBe(
      [
        "appId: com.company.appa",
        "name: Login wrong password",
        "properties:",
        "  condition: success",
        "---",
        "- launchApp:",
        "    clearState: true",
        "# Write the steps of this test below.",
        "",
      ].join("\n"),
    );
  });

  it("keeps a name with YAML characters intact, and parses as a valid flow (FLOW-1)", () => {
    const text = flowTemplate("com.shop", 'Order: #1 "fast"');
    const flow = parseFlow(text, "/p/.jagra/flows/order.yaml", false);
    expect(flow.problems).toEqual([]);
    expect(flow.name).toBe('Order: #1 "fast"');
    expect(flow.appId).toBe("com.shop");
    expect(flow.steps.map((s) => s.command)).toEqual(["launchApp"]);
  });
});

describe("createFlow (FLOW-4, PRJ-11)", () => {
  it("writes the template into .jagra/flows and nothing else", async () => {
    const created = await createFlow(folder, "Login works", "com.shop");
    expect(created).toEqual({
      ok: true,
      value: { file: join(folder, ".jagra", "flows", "login-works.yaml") },
    });
    expect(await readdir(folder)).toEqual([".jagra"]);
    expect(
      await readFile(join(folder, ".jagra/flows/login-works.yaml"), "utf8"),
    ).toContain("name: Login works");
  });

  it("never writes over an existing flow", async () => {
    await mkdir(join(folder, ".jagra/flows"), { recursive: true });
    await writeFile(join(folder, ".jagra/flows/login-works.yaml"), "mine");
    expect(await createFlow(folder, "Login works", "com.shop")).toEqual({
      ok: false,
      error: { code: "FLOW_EXISTS", file: "login-works.yaml" },
    });
    expect(
      await readFile(join(folder, ".jagra/flows/login-works.yaml"), "utf8"),
    ).toBe("mine");
  });

  it("refuses a name that gives no file name", async () => {
    expect(await createFlow(folder, "!!!", "com.shop")).toEqual({
      ok: false,
      error: { code: "FLOW_NAME_INVALID", name: "!!!" },
    });
  });
});
