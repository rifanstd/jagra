import { writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeProcessRunner,
  type FakeAnswer,
} from "../../fakes/process-runner.js";
import { FakeToolFiles } from "../../fakes/tool-files.js";
import type { AgentRequest } from "../../ports/agent-client.js";
import { CliAgent, type CliAgentKind } from "./cli-agent.js";

let work: string;
let request: AgentRequest;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "jagra-agent-"));
  request = {
    folder: "/projects/shop",
    instructionsFile: join(work, "instructions.md"),
    workFolder: work,
  };
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

function setup(agent: CliAgentKind, program: string, answer: FakeAnswer) {
  const runner = new FakeProcessRunner();
  runner.define(program, answer);
  const client = new CliAgent({
    runner,
    agent,
    platform: "darwin",
    environment: () => Promise.resolve({ PATH: "/usr/local/bin" }),
    home: "/Users/me",
    files: new FakeToolFiles().file("/usr/local/bin/aider"),
    newId: () => "11111111-2222-3333-4444-555555555555",
  });
  return { runner, client };
}

const out = (text: string, code = 0) => ({
  lines: [{ stream: "stdout" as const, text }],
  exit: { code, signal: null },
});

describe("CliAgent: Claude Code (AGT-10, D-102)", () => {
  const claude: CliAgentKind = { kind: "claude-code", program: "/bin/claude" };
  const answer = JSON.stringify({
    type: "result",
    is_error: false,
    session_id: "11111111-2222-3333-4444-555555555555",
    result:
      'Wrote .jagra/flows/login.yaml\n{"flow": ".jagra/flows/login.yaml"}',
    permission_denials: [
      {
        tool_name: "Edit",
        tool_input: { file_path: "/projects/shop/app/strings.xml" },
      },
    ],
    credential_expires_at: "2026-12-01T00:00:00Z",
  });

  it("starts a session it names, allowed to write only in .jagra/flows", async () => {
    const { runner, client } = setup(claude, "/bin/claude", out(answer));
    expect(await client.start(request)).toEqual({
      ok: true,
      value: {
        sessionId: "11111111-2222-3333-4444-555555555555",
        finalMessage:
          'Wrote .jagra/flows/login.yaml\n{"flow": ".jagra/flows/login.yaml"}',
        refused: ["/projects/shop/app/strings.xml"],
      },
    });
    expect(runner.calls[0]).toMatchObject({
      program: "/bin/claude",
      cwd: "/projects/shop",
      args: [
        "-p",
        "--output-format",
        "json",
        "--session-id",
        "11111111-2222-3333-4444-555555555555",
        "--restricted",
        "--tools",
        "Read,Glob,Grep,Write,Edit",
        "--allowedTools",
        "Read",
        "Glob",
        "Grep",
        "Write(.jagra/flows/**)",
        "Edit(.jagra/flows/**)",
        "--permission-mode",
        "dontAsk",
        "--append-system-prompt-file",
        request.instructionsFile,
        "Do the task described in your instructions, then end with the JSON report they ask for.",
      ],
    });
  });

  it("continues a session with --resume", async () => {
    const { runner, client } = setup(claude, "/bin/claude", out(answer));
    await client.continue("abc", request);
    const args = runner.calls[0]?.args ?? [];
    expect(args.slice(3, 5)).toEqual(["--resume", "abc"]);
    expect(args).not.toContain("--session-id");
  });

  it("reports an error answer and output that is not JSON", async () => {
    const error = JSON.stringify({
      is_error: true,
      result: "Credit balance is too low",
    });
    expect(
      await setup(claude, "/bin/claude", out(error, 1)).client.start(request),
    ).toEqual({
      ok: false,
      error: {
        code: "AGENT_FAILED",
        agent: "claude-code",
        detail: "Credit balance is too low",
      },
    });
    expect(
      (
        await setup(
          claude,
          "/bin/claude",
          out("Not logged in", 1),
        ).client.start(request)
      ).ok,
    ).toBe(false);
  });

  it("says Cancelled when stopped", async () => {
    const { client } = setup(claude, "/bin/claude", { lines: [] });
    const abort = new AbortController();
    const reply = client.start({ ...request, signal: abort.signal });
    abort.abort();
    expect(await reply).toEqual({
      ok: false,
      error: { code: "AGENT_CANCELLED", agent: "claude-code" },
    });
  });
});

