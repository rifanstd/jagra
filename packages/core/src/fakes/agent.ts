import { readFile } from "node:fs/promises";
import { fail, ok, type JagraError, type Result } from "../errors/index.js";
import type {
  AgentClient,
  AgentReply,
  AgentRequest,
} from "../ports/agent-client.js";

/** Replies, or errors, handed out in the order they were queued. Each call keeps its instructions. */
export class FakeAgentClient implements AgentClient {
  readonly requests: {
    sessionId?: string;
    request: AgentRequest;
    instructions: string;
  }[] = [];
  private readonly replies: (AgentReply | JagraError)[] = [];
  /** Runs during the call, for example to write a flow as the agent would. */
  during?: (request: AgentRequest) => void | Promise<void>;

  queue(reply: AgentReply | JagraError): void {
    this.replies.push(reply);
  }

  start(request: AgentRequest): Promise<Result<AgentReply>> {
    return this.answer(undefined, request);
  }

  continue(
    sessionId: string,
    request: AgentRequest,
  ): Promise<Result<AgentReply>> {
    return this.answer(sessionId, request);
  }

  private async answer(
    sessionId: string | undefined,
    request: AgentRequest,
  ): Promise<Result<AgentReply>> {
    this.requests.push({
      ...(sessionId ? { sessionId } : {}),
      request,
      instructions: await readFile(request.instructionsFile, "utf8"),
    });
    await this.during?.(request);
    const reply = this.replies.shift();
    if (!reply) throw new Error("FakeAgentClient: no reply queued");
    return "code" in reply ? fail(reply) : ok(reply);
  }
}
