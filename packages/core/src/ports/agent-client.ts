import type { Result } from "../errors/index.js";

export interface AgentRequest {
  /** The project folder. The agent works in it and may write only in `.jagra/flows` (AGT-8). */
  folder: string;
  /** File holding the instructions built from the template, team rules and request (AGT-14). */
  instructionsFile: string;
  /** A folder of Jagra's own for this request, outside the project, for files such as the reply. */
  workFolder: string;
  /** Cancel, and the 15-minute limit (AGT-13). */
  signal?: AbortSignal;
}

export interface AgentReply {
  /** Continues the session (AGT-17). Missing when the agent cannot continue one. */
  sessionId?: string;
  /** The agent's final message, expected to end with the JSON report (AGT-16). */
  finalMessage: string;
  /** Files the agent tried to change and was refused, when the agent says so (D-102). */
  refused?: string[];
}

/**
 * An AI agent installed on the user's machine (AGT). `CliAgent` runs Claude Code, Codex and custom
 * commands; `AcpAgent` talks ACP. Jagra never touches the agent's login (D-06).
 */
export interface AgentClient {
  start(request: AgentRequest): Promise<Result<AgentReply>>;
  continue(
    sessionId: string,
    request: AgentRequest,
  ): Promise<Result<AgentReply>>;
}
