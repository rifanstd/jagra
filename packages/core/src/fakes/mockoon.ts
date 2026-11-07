import { ok, type JagraError, type Result } from "../errors/index.js";
import type { MockServer, MockServerHandle } from "../ports/mock-server.js";
import type { PortChecker } from "../ports/port-checker.js";

export class FakeMockServer implements MockServer {
  /** Ports with a running fake server. */
  readonly running = new Set<number>();
  failure: JagraError | undefined;

  start(
    _file: string,
    port: number | undefined,
  ): Promise<Result<MockServerHandle>> {
    if (this.failure)
      return Promise.resolve({ ok: false, error: this.failure });
    const actual = port ?? 3000;
    this.running.add(actual);
    return Promise.resolve(
      ok({
        port: actual,
        stop: () => {
          this.running.delete(actual);
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
}
