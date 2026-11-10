import { homedir } from "node:os";
import type { ProcessRunner } from "../../ports/process-runner.js";
import { nodeToolFiles, type ToolFiles } from "./files.js";
import type { Machine } from "./locate.js";
import { freshWindowsEnvironment } from "./windows-environment.js";

export interface MachineOptions {
  runner: ProcessRunner;
  platform?: NodeJS.Platform;
  /** Defaults to the current environment, read fresh from the registry on Windows (D-37). */
  environment?: () => Promise<NodeJS.ProcessEnv>;
  home?: string;
  files?: ToolFiles;
}

/** This computer, as the launch helpers need it to find Java and Node (D-34). */
export async function currentMachine(
  options: MachineOptions,
): Promise<Machine> {
  const platform = options.platform ?? process.platform;
  const env = options.environment
    ? await options.environment()
    : platform === "win32"
      ? await freshWindowsEnvironment(options.runner, process.env)
      : process.env;
  return {
    platform,
    env,
    home: options.home ?? homedir(),
    files: options.files ?? nodeToolFiles,
  };
}
