import { join } from "node:path";
import type { ProcessControl } from "../../ports/process-control.js";
import type { OutputLine, ProcessRunner } from "../../ports/process-runner.js";

export interface NodeProcessControlOptions {
  runner: ProcessRunner;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/**
 * Finds who listens on a port with `netstat -ano` on Windows and `lsof` on macOS and Linux, and
 * stops a process tree with `taskkill /T /F` or a signal to its process group (D-63). Full paths,
 * so a program of the same name in a project folder is never picked up.
 */
export class NodeProcessControl implements ProcessControl {
  private readonly runner: ProcessRunner;
  private readonly platform: NodeJS.Platform;
  private readonly system32: string;

  constructor(options: NodeProcessControlOptions) {
    this.runner = options.runner;
    this.platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    this.system32 = join(
      env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows",
      "System32",
    );
  }

  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  async listeningPids(port: number): Promise<number[]> {
    if (this.platform === "win32") {
      const lines = await this.output(join(this.system32, "NETSTAT.EXE"), [
        "-ano",
        "-p",
        "TCP",
      ]);
      return parseNetstat(lines, port);
    }
    const lines = await this.output("/usr/sbin/lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]);
    return [
      ...new Set(
        lines
          .map((l) => Number(l.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
  }

  async kill(pid: number): Promise<void> {
    if (this.platform === "win32") {
      await this.output(join(this.system32, "taskkill.exe"), [
        "/PID",
        String(pid),
        "/T",
        "/F",
      ]);
      return;
    }
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGTERM");
        return;
      } catch {
        // Not a group leader, or already gone: try the process itself.
      }
    }
  }

  private async output(program: string, args: string[]): Promise<string[]> {
    const lines: OutputLine[] = [];
    const started = await this.runner.start(
      { program, args, signal: AbortSignal.timeout(10_000) },
      (line) => lines.push(line),
    );
    if (!started.ok) return [];
    await started.value.exited;
    return lines.filter((l) => l.stream === "stdout").map((l) => l.text);
  }
}

/** PIDs in `netstat -ano` lines that listen on the port, on any local address. */
export function parseNetstat(lines: readonly string[], port: number): number[] {
  const pids = new Set<number>();
  for (const line of lines) {
    const [proto, local, , state, pid] = line.trim().split(/\s+/);
    if (proto?.toUpperCase() !== "TCP" || state !== "LISTENING") continue;
    if (local?.slice(local.lastIndexOf(":") + 1) !== String(port)) continue;
    const value = Number(pid);
    if (Number.isInteger(value) && value > 0) pids.add(value);
  }
  return [...pids];
}
