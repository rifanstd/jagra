import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentContext,
  type RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeProcessRunner,
  type FakeProgram,
} from "../../fakes/process-runner.js";
import { FakeToolFiles } from "../../fakes/tool-files.js";
import type { AgentRequest } from "../../ports/agent-client.js";
import { AcpAgent } from "./acp-agent.js";

let project: string;
let work: string;
let request: AgentRequest;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "jagra-acp-project-"));
  work = await mkdtemp(join(tmpdir(), "jagra-acp-work-"));
  await mkdir(join(project, ".jagra", "flows"), { recursive: true });
  await mkdir(join(project, "app"));
  await writeFile(join(project, "app", "strings.xml"), "Sign in");
  await writeFile(join(work, "instructions.md"), "Write a login flow.");
  request = {
    folder: project,
    instructionsFile: join(work, "instructions.md"),
    workFolder: work,
  };
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

interface Turn {
  ctx: AgentContext;
  sessionId: string;
  prompt: string;
  signal: AbortSignal;
}

/** A fake ACP agent on the other end of the streams, built with the SDK's agent side. */
function fakeAgent(
  onPrompt: (turn: Turn) => Promise<void>,
  options: { loadSession?: boolean; history?: string } = {},
): () => FakeProgram {
  return () => {
    const toAgent = new TransformStream<Uint8Array, Uint8Array>();
    const toClient = new TransformStream<Uint8Array, Uint8Array>();
    const say = (ctx: AgentContext, sessionId: string, text: string) =>
      ctx.notify(methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
    agent({ name: "fake" })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: options.loadSession ?? true },
      }))
      .onRequest(methods.agent.session.new, () => ({ sessionId: "s-1" }))
      .onRequest(methods.agent.session.load, async ({ params, client }) => {
        // Agents replay the session's history while it loads.
        await say(client, params.sessionId, options.history ?? "old reply");
        return {};
      })
      .onRequest(
        methods.agent.session.prompt,
        async ({ params, client, signal }) => {
          const prompt = params.prompt
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("");
          await onPrompt({
            ctx: client,
            sessionId: params.sessionId,
            prompt,
            signal,
          });
          await say(client, params.sessionId, `done: ${prompt}`);
          return { stopReason: signal.aborted ? "cancelled" : "end_turn" };
        },
      )
      .onNotification(methods.agent.session.cancel, () => undefined)
      .connect(ndJsonStream(toClient.writable, toAgent.readable));
    return { streams: { input: toAgent.writable, output: toClient.readable } };
  };
}

function setup(answer: () => FakeProgram) {
  const runner = new FakeProcessRunner();
  runner.define("/bin/omp", () => answer());
  const client = new AcpAgent({
    runner,
    name: "Oh My Pi",
    command: ["/bin/omp", "acp"],
    platform: "darwin",
    environment: () => Promise.resolve({}),
    home: "/Users/me",
    files: new FakeToolFiles(),
  });
  return { runner, client };
}

const flow = () => join(project, ".jagra", "flows", "login.yaml");