describe("CliAgent: Codex (D-103)", () => {
  const codex: CliAgentKind = { kind: "codex", program: "/bin/codex" };

  it("runs codex exec in the project and reads the thread id and the last message", async () => {
    const { runner, client } = setup(codex, "/bin/codex", (args) => {
      const file = args[args.indexOf("-o") + 1] ?? "";
      writeFileSync(file, 'Done.\n{"flow": "x.yaml"}\n');
      return {
        lines: [
          {
            stream: "stdout",
            text: '{"type":"thread.started","thread_id":"t-1"}',
          },
          { stream: "stdout", text: '{"type":"turn.completed"}' },
        ],
        exit: { code: 0, signal: null },
      };
    });
    const reply = await client.start(request);
    expect(reply).toEqual({
      ok: true,
      value: { sessionId: "t-1", finalMessage: 'Done.\n{"flow": "x.yaml"}' },
    });
    expect(runner.calls[0]?.args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-C",
      "/projects/shop",
      "-o",
      join(work, "last-message.txt"),
      `Read the file ${request.instructionsFile} and do the task it describes, then end with the JSON report it asks for.`,
    ]);
  });

  it("continues with exec resume and the thread id", async () => {
    const { runner, client } = setup(codex, "/bin/codex", out("", 0));
    await writeFile(join(work, "last-message.txt"), "Fixed.");
    expect(await client.continue("t-1", request)).toEqual({
      ok: true,
      value: { sessionId: "t-1", finalMessage: "Fixed." },
    });
    const args = runner.calls[0]?.args ?? [];
    expect(args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(args.at(-2)).toBe("t-1");
  });
});

describe("CliAgent: custom command (AGT-3, D-21, D-108)", () => {
  const custom = (withContinue: boolean): CliAgentKind => ({
    kind: "custom",
    agent: {
      id: "c1",
      name: "Aider",
      protocol: "cli",
      start: [
        "aider",
        "--session",
        "{session}",
        "--message-file",
        "{instructions}",
      ],
      ...(withContinue
        ? {
            continue: [
              "aider",
              "--resume",
              "{session}",
              "--message-file={instructions}",
            ],
          }
        : {}),
    },
  });

  it("fills the placeholders as single arguments and keeps stdout as the message", async () => {
    const { runner, client } = setup(
      custom(true),
      "/usr/local/bin/aider",
      out("All done"),
    );
    expect(await client.start(request)).toEqual({
      ok: true,
      value: {
        sessionId: "11111111-2222-3333-4444-555555555555",
        finalMessage: "All done",
      },
    });
    expect(runner.calls[0]).toMatchObject({
      program: "/usr/local/bin/aider",
      args: [
        "--session",
        "11111111-2222-3333-4444-555555555555",
        "--message-file",
        request.instructionsFile,
      ],
    });
    await client.continue("s-9", request);
    expect(runner.calls[1]?.args).toEqual([
      "--resume",
      "s-9",
      `--message-file=${request.instructionsFile}`,
    ]);
  });

  it("gives no session id without a continue command, and cannot continue", async () => {
    const { client } = setup(custom(false), "/usr/local/bin/aider", out("ok"));
    expect(await client.start(request)).toEqual({
      ok: true,
      value: { finalMessage: "ok" },
    });
    expect(await client.continue("s", request)).toEqual({
      ok: false,
      error: { code: "AGENT_CANNOT_CONTINUE", agent: "Aider" },
    });
  });

  it("reports a program that is not installed", async () => {
    const missing: CliAgentKind = {
      kind: "custom",
      agent: {
        id: "c2",
        name: "X",
        protocol: "cli",
        start: ["nope", "{instructions}"],
      },
    };
    const { client } = setup(missing, "/usr/local/bin/nope", out(""));
    expect(await client.start(request)).toEqual({
      ok: false,
      error: { code: "PROGRAM_NOT_FOUND", program: "nope" },
    });
  });
});
