import { fail, ok, type Result } from "../../errors/index.js";
import type { Clock } from "../../ports/clock.js";
import type {
  MockServer,
  MockServerHandle,
  MockServerRequest,
} from "../../ports/mock-server.js";
import type { PortChecker } from "../../ports/port-checker.js";
import type { ProcessRunner } from "../../ports/process-runner.js";
import { SystemClock } from "../clock/system-clock.js";
import type { ToolFiles } from "../tools/files.js";
import { mockoonLaunch } from "../tools/launch.js";
import { currentMachine } from "../tools/machine.js";
import { NodePortChecker } from "./node-port-checker.js";

/** MCK-2: Mockoon must accept connections within this time. */
export const MOCKOON_READY_SECONDS = 30;
const POLL_MS = 200;

export interface MockoonServerOptions {
  runner: ProcessRunner;
  /** Full path to Mockoon CLI, from the environment check. */
  mockoon: string;
  clock?: Clock;
  ports?: PortChecker;
  platform?: NodeJS.Platform;
  environment?: () => Promise<NodeJS.ProcessEnv>;
  home?: string;
  files?: ToolFiles;
  readySeconds?: number;
}

/**
 * Starts Mockoon CLI with the project's file, listening on 127.0.0.1 only, without its admin API
 * and without log files, and waits until the port accepts connections (MCK-2, D-61).
 */
export class MockoonServer implements MockServer {
  private readonly options: MockoonServerOptions;
  private readonly clock: Clock;
  private readonly ports: PortChecker;

  constructor(options: MockoonServerOptions) {
    this.options = options;
    this.clock = options.clock ?? new SystemClock();
    this.ports = options.ports ?? new NodePortChecker();
  }

  async start(request: MockServerRequest): Promise<Result<MockServerHandle>> {
    const args = [
      "start",
      "--data",
      request.file,
      "--port",
      String(request.port),
      "--hostname",
      "127.0.0.1",
      "--disable-admin-api",
      "--disable-log-to-file",
    ];
    const launch = mockoonLaunch(
      this.options.mockoon,
      args,
      await currentMachine(this.options),
    );
    if (!launch.ok) {
      return fail({
        code: "PROGRAM_START_FAILED",
        program: "mockoon",
        detail: [launch.problem, launch.detail].filter(Boolean).join(": "),
      });
    }

    const lines: string[] = [];
    const started = await this.options.runner.start(launch.spec, (line) => {
      lines.push(line.text);
      request.onLine?.(line.text);
    });
    if (!started.ok) return started;
    const mockoon = started.value;
    let exited = false;
    void mockoon.exited.then(() => (exited = true));
    const handle: MockServerHandle = {
      port: request.port,
      pid: mockoon.pid,
      stop: () => mockoon.stop(),
    };

    const seconds = this.options.readySeconds ?? MOCKOON_READY_SECONDS;
    const deadline = this.clock.now() + seconds * 1000;
    for (;;) {
      if (request.signal?.aborted) {
        await mockoon.stop();
        return fail({ code: "CANCELLED" });
      }
      if (await this.ports.accepts(request.port)) return ok(handle);
      if (exited) {
        return fail({
          code: "MOCKOON_EXITED",
          detail: lines.slice(-10).join("\n"),
        });
      }
      if (this.clock.now() >= deadline) {
        await mockoon.stop();
        return fail({ code: "MOCKOON_NOT_READY", port: request.port, seconds });
      }
      await this.clock.sleep(POLL_MS, request.signal).catch(() => undefined);
    }
  }
}
