import { open } from "node:fs/promises";
import type { ToolStatus } from "@jagra/core";

/** The end of the log that goes into a bug report. Every line was masked when it was written. */
const LOG_TAIL_BYTES = 20 * 1024;

export interface BugInfoInput {
  version: string;
  system: string;
  electron: string;
  tools: readonly ToolStatus[];
  logFile: string;
}

/**
 * REL-7: what Copy info for bug report copies: Jagra's version, the operating system, each tool's
 * version and the latest part of the log. The tool lines leave out paths, which often hold the
 * user's name; the log may still show some. The user pastes the text themselves, so they see it all.
 */
export async function bugInfo(input: BugInfoInput): Promise<string> {
  const tools = input.tools.map(
    (t) =>
      `- ${t.tool}: ${t.version ?? "-"} (${t.state}${t.problem ? `, ${t.problem}` : ""})`,
  );
  return [
    `Jagra ${input.version}`,
    `System: ${input.system}`,
    `Electron: ${input.electron}`,
    "Tools:",
    ...(tools.length > 0 ? tools : ["- not checked yet"]),
    "",
    "Log (latest part):",
    await tail(input.logFile, LOG_TAIL_BYTES),
  ].join("\n");
}

/** The last bytes of a file, from the start of a whole line. */
async function tail(file: string, bytes: number): Promise<string> {
  let handle;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } catch {
    return "(no log yet)";
  } finally {
    await handle?.close();
  }
}
