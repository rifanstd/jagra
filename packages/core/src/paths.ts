import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/**
 * Jagra's local data folder, shared by the desktop app and the CLI (docs/architecture.md section 4).
 * Windows uses the local, not roaming, profile: runs and logs are large and tied to this machine.
 */
export function appDataFolder(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    return win32.join(
      env.LOCALAPPDATA ?? win32.join(home, "AppData", "Local"),
      "jagra",
    );
  }
  if (platform === "darwin") {
    return posix.join(home, "Library", "Application Support", "jagra");
  }
  // Linux is only for CI so far (to-verify.md).
  return posix.join(
    env.XDG_CONFIG_HOME || posix.join(home, ".config"),
    "jagra",
  );
}

export function activeProcessesFile(appData: string): string {
  return joinFor(appData, "state", "active.json");
}

export function logsFolder(appData: string): string {
  return joinFor(appData, "logs");
}

function joinFor(base: string, ...parts: string[]): string {
  return base.includes("\\")
    ? win32.join(base, ...parts)
    : posix.join(base, ...parts);
}
