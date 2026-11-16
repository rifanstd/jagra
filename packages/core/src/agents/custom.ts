import { fail, ok, type Result } from "../errors/index.js";

export const INSTRUCTIONS = "{instructions}";
export const SESSION = "{session}";

/** An agent the user added by hand (AGT-2, AGT-3). Commands are kept split: program first. */
export type CustomAgent =
  | { id: string; name: string; protocol: "acp"; command: string[] }
  | {
      id: string;
      name: string;
      protocol: "cli";
      start: string[];
      /** Continues a session (AGT-17). Without it, Jagra starts a new session with the history. */
      continue?: string[];
    };

/** What the user typed on the settings page. */
export type CustomAgentInput =
  | { name: string; protocol: "acp"; command: string }
  | { name: string; protocol: "cli"; start: string; continue?: string };

/**
 * Splits a command into a program and its arguments, the way it is saved (D-21). Spaces separate
 * arguments; double or single quotes keep spaces inside one. Backslashes are plain characters,
 * since Windows paths are full of them. Nothing here is ever given to a shell.
 */
export function splitCommand(text: string): Result<string[]> {
  const parts: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | undefined;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) parts.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) return fail({ code: "AGENT_COMMAND_QUOTE" });
  if (started) parts.push(current);
  if (parts.length === 0 || parts[0] === "") {
    return fail({ code: "AGENT_COMMAND_EMPTY" });
  }
  return ok(parts);
}

/**
 * Checks and splits what the user typed (D-108): a start command needs `{instructions}`, and a
 * continue command needs `{session}` and `{instructions}`. The id is given by the caller.
 */
export function readCustomAgent(
  input: CustomAgentInput,
  id: string,
): Result<CustomAgent> {
  const name = input.name.trim();
  if (input.protocol === "acp") {
    const command = splitCommand(input.command);
    if (!command.ok) return command;
    return ok({ id, name, protocol: "acp", command: command.value });
  }
  const start = splitCommand(input.start);
  if (!start.ok) return start;
  if (!uses(start.value, INSTRUCTIONS)) {
    return fail({ code: "AGENT_COMMAND_NEEDS", placeholder: INSTRUCTIONS });
  }
  const text = input.continue?.trim();
  if (!text) return ok({ id, name, protocol: "cli", start: start.value });
  const next = splitCommand(text);
  if (!next.ok) return next;
  for (const placeholder of [SESSION, INSTRUCTIONS] as const) {
    if (!uses(next.value, placeholder)) {
      return fail({ code: "AGENT_COMMAND_NEEDS", placeholder });
    }
  }
  return ok({
    id,
    name,
    protocol: "cli",
    start: start.value,
    continue: next.value,
  });
}

/**
 * Fills the placeholders in the arguments, never in the program. Each argument stays one
 * argument, whatever the values hold (D-21).
 */
export function fillCommand(
  command: readonly string[],
  values: { instructions: string; session: string },
): string[] {
  const [program = "", ...args] = command;
  return [
    program,
    ...args.map((arg) =>
      arg
        .replaceAll(INSTRUCTIONS, values.instructions)
        .replaceAll(SESSION, values.session),
    ),
  ];
}

function uses(command: readonly string[], placeholder: string): boolean {
  return command.slice(1).some((arg) => arg.includes(placeholder));
}
