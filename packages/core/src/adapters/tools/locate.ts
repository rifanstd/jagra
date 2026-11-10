import { posix, win32 } from "node:path";
import type { ToolPaths } from "../../ports/tool-probe.js";
import type { ToolName } from "../../types/index.js";
import type { ToolFiles } from "./files.js";

export interface Machine {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  files: ToolFiles;
}

/** Where a tool lives. The hand-set path wins over detection (ENV-6). */
export function locateTool(
  tool: ToolName,
  paths: ToolPaths,
  machine: Machine,
): string | undefined {
  const manual = paths[tool];
  if (manual !== undefined) {
    return machine.files.isFile(manual) ? manual : undefined;
  }
  switch (tool) {
    case "java":
      return locateJava(machine);
    case "adb":
      return locateSdkTool(machine, "platform-tools", "adb");
    case "emulator":
      return locateSdkTool(machine, "emulator", "emulator");
    case "maestro":
      return machine.platform === "win32"
        ? onPath(machine, "maestro.bat")
        : firstFile(machine, [
            onPath(machine, "maestro"),
            // Where Maestro's install script puts it.
            pathFor(machine).join(machine.home, ".maestro", "bin", "maestro"),
          ]);
    case "mockoon":
      return onPath(
        machine,
        machine.platform === "win32" ? "mockoon-cli.cmd" : "mockoon-cli",
      );
  }
}

/** The Java that Maestro's own launcher would pick: JAVA_HOME first, then PATH. */
export function locateJava(machine: Machine): string | undefined {
  const javaHome = envValue(machine, "JAVA_HOME");
  const fromHome =
    javaHome && pathFor(machine).join(javaHome, "bin", exe(machine, "java"));
  return firstFile(machine, [fromHome, onPath(machine, exe(machine, "java"))]);
}

export function locateNode(
  machine: Machine,
  besides?: string,
): string | undefined {
  const local = besides && pathFor(machine).join(besides, exe(machine, "node"));
  return firstFile(machine, [local, onPath(machine, exe(machine, "node"))]);
}

// ANDROID_SDK_ROOT is deprecated but still set on many machines. The default SDK folder comes
// before PATH, so a copy of adb from another tool (scrcpy ships one) is used only when there is no
// SDK at all (D-66).
function locateSdkTool(
  machine: Machine,
  folder: string,
  name: string,
): string | undefined {
  const path = pathFor(machine);
  const inSdk = (root: string | undefined) =>
    root && path.join(root, folder, exe(machine, name));
  return firstFile(machine, [
    inSdk(envValue(machine, "ANDROID_HOME")),
    inSdk(envValue(machine, "ANDROID_SDK_ROOT")),
    inSdk(defaultSdk(machine)),
    onPath(machine, exe(machine, name)),
  ]);
}

function defaultSdk(machine: Machine): string {
  const { platform, home } = machine;
  if (platform === "win32") {
    const local =
      envValue(machine, "LOCALAPPDATA") ?? win32.join(home, "AppData", "Local");
    return win32.join(local, "Android", "Sdk");
  }
  if (platform === "darwin") {
    return posix.join(home, "Library", "Android", "sdk");
  }
  return posix.join(home, "Android", "Sdk");
}

export function onPath(machine: Machine, file: string): string | undefined {
  const path = pathFor(machine);
  return firstFile(
    machine,
    searchFolders(machine).map((folder) => path.join(folder, file)),
  );
}

function searchFolders(machine: Machine): string[] {
  const folders = (envValue(machine, "PATH") ?? "")
    .split(pathFor(machine).delimiter)
    .map((folder) => folder.replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
  // Apps opened from the macOS Finder get a short PATH without Homebrew.
  if (machine.platform === "darwin") {
    folders.push("/opt/homebrew/bin", "/usr/local/bin");
  }
  return folders;
}

function firstFile(
  machine: Machine,
  candidates: (string | undefined)[],
): string | undefined {
  return candidates.find(
    (candidate): candidate is string =>
      candidate !== undefined && machine.files.isFile(candidate),
  );
}

/** Reads a variable the way the system does: names ignore case on Windows. */
export function envValue(machine: Machine, name: string): string | undefined {
  if (machine.platform !== "win32") return machine.env[name] || undefined;
  const key = Object.keys(machine.env).find(
    (k) => k.toUpperCase() === name.toUpperCase(),
  );
  return (key && machine.env[key]) || undefined;
}

export function pathFor(machine: Machine) {
  return machine.platform === "win32" ? win32 : posix;
}

function exe(machine: Machine, name: string): string {
  return machine.platform === "win32" ? `${name}.exe` : name;
}
