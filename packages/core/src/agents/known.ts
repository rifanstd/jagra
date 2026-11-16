/**
 * How Jagra talks to an agent: its own command line (`cli`) or the Agent Client Protocol (`acp`).
 * Claude Code and Codex use their command lines (D-07).
 */
export type AgentProtocol = "cli" | "acp";

export type KnownAgentId =
  "claude-code" | "codex" | "gemini" | "opencode" | "omp";

export interface KnownAgent {
  id: KnownAgentId;
  name: string;
  /** The program name on `PATH`, without `.exe` or `.cmd`. */
  program: string;
  protocol: AgentProtocol;
  /** Arguments that start ACP mode. */
  acpArgs?: readonly string[];
}

/** The agents Jagra looks for (AGT-1), in the order the settings page lists them. */
export const KNOWN_AGENTS: readonly KnownAgent[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    program: "claude",
    protocol: "cli",
  },
  { id: "codex", name: "Codex", program: "codex", protocol: "cli" },
  {
    id: "gemini",
    name: "Gemini CLI",
    program: "gemini",
    protocol: "acp",
    acpArgs: ["--acp"],
  },
  {
    id: "opencode",
    name: "OpenCode",
    program: "opencode",
    protocol: "acp",
    acpArgs: ["acp"],
  },
  {
    id: "omp",
    name: "Oh My Pi",
    program: "omp",
    protocol: "acp",
    acpArgs: ["acp"],
  },
];

export function isKnownAgentId(id: string): id is KnownAgentId {
  return KNOWN_AGENTS.some((agent) => agent.id === id);
}
