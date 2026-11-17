import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addProject, loadLocal, type AgentRequest } from "@jagra/core";
import { FakeAgentClient, FakeGitClient } from "@jagra/core/fakes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiLive, FlowDetail } from "../shared/api.js";
import { Ai } from "./ai.js";

let root: string;
let appData: string;
let folder: string;
let projectId: string;
let client: FakeAgentClient;
let updates: (AiLive | undefined)[];
let detail: FlowDetail | undefined;

const write = async (path: string, text: string) => {
  const full = join(folder, ...path.split("/"));
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text);
};
const exists = (path: string) =>
  stat(join(folder, ...path.split("/"))).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jagra-ai-"));
  appData = join(root, "data");
  folder = join(root, "shop");
  await write(".jagra/config.yaml", "format: 1\nname: Shop\nappId: com.shop\n");
  await write(".jagra/flows/login.yaml", "appId: com.shop\n---\n- launchApp\n");
  await write("app/strings.xml", "Sign in\n");
  projectId = (await addProject(appData, folder)).id;
  client = new FakeAgentClient();
  updates = [];
  detail = undefined;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

let ids = 0;
function service(): Ai {
  return new Ai({
    appData,
    agents: {
      inUse: () =>
        Promise.resolve({
          id: "claude-code",
          name: "Claude Code",
          known: {
            id: "claude-code",
            name: "Claude Code",
            program: "claude",
            protocol: "cli",
          },
          path: "/bin/claude",
        }),
    },
    clientFor: () => client,
    git: new FakeGitClient(),
    runs: { flowDetail: () => Promise.resolve(detail) },
    broadcast: (live) => updates.push(live && structuredClone(live)),
    newId: () => `s-${++ids}`,
    now: () => Date.UTC(2026, 10, 17, 10, 0),
  });
}

const report = (flow: string) =>
  `Done.\n{"flow": ".jagra/flows/${flow}", "checks": "x", "possibleBug": null, "suggestedTests": ["Empty password"]}`;
const writesFlow =
  (flow: string, outside = false) =>
  async (request: AgentRequest) => {
    await write(`.jagra/flows/${flow}`, "appId: com.shop\n---\n- launchApp\n");
    if (outside) await write("app/strings.xml", "Log in\n");
    void request;
  };

