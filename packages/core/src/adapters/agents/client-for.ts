import type { CustomAgent } from "../../agents/custom.js";
import type { KnownAgent } from "../../agents/known.js";
import type { AgentClient } from "../../ports/agent-client.js";
import type { ProcessRunner } from "../../ports/process-runner.js";
import { AcpAgent } from "./acp-agent.js";
import { CliAgent } from "./cli-agent.js";

/** The agent in use (AGT-1): a known agent with the program found for it, or a custom one. */
export type AgentChoice =
  { known: KnownAgent; path: string } | { custom: CustomAgent };

/** The client that talks to the agent: its command line or ACP (D-07). */
export function agentClientFor(
  choice: AgentChoice,
  runner: ProcessRunner,
): AgentClient {
  if ("custom" in choice) {
    const agent = choice.custom;
    return agent.protocol === "acp"
      ? new AcpAgent({ runner, name: agent.name, command: agent.command })
      : new CliAgent({ runner, agent: { kind: "custom", agent } });
  }
  const { known, path } = choice;
  if (known.protocol === "acp") {
    return new AcpAgent({
      runner,
      name: known.name,
      command: [path, ...(known.acpArgs ?? [])],
    });
  }
  return new CliAgent({
    runner,
    agent: {
      kind: known.id === "codex" ? "codex" : "claude-code",
      program: path,
    },
  });
}
