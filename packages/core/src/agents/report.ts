import { z } from "zod";

/** The report the template asks for (AGT-16). */
export interface AgentReport {
  /** The flow file, relative to the project folder, as the agent wrote it. */
  flow: string;
  checks: string;
  possibleBug?: string;
  suggestedTests: string[];
}

const text = z.string().trim().max(4000);
const reportSchema = z.object({
  flow: text.min(1),
  checks: text,
  possibleBug: text.nullish(),
  suggestedTests: z.array(text.min(1)).max(20).catch([]),
});

/**
 * The last JSON object in the agent's final message that has the report's shape. Agents often
 * wrap it in a code block or write a sentence after it, so both are allowed. Undefined when there
 * is none; the screen then shows the flow file and the raw message (AGT-16).
 */
export function readReport(message: string): AgentReport | undefined {
  const starts = [...message.matchAll(/\{/g)].map((match) => match.index);
  for (const start of starts.reverse()) {
    const candidate = balanced(message, start);
    if (candidate === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }
    const parsed = reportSchema.safeParse(value);
    if (!parsed.success) continue;
    const { flow, checks, possibleBug, suggestedTests } = parsed.data;
    return {
      flow,
      checks,
      ...(possibleBug ? { possibleBug } : {}),
      suggestedTests,
    };
  }
  return undefined;
}

/** The text from `{` at `start` to its matching `}`, skipping braces inside strings. */
function balanced(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}