async function settled(): Promise<AiLive | undefined> {
  for (let i = 0; i < 200; i++) {
    const last = updates.at(-1);
    if (last && last.phase !== "agent") return last;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the agent did not finish");
}

describe("Ai (spec section 10)", () => {
  it("asks for the notice once per project (AGT-11)", async () => {
    const ai = service();
    expect(await ai.notice(projectId)).toEqual({
      needed: true,
      agentName: "Claude Code",
      folder,
    });
    expect(
      await ai.start({ projectId, scenario: "Log in with a wrong password" }),
    ).toEqual({ notice: true });
    await ai.acceptNotice(projectId);
    expect((await loadLocal(appData, projectId)).aiNoticeAccepted).toBe(true);
    expect((await ai.notice(projectId))?.needed).toBe(false);
  });

  it("runs the agent, then goes to the review with the report (AGT-12 to AGT-16)", async () => {
    const ai = service();
    await ai.acceptNotice(projectId);
    client.during = writesFlow("wrong-password.yaml");
    client.queue({
      sessionId: "agent-1",
      finalMessage: report("wrong-password.yaml"),
    });
    expect(
      await ai.start({ projectId, scenario: "Log in with a wrong password" }),
    ).toEqual({ started: true });
    expect(updates[0]).toMatchObject({
      phase: "agent",
      agentName: "Claude Code",
      startedAt: "2026-11-17T10:00:00.000Z",
    });
    expect(await settled()).toMatchObject({
      phase: "review",
      flow: "wrong-password.yaml",
      flowExists: true,
      outside: [],
      report: { suggestedTests: ["Empty password"] },
    });
  });

  it("warns about files changed outside .jagra/flows, and Restore puts them back (AGT-19)", async () => {
    const ai = service();
    await ai.acceptNotice(projectId);
    client.during = writesFlow("wrong-password.yaml", true);
    client.queue({
      sessionId: "agent-1",
      finalMessage: report("wrong-password.yaml"),
    });
    await ai.start({ projectId, scenario: "x" });
    expect(await settled()).toMatchObject({
      phase: "warning",
      outside: [{ path: "app/strings.xml", kind: "changed" }],
      restorable: true,
    });
    expect(await ai.viewChange("outside", "app/strings.xml")).toEqual({
      path: "app/strings.xml",
      lines: [
        { kind: "removed", text: "Sign in" },
        { kind: "added", text: "Log in" },
      ],
    });
    expect(await ai.viewChange("outside", "app/other.xml")).toBeUndefined();
    await ai.restore();
    expect(await readFile(join(folder, "app", "strings.xml"), "utf8")).toBe(
      "Sign in\n",
    );
    expect(ai.state()?.phase).toBe("review");
  });

  it("lists other flows the agent changed, and undoes one (AGT-20)", async () => {
    const ai = service();
    await ai.acceptNotice(projectId);
    client.during = async (request) => {
      await writesFlow("new.yaml")(request);
      await write(".jagra/flows/login.yaml", "changed\n");
    };
    client.queue({ sessionId: "agent-1", finalMessage: report("new.yaml") });
    await ai.start({ projectId, scenario: "x" });
    expect((await settled())?.otherFlows).toEqual([
      { path: "login.yaml", kind: "changed" },
    ]);
    await ai.undoFlow("login.yaml");
    expect(
      await readFile(join(folder, ".jagra", "flows", "login.yaml"), "utf8"),
    ).toBe("appId: com.shop\n---\n- launchApp\n");
    expect(ai.state()?.otherFlows).toEqual([]);
  });

  it("stops on Cancel and still runs the safety net (AGT-13)", async () => {
    const ai = service();
    await ai.acceptNotice(projectId);
    client.during = async (request) => {
      await write("app/strings.xml", "Log in\n");
      if (!request.signal?.aborted) {
        await new Promise((resolve) =>
          request.signal?.addEventListener("abort", resolve),
        );
      }
    };
    client.queue({ code: "AGENT_CANCELLED", agent: "Claude Code" });
    await ai.start({ projectId, scenario: "x" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    ai.cancel();
    expect(ai.state()?.cancelling).toBe(true);
    const last = await settled();
    expect(last).toMatchObject({
      phase: "warning",
      error: { code: "AGENT_CANCELLED" },
    });
    ai.keep();
    expect(ai.state()?.phase).toBe("stopped");
  });

  it("sends the review run's failure to the same session (AGT-27), with the AGT-24 note", async () => {
    const ai = service();
    await ai.acceptNotice(projectId);
    client.during = writesFlow("save.yaml");
    client.queue({ sessionId: "agent-1", finalMessage: report("save.yaml") });
    await ai.start({ projectId, scenario: "Rename an item" });
    await settled();
    detail = {
      projectName: "Shop",
      run: { id: "r", status: "completed", startedAt: "" },
      flow: {
        file: join(folder, ".jagra", "flows", "save.yaml"),
        name: "save",
        status: "failed",
        failedStep: [1],
        reason: "Element not found: Save",
        screen: [{ text: "Simpan" }],
      },
      file: "save.yaml",
      steps: [
        { kind: "action", command: "launchApp", args: null, line: 3 },
        { kind: "action", command: "tapOn", args: "Save", line: 4 },
      ],
      changed: false,
    };
    expect(await ai.review("20261117-100000-abcd")).toMatchObject({
      likely: "flow",
    });

    client.queue({ sessionId: "agent-1", finalMessage: report("save.yaml") });
    expect(
      await ai.fix({
        note: "It is called Simpan",
        runId: "20261117-100000-abcd",
      }),
    ).toEqual({ started: true });
    await settled();
    const call = client.requests[1];
    expect(call?.sessionId).toBe("agent-1");
    expect(call?.instructions).toContain(
      "The user's note: It is called Simpan",
    );
    expect(call?.instructions).toContain('The step that failed: tapOn: "Save"');
    expect(call?.instructions).toContain(
      "Maestro's reason: Element not found: Save",
    );
    expect(call?.instructions).toContain('- text "Simpan"');
    expect(ai.state()).toMatchObject({ phase: "review", fixed: true });
  });

  it("Save keeps the flow, Discard deletes it, and both end the session (AGT-27)", async () => {
    const ai = service();
    await ai.acceptNotice(projectId);
    client.during = writesFlow("keep.yaml");
    client.queue({ sessionId: "agent-1", finalMessage: report("keep.yaml") });
    await ai.start({ projectId, scenario: "x" });
    await settled();
    await ai.save();
    expect(await exists(".jagra/flows/keep.yaml")).toBe(true);
    expect(ai.state()).toBeUndefined();

    client.during = writesFlow("drop.yaml");
    client.queue({ sessionId: "agent-2", finalMessage: report("drop.yaml") });
    await ai.start({ projectId, scenario: "y" });
    await settled();
    await ai.discard();
    expect(await exists(".jagra/flows/drop.yaml")).toBe(false);
    expect(await exists(".jagra/flows/login.yaml")).toBe(true);
    expect(updates.at(-1)).toBeUndefined();
  });

  it("shows the error when the agent fails before writing anything", async () => {
    const ai = service();
    await ai.acceptNotice(projectId);
    client.queue({ code: "AGENT_NOT_SIGNED_IN", agent: "Claude Code" });
    await ai.start({ projectId, scenario: "x" });
    expect(await settled()).toMatchObject({
      phase: "stopped",
      error: { code: "AGENT_NOT_SIGNED_IN" },
      flowExists: false,
    });
  });
});
