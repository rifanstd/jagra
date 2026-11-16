import { randomUUID } from "node:crypto";
import {
  fail,
  KNOWN_AGENTS,
  ok,
  readCustomAgent,
  type AgentFinding,
  type CustomAgent,
  type CustomAgentInput,
  type Result,
} from "@jagra/core";
import type { AgentsView, AgentView } from "../shared/api.js";
import type { SettingsFile } from "./settings.js";

export interface AgentsOptions {
  settings: SettingsFile;
  /** The known agents on this computer (AGT-1). */
  find(): Promise<AgentFinding[]>;
  /** Whether a custom agent's program is on this computer. */
  locate(program: string): Promise<boolean>;
  /** The system dialog that shows the split command before it is saved (D-109). */
  confirm(agent: CustomAgent): Promise<boolean>;
  newId?: () => string;
}

/** Settings > AI agent: which agents are found, which one is used, and custom agents. */
export class Agents {
  constructor(private readonly options: AgentsOptions) {}

  async view(): Promise<AgentsView> {
    const { settings } = await this.options.settings.view();
    const found = new Map(
      (await this.options.find()).map((f) => [f.id, f.path !== undefined]),
    );
    const known: AgentView[] = KNOWN_AGENTS.map((agent) => ({
      id: agent.id,
      name: agent.name,
      command: shown([agent.program, ...(agent.acpArgs ?? [])]),
      protocol: agent.protocol,
      custom: false,
      found: found.get(agent.id) ?? false,
    }));
    const custom: AgentView[] = await Promise.all(
      (settings.customAgents ?? []).map(async (agent) => {
        const command = agent.protocol === "acp" ? agent.command : agent.start;
        return {
          id: agent.id,
          name: agent.name,
          command: shown(command),
          protocol: agent.protocol,
          custom: true,
          found: await this.options.locate(command[0] ?? ""),
        };
      }),
    );
    const agents = [...known, ...custom];
    const chosen = agents.find((a) => a.id === settings.agent && a.found);
    // Until the user chooses, the first agent found is used (D-110).
    const inUse = chosen ?? agents.find((a) => a.found);
    return inUse ? { agents, inUse: inUse.id } : { agents };
  }

  async choose(id: string): Promise<AgentsView> {
    const view = await this.view();
    if (view.agents.some((agent) => agent.id === id && agent.found)) {
      await this.options.settings.update({ agent: id });
    }
    return this.view();
  }

  /** Checks and splits the command, then saves it only if the user confirms (D-109). */
  async addCustom(
    input: CustomAgentInput,
  ): Promise<Result<AgentsView> | undefined> {
    const { settings } = await this.options.settings.view();
    const custom = settings.customAgents ?? [];
    const name = input.name.trim();
    const taken = [...KNOWN_AGENTS, ...custom].some(
      (agent) => agent.name.toLowerCase() === name.toLowerCase(),
    );
    if (taken) return fail({ code: "AGENT_NAME_TAKEN", name });
    const agent = readCustomAgent(
      input,
      `custom-${(this.options.newId ?? randomUUID)()}`,
    );
    if (!agent.ok) return agent;
    if (!(await this.options.confirm(agent.value))) return undefined;
    await this.options.settings.update({
      customAgents: [...custom, agent.value],
      agent: agent.value.id,
    });
    return ok(await this.view());
  }

  async removeCustom(id: string): Promise<AgentsView> {
    const { settings } = await this.options.settings.view();
    const rest = (settings.customAgents ?? []).filter((a) => a.id !== id);
    await this.options.settings.update({
      customAgents: rest.length > 0 ? rest : undefined,
      ...(settings.agent === id ? { agent: undefined } : {}),
    });
    return this.view();
  }
}

/** A split command as one line, with quotes where an argument holds a space. */
export function shown(command: readonly string[]): string {
  return command
    .map((arg) => (arg === "" || /\s/.test(arg) ? `"${arg}"` : arg))
    .join(" ");
}
