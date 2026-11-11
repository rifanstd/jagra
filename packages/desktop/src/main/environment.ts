import {
  ALL_TOOLS,
  checkEnvironment,
  installGuide,
  type ToolPaths,
  type ToolProbe,
  type ToolStatus,
} from "@jagra/core";
import type { EnvironmentView, ToolView } from "../shared/api.js";

/** States in which a tool needs no instructions. */
const FINE = new Set<ToolStatus["state"]>(["ready"]);

/**
 * Runs the environment check (ENV-1) and adds install or update instructions for this system to
 * every tool that is not Ready (ENV-4).
 */
export async function checkTools(options: {
  probe: ToolProbe;
  paths: ToolPaths;
  platform: NodeJS.Platform;
  now: () => number;
  onProgress?: (status: ToolStatus) => void;
}): Promise<EnvironmentView> {
  const started = options.now();
  const statuses = await checkEnvironment(options.probe, {
    paths: options.paths,
    onProgress: options.onProgress,
  });
  const tools: ToolView[] = statuses.map((status) => {
    if (FINE.has(status.state)) return { status };
    const guide = installGuide(status.tool, options.platform);
    return { status, guide: { url: guide.url, steps: [...guide.steps] } };
  });
  return {
    tools,
    ready: statuses.every(
      (s) =>
        !s.required || s.state === "ready" || s.state === "untested-version",
    ),
    tookMs: Math.max(0, Math.round(options.now() - started)),
  };
}

/** Every link the install instructions may open, on any system. Nothing else is opened. */
export function knownLinks(): Set<string> {
  const links = new Set<string>();
  for (const platform of ["win32", "darwin"] as const) {
    for (const tool of ALL_TOOLS) {
      const guide = installGuide(tool, platform);
      links.add(guide.url);
      for (const step of guide.steps) if (step.url) links.add(step.url);
    }
  }
  return links;
}
