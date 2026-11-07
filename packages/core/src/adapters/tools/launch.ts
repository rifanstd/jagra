import type { ToolPaths } from "../../ports/tool-probe.js";
import type { ProcessSpec } from "../../ports/process-runner.js";
import type { ToolProblem } from "../../types/index.js";
import { locateNode, locateTool, pathFor, type Machine } from "./locate.js";

export type Launch =
  | { ok: true; spec: Omit<ProcessSpec, "signal"> }
  | { ok: false; problem: ToolProblem; detail?: string };

/** Maestro sends analytics and checks for updates unless told not to (D-36). */
export const MAESTRO_ENV: Readonly<Record<string, string>> = {
  MAESTRO_CLI_NO_ANALYTICS: "1",
  MAESTRO_DISABLE_UPDATE_CHECK: "true",
  MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
};

/**
 * How to start Maestro without a shell (D-34). On Windows `maestro.bat` only runs Java with
 * the jars in `lib`, so Jagra does the same. The macOS script is started directly.
 */
export function maestroLaunch(
  maestro: string,
  args: readonly string[],
  paths: ToolPaths,
  machine: Machine,
): Launch {
  const java = locateTool("java", paths, machine);
  const path = pathFor(machine);

  if (machine.platform !== "win32") {
    // The script reads JAVA_HOME, so a hand-set Java reaches it this way.
    const env =
      paths.java && java
        ? { ...MAESTRO_ENV, JAVA_HOME: path.dirname(path.dirname(java)) }
        : MAESTRO_ENV;
    return { ok: true, spec: { program: maestro, args, env } };
  }

  const lib = path.join(path.dirname(path.dirname(maestro)), "lib");
  if (!machine.files.isFolder(lib)) {
    return { ok: false, problem: "failed", detail: `no lib folder at ${lib}` };
  }
  if (java === undefined) return { ok: false, problem: "needs-java" };
  return {
    ok: true,
    spec: {
      program: java,
      args: [
        "--enable-native-access=ALL-UNNAMED",
        "-classpath",
        path.join(lib, "*"),
        "maestro.cli.AppKt",
        ...args,
      ],
      env: MAESTRO_ENV,
    },
  };
}

/**
 * How to start Mockoon CLI without a shell (D-34). npm installs it as a `.cmd` shim on Windows
 * and a link on macOS; both lead to a JavaScript file that Jagra hands to Node itself.
 */
export function mockoonLaunch(
  mockoon: string,
  args: readonly string[],
  machine: Machine,
): Launch {
  const path = pathFor(machine);
  const entry = mockoonEntry(mockoon, machine);
  if (entry === undefined) {
    return {
      ok: false,
      problem: "failed",
      detail: `no @mockoon/cli package next to ${mockoon}`,
    };
  }
  // npm's shim prefers a node.exe next to itself, then the one on PATH.
  const node = locateNode(
    machine,
    machine.platform === "win32" ? path.dirname(mockoon) : undefined,
  );
  if (node === undefined) return { ok: false, problem: "needs-node" };
  return { ok: true, spec: { program: node, args: [entry, ...args] } };
}

function mockoonEntry(mockoon: string, machine: Machine): string | undefined {
  const path = pathFor(machine);
  if (path.extname(mockoon).toLowerCase() === ".js") return mockoon;
  if (machine.platform !== "win32") {
    const target = machine.files.realPath(mockoon);
    return path.extname(target) === ".js" ? target : undefined;
  }
  const packageFolder = path.join(
    path.dirname(mockoon),
    "node_modules",
    "@mockoon",
    "cli",
  );
  const bin = readBin(
    machine.files.readText(path.join(packageFolder, "package.json")),
  );
  return bin === undefined ? undefined : path.join(packageFolder, bin);
}

function readBin(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  try {
    const bin: unknown = (JSON.parse(text) as { bin?: unknown }).bin;
    if (typeof bin === "string") return bin;
    if (bin && typeof bin === "object" && "mockoon-cli" in bin) {
      const entry = bin["mockoon-cli"];
      return typeof entry === "string" ? entry : undefined;
    }
  } catch {
    // A broken package.json is reported as a tool that cannot start.
  }
  return undefined;
}
