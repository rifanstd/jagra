import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type ReadTextFileRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import { isInside } from "../../agents/paths.js";
import { fail, ok, type Result } from "../../errors/index.js";
import type {
  AgentClient,
  AgentReply,
  AgentRequest,
} from "../../ports/agent-client.js";
import type { ProcessRunner } from "../../ports/process-runner.js";
import type { ToolFiles } from "../tools/files.js";
import { currentMachine } from "../tools/machine.js";
import { agentLaunch, findProgram } from "./find.js";

/** Only the end of the agent's own error output is kept, for "Show details". */
const STDERR_LIMIT = 16 * 1024;

/** Tool kinds an agent may use without writing anything (AGT-8, D-111). */
const READING = new Set(["read", "search", "think"]);
/** Tool kinds that change files: allowed only inside `.jagra/flows` (AGT-9). */
const WRITING = new Set(["edit", "delete", "move"]);

export interface AcpAgentOptions {
  runner: ProcessRunner;
  /** Shown in errors, such as `Oh My Pi`. */
  name: string;
  /** The program and the arguments that start ACP mode, such as `omp acp`. */
  command: readonly string[];
  platform?: NodeJS.Platform;
  environment?: () => Promise<NodeJS.ProcessEnv>;
  home?: string;
  files?: ToolFiles;
}

/**
 * An agent that speaks the Agent Client Protocol, through the official SDK (D-07). One process
 * per request. Jagra does the agent's file writes itself and allows them only inside
 * `.jagra/flows`; every terminal command and every other write is refused before it happens
 * (AGT-9). Continuing loads the session in a new process when the agent supports it (AGT-17).
 */
export class AcpAgent implements AgentClient {
  constructor(private readonly options: AcpAgentOptions) {}

  start(request: AgentRequest): Promise<Result<AgentReply>> {
    return this.call(undefined, request);
  }

  continue(
    sessionId: string,
    request: AgentRequest,
  ): Promise<Result<AgentReply>> {
    return this.call(sessionId, request);
  }

