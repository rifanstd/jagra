import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyFlow, parseFlow, type Flow } from "./flow.js";

export interface FlowList {
  /** Top-level flows in `.jagra/flows`, sorted by file name (RUN-1). */
  flows: Flow[];
  /** Helper flows in `.jagra/flows/parts`, never run on their own (FLOW-3). */
  helpers: Flow[];
  /** Files a `runFlow` points to outside both folders. */
  others: Flow[];
}

export function flowsFolder(projectFolder: string): string {
  return join(projectFolder, ".jagra", "flows");
}

/** Reads and checks every flow and helper flow. Broken files come back with their problems. */
export async function discoverFlows(projectFolder: string): Promise<FlowList> {
  const folder = flowsFolder(projectFolder);
  const flows = await readFolder(folder, false);
  const helpers = await readFolder(join(folder, "parts"), true);
  const others: Flow[] = [];

  const known = new Map([...flows, ...helpers].map((f) => [f.file, f]));
  const missing = new Set<string>();
  // Grows while it runs, so helpers called from loaded helpers are checked too.
  const queue = [...flows, ...helpers];
  for (const flow of queue) {
    for (const call of flow.calls) {
      if (!known.has(call.file) && !missing.has(call.file)) {
        const loaded = await readFlow(call.file, true);
        if (loaded) {
          known.set(call.file, loaded);
          others.push(loaded);
          queue.push(loaded);
        } else {
          missing.add(call.file);
        }
      }
      if (missing.has(call.file)) {
        flow.problems.push({
          code: "FLOW_HELPER_NOT_FOUND",
          file: flow.file,
          line: call.line,
          helper: call.file,
        });
      }
    }
  }
  return { flows, helpers, others };
}

/**
 * Variables a flow needs from outside, including those of the helper flows it calls (RUN-10).
 * Values a call passes in its `env:` are not needed from outside.
 */
export function variablesNeeded(flow: Flow, list: FlowList): string[] {
  const byFile = new Map(
    [...list.flows, ...list.helpers, ...list.others].map((f) => [f.file, f]),
  );
  const visit = (current: Flow, seen: Set<string>): Set<string> => {
    const needed = new Set(current.variables);
    for (const call of current.calls) {
      const helper = byFile.get(call.file);
      if (!helper || seen.has(helper.file)) continue;
      for (const name of visit(helper, new Set([...seen, helper.file]))) {
        if (!call.passes.includes(name)) needed.add(name);
      }
    }
    return needed;
  };
  return [...visit(flow, new Set([flow.file]))].sort();
}

async function readFolder(folder: string, isHelper: boolean): Promise<Flow[]> {
  let names: string[];
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    names = entries
      .filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name))
      .map((e) => e.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  // Plain code point order, so every system lists flows the same way.
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const flows: Flow[] = [];
  for (const name of names) {
    const file = join(folder, name);
    flows.push(
      (await readFlow(file, isHelper)) ??
        emptyFlow(file, isHelper, [
          {
            code: "FILE_READ_FAILED",
            file,
            detail: "the file was removed while reading",
          },
        ]),
    );
  }
  return flows;
}

/** Undefined when the file does not exist. */
async function readFlow(
  file: string,
  isHelper: boolean,
): Promise<Flow | undefined> {
  try {
    return parseFlow(await readFile(file, "utf8"), file, isHelper);
  } catch (e) {
    const error = e as NodeJS.ErrnoException;
    if (error.code === "ENOENT") return undefined;
    return emptyFlow(file, isHelper, [
      { code: "FILE_READ_FAILED", file, detail: error.message },
    ]);
  }
}
