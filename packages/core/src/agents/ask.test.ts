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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAgentClient } from "../fakes/agent.js";
import { FakeClock } from "../fakes/clock.js";
import { askForFix, askForFlow, hasSourceCode } from "./ask.js";
import { endSession, loadSession, sessionFolder } from "./session.js";

let root: string;
let appData: string;
let folder: string;
let client: FakeAgentClient;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jagra-ask-"));
  appData = join(root, "data");
  folder = join(root, "shop");
  await mkdir(join(folder, ".jagra", "flows", "parts"), { recursive: true });
  await writeFile(
    join(folder, ".jagra", "flows", "login-works.yaml"),
    "appId: com.shop\nname: Login works\n---\n- launchApp\n",
  );
  await writeFile(
    join(folder, ".jagra", "flows", "parts", "login.yaml"),
    "appId: com.shop\nname: Log in\n---\n- tapOn: Sign in\n",
  );
  await writeFile(
    join(folder, ".jagra", "agent-rules.md"),
    "Use parts/login.yaml.",
  );
  await writeFile(join(folder, "settings.gradle.kts"), "");
  client = new FakeAgentClient();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

let ids = 0;
const options = () => ({
  client,
  agent: "claude-code",
  agentName: "Claude Code",
  clock: new FakeClock(Date.UTC(2026, 10, 17, 9, 0)),
  newId: () => `session-${++ids}`,
});
const target = () => ({ appData, projectId: "p1", folder });
const report = (flow: string) =>
  `Done.\n{"flow": "${flow}", "checks": "An error shows.", "possibleBug": null, "suggestedTests": ["Empty password"]}`;

describe("askForFlow (AGT-12 to AGT-16)", () => {
  it("writes the instructions, starts a session and keeps what the agent reported", async () => {
    client.queue({
      sessionId: "agent-1",
      finalMessage: report(".jagra/flows/login-wrong.yaml"),
    });
    const outcome = await askForFlow(options(), {
      ...target(),
      scenario: "Login with a wrong password shows an error",
      appId: "com.shop",
    });
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.error));
    const { session } = outcome.value;
    expect(session).toEqual({
      id: session.id,
      agent: "claude-code",
      agentSession: "agent-1",
      scenario: "Login with a wrong password shows an error",
      flow: "login-wrong.yaml",
      startedAt: "2026-11-17T09:00:00.000Z",
    });
    expect(outcome.value.report).toEqual({
      flow: ".jagra/flows/login-wrong.yaml",
      checks: "An error shows.",
      suggestedTests: ["Empty password"],
    });
    expect(await loadSession(appData, "p1", session.id)).toEqual(session);

    const [call] = client.requests;
    expect(call?.request).toMatchObject({
      folder,
      workFolder: sessionFolder(appData, "p1", session.id),
      instructionsFile: join(
        sessionFolder(appData, "p1", session.id),
        "instructions.md",
      ),
    });
    expect(call?.instructions).toContain("Use parts/login.yaml.");
    expect(call?.instructions).toContain("- parts/login.yaml: Log in");
    expect(call?.instructions).toContain("- login-works.yaml: Login works");
    expect(call?.instructions).toContain("has the app's source code");
    // Nothing is written in the project folder but what the agent writes (PRJ-11).
    await expect(
      stat(join(folder, ".jagra", "flows", "login-wrong.yaml")),
    ).rejects.toThrow();
  });

  it("asks for the file of a named flow, and refuses a name that is taken", async () => {
    client.queue({ finalMessage: report(".jagra/flows/other.yaml") });
    const outcome = await askForFlow(options(), {
      ...target(),
      scenario: "x",
      flowName: "Login wrong password",
      appId: "com.shop",
    });
    expect(outcome.ok && outcome.value.session.flow).toBe(
      "login-wrong-password.yaml",
    );
    expect(client.requests[0]?.instructions).toContain(
      "Write the flow to `.jagra/flows/login-wrong-password.yaml`.",
    );
    expect(
      await askForFlow(options(), {
        ...target(),
        scenario: "x",
        flowName: "Login works",
        appId: "com.shop",
      }),
    ).toEqual({
      ok: false,
      error: { code: "FLOW_EXISTS", file: "login-works.yaml" },
    });
  });

  it("ignores a reported flow outside .jagra/flows, and works without a report", async () => {
    client.queue({ finalMessage: report("app/src/x.yaml") });
    const outside = await askForFlow(options(), {
      ...target(),
      scenario: "x",
      appId: "a",
    });
    expect(outside.ok && outside.value.session.flow).toBeUndefined();
    client.queue({ finalMessage: "I could not finish." });
    const none = await askForFlow(options(), {
      ...target(),
      scenario: "x",
      appId: "a",
    });
    expect(none.ok && none.value).toMatchObject({
      finalMessage: "I could not finish.",
    });
    expect(none.ok && none.value.report).toBeUndefined();
  });

  it("stops the agent after the time limit and says so (AGT-13)", async () => {
    const timed = { ...options(), timeLimitMs: 30 };
    client.during = (request) =>
      new Promise((resolve) =>
        request.signal?.addEventListener("abort", () => resolve()),
      );
    client.queue({ code: "AGENT_CANCELLED", agent: "Claude Code" });
    expect(
      await askForFlow(timed, { ...target(), scenario: "x", appId: "a" }),
    ).toEqual({
      ok: false,
      error: { code: "AGENT_TIMED_OUT", agent: "Claude Code", minutes: 0 },
    });
  });

  it("passes Cancel on as cancelled, not as the time limit", async () => {
    const abort = new AbortController();
    client.during = () => abort.abort();
    client.queue({ code: "AGENT_CANCELLED", agent: "Claude Code" });
    expect(
      await askForFlow(options(), {
        ...target(),
        scenario: "x",
        appId: "a",
        signal: abort.signal,
      }),
    ).toEqual({
      ok: false,
      error: { code: "AGENT_CANCELLED", agent: "Claude Code" },
    });
  });
});

