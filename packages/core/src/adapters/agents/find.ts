import { KNOWN_AGENTS, type KnownAgentId } from "../../agents/known.js";
import type { Launch } from "../tools/launch.js";
import { locateNode, onPath, pathFor, type Machine } from "../tools/locate.js";
import { currentMachine, type MachineOptions } from "../tools/machine.js";

export interface AgentFinding {
  id: KnownAgentId;
  /** Where its program is. Missing when the agent is not installed. */
  path?: string;
}

/** Looks for the known agents' programs (AGT-1). Reads no file of theirs but the npm shim. */
export function findAgents(machine: Machine): AgentFinding[] {
  return KNOWN_AGENTS.map((agent) => {
    const path = findProgram(machine, agent.program);
    return path ? { id: agent.id, path } : { id: agent.id };
  });
}

/** The same, on this computer, with `PATH` read fresh on Windows (D-37). */
export async function detectAgents(
  options: MachineOptions,
): Promise<AgentFinding[]> {
  return findAgents(await currentMachine(options));
}

/** Where a custom agent's program is: a full path as it is, or a name found on `PATH`. */
export async function locateAgentProgram(
  options: MachineOptions,
  program: string,
): Promise<string | undefined> {
  const machine = await currentMachine(options);
  if (pathFor(machine).isAbsolute(program)) {
    return machine.files.isFile(program) ? program : undefined;
  }
  return findProgram(machine, program);
}

/** A program on `PATH`. On Windows a `.exe` first, then an npm `.cmd` shim (D-104). */
export function findProgram(
  machine: Machine,
  program: string,
): string | undefined {
  if (machine.platform === "win32") {
    return (
      onPath(machine, `${program}.exe`) ?? onPath(machine, `${program}.cmd`)
    );
  }
  return (
    onPath(machine, program) ??
    // Where Claude Code's own installer puts it; a Finder-opened app's PATH misses it.
    [pathFor(machine).join(machine.home, ".local", "bin", program)].find(
      (path) => machine.files.isFile(path),
    )
  );
}

/**
 * How to start an agent without a shell. On Windows a `.exe` starts directly, and an npm `.cmd`
 * shim is read to find what it starts: a `.exe` directly, a `.js` file with Node (D-104).
 */
export function agentLaunch(
  program: string,
  args: readonly string[],
  machine: Machine,
): Launch {
  const path = pathFor(machine);
  if (machine.platform !== "win32") {
    return { ok: true, spec: { program, args } };
  }
  const extension = path.extname(program).toLowerCase();
  if (extension === ".exe" || extension === ".com") {
    return { ok: true, spec: { program, args } };
  }
  if (extension !== ".cmd") {
    return { ok: false, problem: "failed", detail: `${program} is a script` };
  }
  const target = shimTarget(program, machine);
  if (target === undefined) {
    return {
      ok: false,
      problem: "failed",
      detail: `cannot tell what ${program} starts`,
    };
  }
  if (path.extname(target).toLowerCase() === ".exe") {
    return { ok: true, spec: { program: target, args } };
  }
  // npm's shim prefers a node.exe next to itself, then the one on PATH.
  const node = locateNode(machine, path.dirname(program));
  if (node === undefined) return { ok: false, problem: "needs-node" };
  return { ok: true, spec: { program: node, args: [target, ...args] } };
}

/** The `.exe` or `.js` file an npm shim starts, from its `"%dp0%\..."` path. */
function shimTarget(shim: string, machine: Machine): string | undefined {
  const text = machine.files.readText(shim);
  if (text === undefined) return undefined;
  const path = pathFor(machine);
  const targets = [...text.matchAll(/"%dp0%\\([^"%]+\.(?:exe|js))"/gi)]
    .map((match) => match[1])
    .filter((target): target is string => target !== undefined)
    .map((target) => path.join(path.dirname(shim), target));
  const last = targets.at(-1);
  return last !== undefined && machine.files.isFile(last) ? last : undefined;
}
