import type { ToolName } from "../types/index.js";

/**
 * One step of install instructions (ENV-4). The interface turns `id` into text from the
 * translation files; `copy` is a command or path shown as-is with a copy button.
 */
export interface InstallStep {
  id: string;
  copy?: string;
  url?: string;
}

export interface InstallGuide {
  tool: ToolName;
  /** The official page for the tool. */
  url: string;
  steps: readonly InstallStep[];
}

const MAESTRO_DOCS =
  "https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli";

const BOTH: Readonly<
  Record<"java" | "adb" | "emulator" | "mockoon", InstallGuide>
> = {
  java: {
    tool: "java",
    url: "https://adoptium.net/",
    steps: [
      { id: "java.install-jdk-17-or-newer" },
      { id: "java.set-java-home" },
    ],
  },
  adb: {
    tool: "adb",
    url: "https://developer.android.com/tools/releases/platform-tools",
    steps: [
      {
        id: "adb.install-android-studio",
        url: "https://developer.android.com/studio",
      },
      { id: "adb.set-android-home" },
    ],
  },
  emulator: {
    tool: "emulator",
    url: "https://developer.android.com/studio/run/managing-avds",
    steps: [
      { id: "emulator.install-from-sdk-manager" },
      { id: "emulator.create-virtual-device" },
    ],
  },
  mockoon: {
    tool: "mockoon",
    url: "https://mockoon.com/cli/",
    steps: [
      { id: "mockoon.install-node", url: "https://nodejs.org/" },
      { id: "mockoon.install-with-npm", copy: "npm install -g @mockoon/cli" },
    ],
  },
};

// Native Windows is what Maestro's docs recommend; WSL only when strictly needed.
// The docs suggest `setx PATH`, which can cut a long PATH short, so the step points to the
// Environment Variables window instead.
const MAESTRO_WINDOWS: InstallGuide = {
  tool: "maestro",
  url: MAESTRO_DOCS,
  steps: [
    { id: "maestro.install-java-first" },
    {
      id: "maestro.windows.download-zip",
      url: "https://github.com/mobile-dev-inc/maestro/releases/latest",
    },
    { id: "maestro.windows.extract", copy: "C:\\maestro" },
    { id: "maestro.windows.add-to-path", copy: "C:\\maestro\\bin" },
    { id: "maestro.check-again" },
  ],
};

const MAESTRO_MACOS: InstallGuide = {
  tool: "maestro",
  url: MAESTRO_DOCS,
  steps: [
    { id: "maestro.install-java-first" },
    {
      id: "maestro.macos.run-install-script",
      copy: 'curl -Ls "https://get.maestro.mobile.dev" | bash',
    },
    { id: "maestro.check-again" },
  ],
};

/** Linux is only for CI so far and gets the macOS steps. */
export function installGuide(
  tool: ToolName,
  platform: NodeJS.Platform,
): InstallGuide {
  if (tool === "maestro") {
    return platform === "win32" ? MAESTRO_WINDOWS : MAESTRO_MACOS;
  }
  return BOTH[tool];
}
