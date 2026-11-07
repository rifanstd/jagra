import { win32 } from "node:path";
import type { OutputLine, ProcessRunner } from "../../ports/process-runner.js";

const USER_KEY = "HKCU\\Environment";
const MACHINE_KEY =
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";

/**
 * The environment a newly opened window would get. A running process keeps the PATH it started
 * with, so a tool installed while Jagra is open would stay invisible to Check again (ENV-5).
 */
export async function freshWindowsEnvironment(
  runner: ProcessRunner,
  base: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const reg = win32.join(
    valueOf(base, "SystemRoot") ?? "C:\\Windows",
    "System32",
    "reg.exe",
  );
  const [machine, user] = await Promise.all([
    readKey(runner, reg, MACHINE_KEY),
    readKey(runner, reg, USER_KEY),
  ]);
  return mergeEnvironment(base, machine, user);
}

export type RegistryValues = Map<string, { value: string; expand: boolean }>;

/** User values win over machine values, except PATH, which is machine then user, as Windows does. */
export function mergeEnvironment(
  base: NodeJS.ProcessEnv,
  machine: RegistryValues,
  user: RegistryValues,
): NodeJS.ProcessEnv {
  const env = { ...base };
  const expand = (entry: { value: string; expand: boolean }) =>
    entry.expand
      ? entry.value.replace(
          /%([^%]+)%/g,
          (all, name: string) => valueOf(env, name) ?? all,
        )
      : entry.value;

  for (const values of [machine, user]) {
    for (const [name, entry] of values) {
      if (name.toUpperCase() !== "PATH") setValue(env, name, expand(entry));
    }
  }
  const path = [machine, user]
    .map((values) => findEntry(values, "PATH"))
    .filter((entry) => entry !== undefined)
    .map(expand)
    .join(";");
  if (path) setValue(env, "Path", path);
  return env;
}

/** Reads `reg query` output: `    Name    REG_EXPAND_SZ    value`. */
export function parseRegQuery(lines: readonly string[]): RegistryValues {
  const values: RegistryValues = new Map();
  for (const line of lines) {
    const match = /^ {4}(.+?) {4}(REG_SZ|REG_EXPAND_SZ) {4}(.*)$/.exec(line);
    if (match?.[1] && match[2] && match[3] !== undefined) {
      values.set(match[1], {
        value: match[3],
        expand: match[2] === "REG_EXPAND_SZ",
      });
    }
  }
  return values;
}

async function readKey(
  runner: ProcessRunner,
  reg: string,
  key: string,
): Promise<RegistryValues> {
  const lines: OutputLine[] = [];
  const started = await runner.start(
    { program: reg, args: ["query", key] },
    (line) => lines.push(line),
  );
  // Without the registry, the environment Jagra started with is still usable.
  if (!started.ok) return new Map();
  const exit = await started.value.exited;
  if (exit.code !== 0) return new Map();
  return parseRegQuery(
    lines.filter((l) => l.stream === "stdout").map((l) => l.text),
  );
}

function findEntry(values: RegistryValues, name: string) {
  for (const [key, entry] of values) {
    if (key.toUpperCase() === name) return entry;
  }
  return undefined;
}

function valueOf(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find(
    (k) => k.toUpperCase() === name.toUpperCase(),
  );
  return key === undefined ? undefined : env[key];
}

// Two keys that differ only in case would both reach a child process.
function setValue(env: NodeJS.ProcessEnv, name: string, value: string): void {
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === name.toUpperCase()) delete env[key];
  }
  env[name] = value;
}
