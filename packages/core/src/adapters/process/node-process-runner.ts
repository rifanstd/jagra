import { spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import { join, win32 } from "node:path";
import { createInterface } from "node:readline";
import { fail, ok, type JagraError, type Result } from "../../errors/index.js";
import type { ActiveProcessStore } from "../../process/active-processes.js";
import type {
  OutputLine,
  ProcessExit,
  ProcessRunner,
  ProcessSpec,
  RunningProcess,
} from "../../ports/process-runner.js";

/** How long a program gets after SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 3000;

export interface NodeProcessRunnerOptions {
  store: ActiveProcessStore;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export class NodeProcessRunner implements ProcessRunner {
  private readonly store: ActiveProcessStore;
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: NodeProcessRunnerOptions) {
    this.store = options.store;
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
  }

  async start(
    spec: ProcessSpec,
    onLine?: (line: OutputLine) => void,
  ): Promise<Result<RunningProcess, JagraError>> {
    const resolved =
      this.platform === "win32"
        ? resolveWindowsProgram(spec.program, this.env)
        : ok(spec.program);
    if (!resolved.ok) return resolved;

    let child: ChildProcess;
    try {
      child = spawn(resolved.value, [...spec.args], {
        cwd: spec.cwd,
        env: { ...this.env, ...spec.env },
        shell: false,
        windowsHide: true,
        // Own process group on macOS and Linux, so stop() can signal the program and its children.
        detached: this.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      return fail({
        code: "PROGRAM_START_FAILED",
        program: spec.program,
        detail: String(e),
      });
    }

    const started = await new Promise<Result<number>>((resolve) => {
      child.once("spawn", () =>
        resolve(
          child.pid === undefined
            ? fail({
                code: "PROGRAM_START_FAILED",
                program: spec.program,
                detail: "no pid",
              })
            : ok(child.pid),
        ),
      );
      child.once("error", (e: NodeJS.ErrnoException) =>
        resolve(
          e.code === "ENOENT"
            ? fail({ code: "PROGRAM_NOT_FOUND", program: spec.program })
            : fail({
                code: "PROGRAM_START_FAILED",
                program: spec.program,
                detail: e.message,
              }),
        ),
      );
    });
    if (!started.ok) return started;
    const pid = started.value;

    const exited = this.watchExit(child, pid, onLine);
    const running: RunningProcess = {
      pid,
      exited,
      stop: () => this.stop(child, pid, exited),
    };

    try {
      await this.store.add({
        pid,
        program: spec.program,
        startedAt: new Date().toISOString(),
      });
    } catch (e) {
      await running.stop();
      return fail({
        code: "PROGRAM_START_FAILED",
        program: spec.program,
        detail: `could not record the process in state/active.json: ${String(e)}`,
      });
    }

    const signal = spec.signal;
    if (signal?.aborted) {
      await running.stop();
    } else if (signal) {
      const onAbort = () => void running.stop();
      signal.addEventListener("abort", onAbort, { once: true });
      void exited.then(() => signal.removeEventListener("abort", onAbort));
    }
    return ok(running);
  }

  private watchExit(
    child: ChildProcess,
    pid: number,
    onLine?: (line: OutputLine) => void,
  ): Promise<ProcessExit> {
    for (const stream of ["stdout", "stderr"] as const) {
      const source = child[stream];
      if (!source) continue;
      source.setEncoding("utf8");
      const lines = createInterface({ input: source, crlfDelay: Infinity });
      lines.on("line", (text) => onLine?.({ stream, text }));
    }
    return new Promise((resolve) => {
      child.once("close", (code, signal) => {
        // A leftover record is cleaned up on the next launch (REL-2), so a failed removal is not fatal.
        void this.store
          .remove(pid)
          .catch(() => undefined)
          .then(() => resolve({ code, signal }));
      });
    });
  }

  private async stop(
    child: ChildProcess,
    pid: number,
    exited: Promise<ProcessExit>,
  ) {
    if (child.exitCode !== null || child.signalCode !== null) {
      await exited;
      return;
    }
    if (this.platform === "win32") {
      await this.taskkill(pid);
    } else {
      signalGroup(pid, "SIGTERM");
      const timer = setTimeout(
        () => signalGroup(pid, "SIGKILL"),
        STOP_GRACE_MS,
      );
      await exited;
      clearTimeout(timer);
    }
    await exited;
  }

  private taskkill(pid: number): Promise<void> {
    // Full path, so a taskkill.exe in the working folder or on PATH is never picked up instead.
    const systemRoot =
      this.env.SystemRoot ?? this.env.SYSTEMROOT ?? "C:\\Windows";
    return new Promise((resolve) => {
      const killer = spawn(
        join(systemRoot, "System32", "taskkill.exe"),
        ["/PID", String(pid), "/T", "/F"],
        { shell: false, windowsHide: true, stdio: "ignore" },
      );
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (e) {
    // ESRCH: the group is already gone.
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
  }
}

/**
 * Finds a program on PATH the way Windows would, but only accepts `.exe` and `.com`.
 * Node refuses `.bat` and `.cmd` without a shell (CVE-2024-27980), and Jagra never uses one (D-21).
 * Unlike CreateProcess, the working folder is never searched, so a project cannot plant a program.
 */
export function resolveWindowsProgram(
  program: string,
  env: NodeJS.ProcessEnv,
): Result<string> {
  const pathExt = (env.PATHEXT ?? env.Pathext ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((e) => e.toLowerCase());
  const extensions = pathExt.includes(win32.extname(program).toLowerCase())
    ? [""]
    : pathExt;
  const hasFolder = program.includes("/") || program.includes("\\");
  const folders =
    hasFolder || win32.isAbsolute(program) ? [""] : pathFolders(env);

  for (const folder of folders) {
    for (const ext of extensions) {
      const candidate =
        folder === "" ? program + ext : win32.join(folder, program + ext);
      if (!isFile(candidate)) continue;
      const kind = win32.extname(candidate).toLowerCase();
      if (kind !== ".exe" && kind !== ".com") {
        return fail({ code: "PROGRAM_IS_SCRIPT", program, path: candidate });
      }
      return ok(candidate);
    }
  }
  return fail({ code: "PROGRAM_NOT_FOUND", program });
}

function pathFolders(env: NodeJS.ProcessEnv): string[] {
  const path = env.PATH ?? env.Path ?? "";
  return path
    .split(win32.delimiter)
    .map((folder) => folder.replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