describe("AcpAgent (AGT-9, AGT-17)", () => {
  it("starts the agent in ACP mode in the project, sends the instructions and keeps its reply", async () => {
    const { runner, client } = setup(fakeAgent(() => Promise.resolve()));
    expect(await client.start(request)).toEqual({
      ok: true,
      value: { sessionId: "s-1", finalMessage: "done: Write a login flow." },
    });
    expect(runner.calls[0]).toMatchObject({
      program: "/bin/omp",
      args: ["acp"],
      cwd: project,
      output: "stream",
    });
  });

  it("writes inside .jagra/flows for the agent, and refuses every other write before it happens", async () => {
    const outcomes: string[] = [];
    const { client } = setup(
      fakeAgent(async ({ ctx, sessionId }) => {
        await ctx.request(methods.client.fs.writeTextFile, {
          sessionId,
          path: flow(),
          content: "appId: com.shop\n",
        });
        for (const path of [
          join(project, "app", "strings.xml"),
          join(project, ".jagra", "flows", "..", "config.yaml"),
        ]) {
          try {
            await ctx.request(methods.client.fs.writeTextFile, {
              sessionId,
              path,
              content: "changed",
            });
            outcomes.push("written");
          } catch (e) {
            outcomes.push(e instanceof RequestError ? "refused" : "other");
          }
        }
      }),
    );
    const reply = await client.start(request);
    expect(await readFile(flow(), "utf8")).toBe("appId: com.shop\n");
    expect(await readFile(join(project, "app", "strings.xml"), "utf8")).toBe(
      "Sign in",
    );
    expect(outcomes).toEqual(["refused", "refused"]);
    expect(reply).toMatchObject({
      ok: true,
      value: {
        refused: [
          join(project, "app", "strings.xml"),
          join(project, ".jagra", "flows", "..", "config.yaml"),
        ],
      },
    });
  });

  it("answers permission requests: edits in flows yes, commands and other edits no", async () => {
    const answers: string[] = [];
    const options = [
      { optionId: "yes", name: "Allow", kind: "allow_once" as const },
      { optionId: "always", name: "Always", kind: "allow_always" as const },
      { optionId: "no", name: "Reject", kind: "reject_once" as const },
    ];
    const ask = async (
      ctx: AgentContext,
      sessionId: string,
      kind: "edit" | "execute" | "read" | "switch_mode",
      path?: string,
    ) => {
      const response = await ctx.request<RequestPermissionResponse>(
        methods.client.session.requestPermission,
        {
          sessionId,
          options,
          toolCall: {
            toolCallId: `${kind}-${answers.length}`,
            kind,
            ...(path ? { locations: [{ path }] } : {}),
          },
        },
      );
      answers.push(
        response.outcome.outcome === "selected"
          ? response.outcome.optionId
          : "cancelled",
      );
    };
    const { client } = setup(
      fakeAgent(async ({ ctx, sessionId }) => {
        await ask(ctx, sessionId, "edit", flow());
        await ask(ctx, sessionId, "edit", join(project, "app", "strings.xml"));
        await ask(ctx, sessionId, "edit");
        await ask(ctx, sessionId, "execute");
        await ask(ctx, sessionId, "read", join(project, "app", "strings.xml"));
        await ask(ctx, sessionId, "read", join(work, "instructions.md"));
        await ask(ctx, sessionId, "switch_mode");
      }),
    );
    await client.start(request);
    expect(answers).toEqual(["yes", "no", "no", "no", "yes", "no", "no"]);
  });

  it("reads only inside the project folder for the agent", async () => {
    const reads: string[] = [];
    const { client } = setup(
      fakeAgent(async ({ ctx, sessionId }) => {
        const ok = await ctx.request(methods.client.fs.readTextFile, {
          sessionId,
          path: join(project, "app", "strings.xml"),
        });
        reads.push(ok.content);
        await ctx
          .request(methods.client.fs.readTextFile, {
            sessionId,
            path: join(work, "instructions.md"),
          })
          .then(
            () => reads.push("read outside"),
            () => reads.push("refused"),
          );
      }),
    );
    await client.start(request);
    expect(reads).toEqual(["Sign in", "refused"]);
  });

  it("continues by loading the session, keeping only the new reply", async () => {
    const { client } = setup(fakeAgent(() => Promise.resolve()));
    await writeFile(request.instructionsFile, "Fix the tap on Save.");
    expect(await client.continue("s-1", request)).toEqual({
      ok: true,
      value: { sessionId: "s-1", finalMessage: "done: Fix the tap on Save." },
    });
  });

  it("says when the agent cannot load a session (AGT-18)", async () => {
    const { client } = setup(
      fakeAgent(() => Promise.resolve(), { loadSession: false }),
    );
    expect(await client.continue("s-1", request)).toEqual({
      ok: false,
      error: { code: "AGENT_CANNOT_CONTINUE", agent: "Oh My Pi" },
    });
  });

  it("asks the agent to cancel and stops it when the user cancels (AGT-13)", async () => {
    const abort = new AbortController();
    const { client } = setup(
      fakeAgent(async ({ signal }) => {
        abort.abort();
        await new Promise((resolve) => setTimeout(resolve, 20));
        void signal;
      }),
    );
    expect(await client.start({ ...request, signal: abort.signal })).toEqual({
      ok: false,
      error: { code: "AGENT_CANCELLED", agent: "Oh My Pi" },
    });
  });

  it("reports an agent that needs a login, without offering one (AGT-4)", async () => {
    const { client } = setup(
      fakeAgent(() => Promise.reject(RequestError.authRequired())),
    );
    expect(await client.start(request)).toEqual({
      ok: false,
      error: { code: "AGENT_NOT_SIGNED_IN", agent: "Oh My Pi" },
    });
  });
});
