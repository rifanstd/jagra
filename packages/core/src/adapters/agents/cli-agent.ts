import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fillCommand, type CustomAgent } from "../../agents/custom.js";
import { fail, ok, type Result } from "../../errors/index.js";
import type {
  AgentClient,
  AgentReply,
  AgentRequest,
} from "../../ports/agent-client.js";
import type { OutputLine, ProcessRunner } from "../../ports/process-runner.js";
import type { ToolFiles } from "../tools/files.js";
import { currentMachine } from "../tools/machine.js";
import { agentLaunch, findProgram } from "./find.js";

/** Keeps a chatty agent's output from filling memory. Only the end is shown. */
const OUTPUT_LIMIT = 256 * 1024;

const CLAUDE_PROMPT =
  "Do the task described in your instructions, then end with the JSON report they ask for.";
const codexPrompt = (file: string) =>
  `Read the file ${file} and do the task it describes, then end with the JSON report it asks for.`;

/** Claude Code may read, and write only in `.jagra/flows` (AGT-10, D-102). */
const CLAUDE_PERMISSIONS = [
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
];

export type CliAgentKind =
  | { kind: "claude-code"; program: string }
  | { kind: "codex"; program: string }
  | { kind: "custom"; agent: Extract<CustomAgent, { protocol: "cli" }> };

export interface CliAgentOptions {
  runner: ProcessRunner;
  agent: CliAgentKind;
  platform?: NodeJS.Platform;
  environment?: () => Promise<NodeJS.ProcessEnv>;
  home?: string;
  files?: ToolFiles;
  /** The session id Jagra makes for Claude Code and custom agents (D-108). */
  newId?: () => string;
}

/** An agent called through its own command line, one process per request (D-07). */
export class CliAgent implements AgentClient {
  constructor(private readonly options: CliAgentOptions) {}

  start(request: AgentRequest): Promise<Result<AgentReply>> {
    return this.call(undefined, request);
  }

  continue(
    sessionId: string,
    request: AgentRequest,
  ): Promise<Result<AgentReply>> {
    return this.call(sessionId, request);
  }

  private get name(): string {
    const agent = this.options.agent;
    return agent.kind === "custom" ? agent.agent.name : agent.kind;
  }

  private async call(
    existing: string | undefined,
    request: AgentRequest,
  ): Promise<Result<AgentReply>> {
    const agent = this.options.agent;
    const session = existing ?? (this.options.newId ?? randomUUID)();
    const lastMessage = join(request.workFolder, "last-message.txt");
    let command: string[];
    switch (agent.kind) {
      case "claude-code":
        command = [
          agent.program,
          "-p",
          "--output-format",
          "json",
          ...(existing ? ["--resume", existing] : ["--session-id", session]),
          ...CLAUDE_PERMISSIONS,
          "--append-system-prompt-file",
          request.instructionsFile,
          CLAUDE_PROMPT,
        ];
        break;
      case "codex":
        command = [
          agent.program,
          "exec",
          ...(existing ? ["resume"] : []),
          "--json",
          "--sandbox",
          "workspace-write",
          "--skip-git-repo-check",
          "-C",
          request.folder,
          "-o",
          lastMessage,
          ...(existing ? [existing] : []),
          codexPrompt(request.instructionsFile),
        ];
        break;
      case "custom": {
        const template = existing ? agent.agent.continue : agent.agent.start;
        if (!template) {
          return fail({
            code: "AGENT_FAILED",
            agent: this.name,
            detail: "this agent has no continue command",
          });
        }
        command = fillCommand(template, {
          instructions: request.instructionsFile,
          session,
        });
      }
    }

    const machine = await currentMachine(this.options);
    const [program = "", ...args] = command;
    const located =
      isAbsolute(program) || agent.kind !== "custom"
        ? program
        : findProgram(machine, program);
    if (located === undefined)
      return fail({ code: "PROGRAM_NOT_FOUND", program });
    const launch = agentLaunch(located, args, machine);
    if (!launch.ok) {
      return fail({
        code: "PROGRAM_START_FAILED",
        program: located,
        detail: [launch.problem, launch.detail].filter(Boolean).join(": "),
      });
    }
    const output: Record<OutputLine["stream"], string> = {
      stdout: "",
      stderr: "",
    };
    const started = await this.options.runner.start(
      { ...launch.spec, cwd: request.folder, signal: request.signal },
      (line) => {
        output[line.stream] = (output[line.stream] + line.text + "\n").slice(
          -OUTPUT_LIMIT,
        );
      },
    );
    if (!started.ok) return started;
    const exit = await started.value.exited;
    if (request.signal?.aborted) {
      return fail({ code: "AGENT_CANCELLED", agent: this.name });
    }

    switch (agent.kind) {
      case "claude-code":
        return this.claudeReply(output.stdout, output.stderr);
      case "codex": {
        const message = await readFile(lastMessage, "utf8").catch(() => "");
        if (exit.code !== 0 && message === "") {
          return this.failed(output.stderr || output.stdout);
        }
        const thread = codexThread(output.stdout) ?? existing;
        return ok({
          ...(thread ? { sessionId: thread } : {}),
          finalMessage: message.trim(),
        });
      }
      case "custom":
        if (exit.code !== 0) return this.failed(output.stderr || output.stdout);
        return ok({
          // Without a continue command the id leads nowhere (AGT-18 starts over instead).
          ...(agent.agent.continue ? { sessionId: session } : {}),
          finalMessage: output.stdout.trim(),
        });
    }
  }

  /** Only these fields are read; the rest of Claude Code's answer is about the account (D-102). */
  private claudeReply(stdout: string, stderr: string): Result<AgentReply> {
    const result = lastJson(stdout);
    if (!result || typeof result.result !== "string") {
      return this.failed(stderr || stdout);
    }
    if (result.is_error === true) return this.failed(result.result);
    const refused = Array.isArray(result.permission_denials)
      ? result.permission_denials
          .map((denial: unknown) => {
            const input = (denial as { tool_input?: { file_path?: unknown } })
              .tool_input;
            return typeof input?.file_path === "string"
              ? input.file_path
              : undefined;
          })
          .filter((path): path is string => path !== undefined)
      : [];
    return ok({
      ...(typeof result.session_id === "string"
        ? { sessionId: result.session_id }
        : {}),
      finalMessage: result.result.trim(),
      ...(refused.length > 0 ? { refused } : {}),
    });
  }

  private failed(detail: string): Result<AgentReply> {
    return fail({
      code: "AGENT_FAILED",
      agent: this.name,
      detail: detail.trim().slice(-4000),
    });
  }
}

/** The last line of output that is a JSON object. */
function lastJson(text: string): Record<string, unknown> | undefined {
  for (const line of text.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Not the answer; keep looking.
    }
  }
  return undefined;
}

/** Codex's session id: `thread_id` of its `thread.started` event (D-103). */
function codexThread(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    if (!line.includes("thread.started")) continue;
    try {
      const event = JSON.parse(line) as { type?: unknown; thread_id?: unknown };
      if (
        event.type === "thread.started" &&
        typeof event.thread_id === "string"
      )
        return event.thread_id;
    } catch {
      // Ignore lines that are not events.
    }
  }
  return undefined;
}