describe("askForFix (AGT-17, AGT-18, AGT-27)", () => {
  async function started() {
    client.queue({
      sessionId: "agent-1",
      finalMessage: report(".jagra/flows/save.yaml"),
    });
    const outcome = await askForFlow(options(), {
      ...target(),
      scenario: "Rename an item",
      appId: "a",
    });
    if (!outcome.ok) throw new Error("not started");
    await writeFile(
      join(folder, ".jagra", "flows", "save.yaml"),
      "appId: a\n---\n- tapOn: Save\n",
    );
    return outcome.value.session;
  }
  const fix = {
    note: "It is called Simpan",
    failedStep: 'Tap on "Save"',
    reason: "Element not found",
  };

  it("sends the fix to the same session", async () => {
    const session = await started();
    client.queue({
      sessionId: "agent-1",
      finalMessage: report(".jagra/flows/save.yaml"),
    });
    const outcome = await askForFix(options(), {
      ...target(),
      session,
      flow: "save.yaml",
      fix,
    });
    expect(outcome.ok && outcome.value.session).toEqual(session);
    const call = client.requests[1];
    expect(call?.sessionId).toBe("agent-1");
    expect(call?.instructions).toContain(
      "Fix the flow .jagra/flows/save.yaml.",
    );
    expect(call?.instructions).toContain(
      "The user's note: It is called Simpan",
    );
  });

  it("starts a new session with the history when the agent cannot continue", async () => {
    const session = await started();
    client.queue({ code: "AGENT_CANNOT_CONTINUE", agent: "Claude Code" });
    client.queue({
      sessionId: "agent-2",
      finalMessage: report(".jagra/flows/save.yaml"),
    });
    const outcome = await askForFix(options(), {
      ...target(),
      session,
      flow: "save.yaml",
      fix,
    });
    expect(outcome.ok && outcome.value.session.agentSession).toBe("agent-2");
    const fresh = client.requests[2];
    expect(fresh?.sessionId).toBeUndefined();
    expect(fresh?.instructions).toContain("## Earlier work");
    expect(fresh?.instructions).toContain("> Rename an item");
    expect(fresh?.instructions).toContain("- tapOn: Save");
    expect(fresh?.instructions).toContain("Use parts/login.yaml.");
  });

  it("goes straight to the history for an agent that gave no session id", async () => {
    const session = await started();
    const { agentSession: _, ...without } = session;
    void _;
    client.queue({ finalMessage: "ok" });
    await askForFix(options(), {
      ...target(),
      session: without,
      flow: "save.yaml",
      fix,
    });
    expect(client.requests[1]?.sessionId).toBeUndefined();
    expect(client.requests[1]?.instructions).toContain("## Earlier work");
  });

  it("does not fall back on other errors", async () => {
    const session = await started();
    client.queue({
      code: "AGENT_FAILED",
      agent: "Claude Code",
      detail: "rate limit",
    });
    expect(
      await askForFix(options(), {
        ...target(),
        session,
        flow: "save.yaml",
        fix,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_FAILED" },
    });
    expect(client.requests).toHaveLength(2);
  });

  it("ends the session with its files", async () => {
    const session = await started();
    await endSession(appData, "p1", session.id);
    expect(await loadSession(appData, "p1", session.id)).toBeUndefined();
    await expect(
      readFile(
        join(sessionFolder(appData, "p1", session.id), "instructions.md"),
      ),
    ).rejects.toThrow();
  });
});

describe("hasSourceCode (D-113)", () => {
  it("looks for the Gradle files or app/src", async () => {
    expect(await hasSourceCode(folder)).toBe(true);
    expect(await hasSourceCode(join(folder, ".jagra"))).toBe(false);
  });
});
