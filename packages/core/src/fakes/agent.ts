import { ok, type Result } from "../errors/index.js";
import type {
  AgentClient,
  AgentReply,
  AgentRequest,
} from "../ports/agent-client.js";

/** Replies are handed out in the order they were queued. */
export class FakeAgentClient implements AgentClient {
  readonly requests: { sessionId?: string; request: AgentRequest }[] = [];
  private readonly replies: AgentReply[] = [];

  queue(reply: AgentReply): void {
    this.replies.push(reply);
  }

  start(request: AgentRequest): Promise<Result<AgentReply>> {
    this.requests.push({ request });
    return Promise.resolve(ok(this.next()));
  }

  continue(
    sessionId: string,
    request: AgentRequest,
  ): Promise<Result<AgentReply>> {
    this.requests.push({ sessionId, request });
    return Promise.resolve(ok(this.next()));
  }

  private next(): AgentReply {
    const reply = this.replies.shift();
    if (!reply) throw new Error("FakeAgentClient: no reply queued");
    return reply;
  }
}
