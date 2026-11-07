import type { Result } from "../errors/index.js";

export interface AgentRequest {
  /** The project folder the agent may read. */
  folder: string;
  /** File holding the instructions built from the template, team rules and request (AGT-14). */
  instructionsFile: string;
  signal?: AbortSignal;
}

export interface AgentReply {
  sessionId?: string;
  /** The agent's final message, expected to end with the JSON report (AGT-16). */
  finalMessage: string;
}

/**
 * An AI agent installed on the user's machine (AGT). Two adapters come in M10: `CliAgent` and
 * `AcpAgent`. Jagra never touches the agent's login (D-06).
 */
export interface AgentClient {
  start(request: AgentRequest): Promise<Result<AgentReply>>;
  continue(
    sessionId: string,
    request: AgentRequest,
  ): Promise<Result<AgentReply>>;
}
