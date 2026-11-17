import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentFinding, CustomAgent } from "@jagra/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmBox } from "./agent-confirm.js";
import { Agents, shown } from "./agents.js";
import { SettingsFile } from "./settings.js";

let dir: string;
let settings: SettingsFile;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jagra-agents-"));
  settings = new SettingsFile(dir, () => ["en-US"]);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function agents(
  found: AgentFinding["id"][],
  answer = true,
): { service: Agents; asked: CustomAgent[] } {
  const asked: CustomAgent[] = [];
  let ids = 0;
  const service = new Agents({
    settings,
    find: () =>
      Promise.resolve(
        (["claude-code", "codex", "gemini", "opencode", "omp"] as const).map(
          (id) => (found.includes(id) ? { id, path: `/bin/${id}` } : { id }),
        ),
      ),
    locate: (program) => Promise.resolve(program !== "missing"),
    confirm: (agent) => {
      asked.push(agent);
      return Promise.resolve(answer);
    },
    newId: () => `${++ids}`,
  });
  return { service, asked };
}

describe("Agents (AGT-1, D-110)", () => {
  it("lists the known agents with how they start, and uses the first one found", async () => {
    const view = await agents(["opencode", "omp"]).service.view();
    expect(
      view.agents.map((a) => [a.id, a.command, a.protocol, a.found]),
    ).toEqual([
      ["claude-code", "claude", "cli", false],
      ["codex", "codex", "cli", false],
      ["gemini", "gemini --acp", "acp", false],
      ["opencode", "opencode acp", "acp", true],
      ["omp", "omp acp", "acp", true],
    ]);
    expect(view.inUse).toBe("opencode");
  });

  it("keeps the user's choice as long as its program is found", async () => {
    const { service } = agents(["claude-code", "omp"]);
    expect((await service.choose("omp")).inUse).toBe("omp");
    expect((await settings.view()).settings.agent).toBe("omp");
    // A missing agent cannot be chosen.
    expect((await service.choose("codex")).inUse).toBe("omp");
    expect((await agents(["claude-code"]).service.view()).inUse).toBe(
      "claude-code",
    );
  });

  it("gives the agent in use with its program, to start it", async () => {
    const { service } = agents(["omp"]);
    expect(await service.inUse()).toMatchObject({
      id: "omp",
      name: "Oh My Pi",
      path: "/bin/omp",
      known: { protocol: "acp", acpArgs: ["acp"] },
    });
    await service.addCustom({
      name: "Mine",
      protocol: "acp",
      command: "mine acp",
    });
    expect(await service.inUse()).toMatchObject({
      id: "custom-1",
      name: "Mine",
      custom: { command: ["mine", "acp"] },
    });
    await service.removeCustom("custom-1");
    expect(await agents([]).service.inUse()).toBeUndefined();
  });

  it("has no agent in use when none is installed (AGT-7)", async () => {
    expect((await agents([]).service.view()).inUse).toBeUndefined();
  });
});

describe("custom agents (AGT-2, AGT-3, D-109)", () => {
  it("saves a command only after the system dialog, and uses it", async () => {
    const { service, asked } = agents(["claude-code"]);
    const added = await service.addCustom({
      name: "My agent",
      protocol: "cli",
      start: `"C:\\Tools\\My Agent\\agent.exe" --file {instructions}`,
      continue: "",
    });
    expect(asked).toEqual([
      {
        id: "custom-1",
        name: "My agent",
        protocol: "cli",
        start: ["C:\\Tools\\My Agent\\agent.exe", "--file", "{instructions}"],
      },
    ]);
    expect(added).toMatchObject({ ok: true, value: { inUse: "custom-1" } });
    const view = added?.ok ? added.value : undefined;
    expect(view?.agents.at(-1)).toEqual({
      id: "custom-1",
      name: "My agent",
      command: `"C:\\Tools\\My Agent\\agent.exe" --file {instructions}`,
      protocol: "cli",
      custom: true,
      found: true,
    });

    expect((await service.removeCustom("custom-1")).inUse).toBe("claude-code");
    expect((await settings.view()).settings).toEqual({});
  });

  it("saves nothing when the user cancels the dialog", async () => {
    const { service } = agents([], false);
    expect(
      await service.addCustom({ name: "X", protocol: "acp", command: "x acp" }),
    ).toBeUndefined();
    expect((await settings.view()).settings.customAgents).toBeUndefined();
  });

  it("refuses a taken name and a command it cannot read, before any dialog", async () => {
    const { service, asked } = agents([]);
    expect(
      await service.addCustom({
        name: "claude code",
        protocol: "acp",
        command: "x",
      }),
    ).toEqual({
      ok: false,
      error: { code: "AGENT_NAME_TAKEN", name: "claude code" },
    });
    expect(
      await service.addCustom({ name: "X", protocol: "cli", start: "x go" }),
    ).toEqual({
      ok: false,
      error: { code: "AGENT_COMMAND_NEEDS", placeholder: "{instructions}" },
    });
    expect(asked).toEqual([]);
  });

  it("shows a custom agent whose program is gone as not found", async () => {
    const { service } = agents([]);
    await service.addCustom({
      name: "Gone",
      protocol: "acp",
      command: "missing acp",
    });
    const view = await service.view();
    expect(view.agents.at(-1)?.found).toBe(false);
    expect(view.inUse).toBeUndefined();
  });
});

describe("confirmBox (D-109)", () => {
  it("lists the program and every argument, with Cancel as the default", () => {
    const box = confirmBox(
      {
        id: "c",
        name: "Mine",
        protocol: "cli",
        start: ["mine", "--file", "{instructions}"],
        continue: ["mine", "--resume", "{session}", "{instructions}"],
      },
      "en",
    );
    expect(box.message).toBe(
      "Jagra will start this program for Mine when you ask for a flow.",
    );
    expect(box.detail).toBe(
      [
        "Start command",
        "  Program: mine",
        "  Argument 1: --file",
        "  Argument 2: {instructions}",
        "",
        "Continue command",
        "  Program: mine",
        "  Argument 1: --resume",
        "  Argument 2: {session}",
        "  Argument 3: {instructions}",
        "",
        "Each argument is passed exactly as shown. Nothing goes through a shell.",
      ].join("\n"),
    );
    expect(box.buttons).toEqual(["Save", "Cancel"]);
    expect(box.defaultId).toBe(1);
    expect(
      confirmBox({ id: "c", name: "A", protocol: "acp", command: ["a"] }, "id")
        .buttons,
    ).toEqual(["Simpan", "Batal"]);
  });
});

describe("shown", () => {
  it("quotes arguments with spaces", () => {
    expect(shown(["a b", "", "c"])).toBe('"a b" "" c');
  });
});
