import type { JagraError, ProcessSpec, Result } from "@jagra/core";

export interface OpenFileOptions {
  /** The editor program chosen in Settings, if any (FLOW-5). */
  editor?: string;
  platform: NodeJS.Platform;
  /** Starts a program that outlives Jagra, without a shell (SEC-8). */
  launch(
    spec: Omit<ProcessSpec, "signal" | "output">,
  ): Promise<Result<void, JagraError>>;
  /** The system's default app for the file. */
  openPath(path: string): Promise<void>;
  onProblem(error: JagraError): void;
}

/**
 * FLOW-5: opens a flow or config file with the editor chosen in Settings, else with the system's
 * default app. A macOS app bundle is opened through `open -a`. When the editor cannot start,
 * the file still opens with the default app and the problem is logged.
 */
export async function openFile(
  path: string,
  options: OpenFileOptions,
): Promise<void> {
  const { editor } = options;
  if (editor) {
    const spec =
      options.platform === "darwin" && editor.endsWith(".app")
        ? { program: "/usr/bin/open", args: ["-a", editor, path] }
        : { program: editor, args: [path] };
    const started = await options.launch(spec);
    if (started.ok) return;
    options.onProblem(started.error);
  }
  await options.openPath(path);
}