  private async call(
    existing: string | undefined,
    request: AgentRequest,
  ): Promise<Result<AgentReply>> {
    const agent = this.options.name;
    const [program = "", ...args] = this.options.command;
    const machine = await currentMachine(this.options);
    const located = isAbsolute(program)
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
    const instructions = await readFile(request.instructionsFile, "utf8");

    let stderr = "";
    const started = await this.options.runner.start(
      {
        ...launch.spec,
        cwd: request.folder,
        output: "stream",
        signal: request.signal,
      },
      (line) => {
        stderr = (stderr + line.text + "\n").slice(-STDERR_LIMIT);
      },
    );
    if (!started.ok) return started;
    const running = started.value;
    if (!running.input || !running.output) {
      await running.stop();
      return fail({ code: "AGENT_FAILED", agent, detail: "no standard input" });
    }

    const flows = join(request.folder, ".jagra", "flows");
    const refused: string[] = [];
    let message = "";
    let listening = false;

    const app = client({ name: "Jagra" })
      .onRequest(methods.client.session.requestPermission, async ({ params }) =>
        answer(params, request.folder, flows, refused),
      )
      .onRequest(methods.client.fs.writeTextFile, async ({ params }) => {
        if (!(await isInside(flows, params.path))) {
          refused.push(params.path);
          throw RequestError.invalidParams(
            { path: params.path },
            "Jagra lets the agent write only inside .jagra/flows",
          );
        }
        await mkdir(dirname(params.path), { recursive: true });
        await writeFile(params.path, params.content, "utf8");
        return {};
      })
      .onRequest(methods.client.fs.readTextFile, async ({ params }) => {
        if (!(await isInside(request.folder, params.path))) {
          throw RequestError.invalidParams(
            { path: params.path },
            "Jagra lets the agent read only inside the project folder",
          );
        }
        return { content: await readPart(params) };
      })
      .onNotification(methods.client.session.update, ({ params }) => {
        const update = params.update;
        // While a session loads, the agent replays its history; only this turn's reply counts.
        if (
          listening &&
          update.sessionUpdate === "agent_message_chunk" &&
          update.content.type === "text"
        ) {
          message += update.content.text;
        }
      });

    try {
      const sessionId = await app.connectWith(
        ndJsonStream(running.input, running.output),
        async (ctx) => {
          const init = await ctx.request(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {
              fs: { readTextFile: true, writeTextFile: true },
              terminal: false,
            },
          });
          let id: string;
          if (existing === undefined) {
            id = (
              await ctx.request(methods.agent.session.new, {
                cwd: request.folder,
                mcpServers: [],
              })
            ).sessionId;
          } else {
            if (!init.agentCapabilities?.loadSession) return undefined;
            await ctx.request(methods.agent.session.load, {
              sessionId: existing,
              cwd: request.folder,
              mcpServers: [],
            });
            id = existing;
          }
          const cancel = () =>
            void ctx.notify(methods.agent.session.cancel, { sessionId: id });
          request.signal?.addEventListener("abort", cancel, { once: true });
          listening = true;
          try {
            await ctx.request(methods.agent.session.prompt, {
              sessionId: id,
              prompt: [{ type: "text", text: instructions }],
            });
          } finally {
            request.signal?.removeEventListener("abort", cancel);
          }
          return id;
        },
      );
      if (request.signal?.aborted) {
        return fail({ code: "AGENT_CANCELLED", agent });
      }
      if (sessionId === undefined) {
        return fail({ code: "AGENT_CANNOT_CONTINUE", agent });
      }
      return ok({
        sessionId,
        finalMessage: message.trim(),
        ...(refused.length > 0 ? { refused } : {}),
      });
    } catch (e) {
      if (request.signal?.aborted) {
        return fail({ code: "AGENT_CANCELLED", agent });
      }
      if (e instanceof RequestError && e.code === -32000) {
        return fail({ code: "AGENT_NOT_SIGNED_IN", agent });
      }
      const reason = e instanceof Error ? e.message : String(e);
      return fail({
        code: "AGENT_FAILED",
        agent,
        detail: [reason, stderr.trim()].filter(Boolean).join("\n\n"),
      });
    } finally {
      await running.stop();
    }
  }
}

/**
 * The answer to a permission request (AGT-9, D-111): changes only inside `.jagra/flows`, reading
 * only inside the project folder, and nothing else, such as a terminal command or a mode switch.
 */
export async function answer(
  params: RequestPermissionRequest,
  folder: string,
  flows: string,
  refused: string[],
): Promise<RequestPermissionResponse> {
  const call = params.toolCall;
  const kind = call.kind ?? "other";
  const paths = (call.locations ?? []).map((location) => location.path);
  let allowed = false;
  if (WRITING.has(kind)) {
    allowed =
      paths.length > 0 &&
      (await Promise.all(paths.map((path) => isInside(flows, path)))).every(
        Boolean,
      );
    if (!allowed) refused.push(...paths);
  } else if (READING.has(kind)) {
    allowed = (
      await Promise.all(paths.map((path) => isInside(folder, path)))
    ).every(Boolean);
  }
  const option = params.options.find(
    (o) => o.kind === (allowed ? "allow_once" : "reject_once"),
  );
  return {
    outcome: option
      ? { outcome: "selected", optionId: option.optionId }
      : { outcome: "cancelled" },
  };
}

/** A text file, or the lines the agent asked for (`line` counts from 1). */
async function readPart(params: ReadTextFileRequest): Promise<string> {
  const text = await readFile(params.path, "utf8");
  if (!params.line && !params.limit) return text;
  const lines = text.split("\n");
  const from = Math.max((params.line ?? 1) - 1, 0);
  return lines
    .slice(from, params.limit ? from + params.limit : undefined)
    .join("\n");
}
