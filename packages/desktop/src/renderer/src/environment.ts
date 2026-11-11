import type { ToolName, ToolStatus } from "@jagra/core/types";
import type { EnvironmentView } from "../../shared/api";
import type { Tone } from "./components/status";

/** The order of the rows on screen 1. Which tools are required comes from core (ENV-2). */
export const TOOL_ORDER: readonly ToolName[] = [
  "java",
  "adb",
  "maestro",
  "emulator",
  "mockoon",
];
export const REQUIRED_TOOLS: ReadonlySet<ToolName> = new Set([
  "java",
  "adb",
  "maestro",
]);

/** How a tool's state looks (ENV-2): the status tone and the key of its word. */
export function toolLook(status: ToolStatus | undefined): {
  tone: Tone;
  label: string;
} {
  if (!status) return { tone: "running", label: "env.state.checking" };
  switch (status.state) {
    case "ready":
      return { tone: "passed", label: "env.state.ready" };
    case "untested-version":
      return { tone: "warning", label: "env.state.untested-version" };
    case "too-old":
      return { tone: "failed", label: "env.state.too-old" };
    case "cant-start":
      return { tone: "failed", label: "env.state.cant-start" };
    case "missing":
      return status.required
        ? { tone: "failed", label: "env.state.missing" }
        : { tone: "optional", label: "env.state.missing-optional" };
  }
}

/**
 * Whether the instructions show at once or behind "How to install" (ENV-4). They show at once for
 * a tool that stops runs: a required tool that is not usable, or any tool that is too old or
 * cannot start.
 */
export function guideShown(status: ToolStatus): "open" | "closed" | "none" {
  switch (status.state) {
    case "ready":
      return "none";
    case "untested-version":
      return "closed";
    case "missing":
      return status.required ? "open" : "closed";
    case "too-old":
    case "cant-start":
      return "open";
  }
}

/** The first required tool that stops runs, for the status indicator on the project list (ENV-7). */
export function blockingTool(view: EnvironmentView): ToolStatus | undefined {
  return view.tools
    .map((t) => t.status)
    .find(
      (s) =>
        s.required && s.state !== "ready" && s.state !== "untested-version",
    );
}
