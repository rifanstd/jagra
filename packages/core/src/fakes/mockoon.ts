import { ok, type JagraError, type Result } from "../errors/index.js";
import type {
  MockServer,
  MockServerHandle,
  MockServerRequest,
} from "../ports/mock-server.js";
import type { PortChecker } from "../ports/port-checker.js";

export class FakeMockServer implements MockServer {
  readonly requests: MockServerRequest[] = [];
  /** Ports with a running fake server. */
  readonly running = new Set<number>();
  /** Lines the fake prints when it starts. */
  lines: string[] = [];
  failure: JagraError | undefined;
  private nextPid = 7000;

  start(request: MockServerRequest): Promise<Result<MockServerHandle>> {
    this.requests.push(request);
    if (this.failure)
      return Promise.resolve({ ok: false, error: this.failure });
    for (const line of this.lines) request.onLine?.(line);
    this.running.add(request.port);
    return Promise.resolve(
      ok({
        port: request.port,
        pid: this.nextPid++,
        stop: () => {
          this.running.delete(request.port);
          return Promise.resolve();
        },
      }),
    );
  }
}

export class FakePortChecker implements PortChecker {
  readonly busy = new Set<number>();

  isFree(port: number): Promise<boolean> {
    return Promise.resolve(!this.busy.has(port));
  }

  accepts(port: number): Promise<boolean> {
    return Promise.resolve(this.busy.has(port));
  }
}
