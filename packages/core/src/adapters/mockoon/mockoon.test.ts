import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../fakes/clock.js";
import {
  FakeProcessRunner,
  type FakeProgram,
} from "../../fakes/process-runner.js";
import { FakeToolFiles } from "../../fakes/tool-files.js";
import type { PortChecker } from "../../ports/port-checker.js";
import { MockoonServer } from "./mockoon-server.js";
import { NodePortChecker } from "./node-port-checker.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => s.close(r))),
  );
});

/** Listens on a free port picked by the system and returns it. */
function listen(host: string, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    servers.push(server);
    server.once("error", reject);
    server.listen({ host, port, exclusive: true }, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

async function freePort(): Promise<number> {
  const port = await listen("127.0.0.1");
  await new Promise((r) => servers.pop()?.close(r));
  return port;
}

describe("NodePortChecker (MCK-3, D-62)", () => {
  const checker = new NodePortChecker();

  it("calls a port nobody uses free", async () => {
    expect(await checker.isFree(await freePort())).toBe(true);
  });

  it("calls a port taken on 127.0.0.1 busy", async () => {
    const port = await listen("127.0.0.1");
    expect(await checker.isFree(port)).toBe(false);
    expect(await checker.accepts(port)).toBe(true);
  });

  it("calls a port taken on 0.0.0.0 busy, as the Mockoon desktop app does", async () => {
    const port = await listen("0.0.0.0");
    expect(await checker.isFree(port)).toBe(false);
  });
});

const MOCKOON = "/usr/local/bin/mockoon-cli.js";

/** A Mockoon CLI whose behaviour the test picks. */
function setup(
  behaviour: (args: readonly string[]) => FakeProgram,
  ports?: PortChecker,
) {
  const runner = new FakeProcessRunner();
  runner.define("/usr/local/bin/node", behaviour);
  const clock = new FakeClock();
  const server = new MockoonServer({
    runner,
    mockoon: MOCKOON,
    clock,
    ports,
    platform: "darwin",
    environment: () => Promise.resolve({ PATH: "/usr/local/bin" }),
    files: new FakeToolFiles().file("/usr/local/bin/node"),
    readySeconds: 1,
  });
  return { runner, clock, server };
}

/** Moves the fake clock until the promise settles. */
async function drive<T>(clock: FakeClock, promise: Promise<T>): Promise<T> {
  let done = false;
  void promise.finally(() => (done = true));
  for (let i = 0; i < 100 && !done; i++) {
    await new Promise((r) => setTimeout(r, 1));
    clock.advance(200);
  }
  return promise;
}

describe("MockoonServer (MCK-2, D-61)", () => {
  it("starts Mockoon CLI on 127.0.0.1, without admin API or log files, and waits for the port", async () => {
    // Not ready the first two times Jagra asks, then ready.
    let asked = 0;
    const ports: PortChecker = {
      isFree: () => Promise.resolve(true),
      accepts: () => Promise.resolve(++asked >= 3),
    };
    const lines: string[] = [];
    const { runner, clock, server } = setup(
      () => ({
        lines: [
          {
            stream: "stdout",
            text: '{"message":"Server started on port 3000"}',
          },
        ],
      }),
      ports,
    );
    const starting = server.start({
      file: "/p/.jagra/mockoon.json",
      port: 3000,
      onLine: (l) => lines.push(l),
    });
    const started = await drive(clock, starting);

    expect(started.ok && started.value.port).toBe(3000);
    expect(asked).toBe(3);
    expect(runner.calls[0]?.args).toEqual([
      MOCKOON,
      "start",
      "--data",
      "/p/.jagra/mockoon.json",
      "--port",
      "3000",
      "--hostname",
      "127.0.0.1",
      "--disable-admin-api",
      "--disable-log-to-file",
    ]);
    expect(runner.calls[0]?.args).not.toContain("--repair");
    expect(lines).toEqual(['{"message":"Server started on port 3000"}']);
  });

  it("reports Mockoon that exits with its last lines", async () => {
    const ports: PortChecker = {
      isFree: () => Promise.resolve(true),
      accepts: () => Promise.resolve(false),
    };
    const { clock, server } = setup(
      () => ({
        lines: [{ stream: "stderr", text: "Error: the data file is invalid" }],
        exit: { code: 1, signal: null },
      }),
      ports,
    );
    expect(
      await drive(clock, server.start({ file: "/f.json", port: 3000 })),
    ).toEqual({
      ok: false,
      error: {
        code: "MOCKOON_EXITED",
        detail: "Error: the data file is invalid",
      },
    });
  });

  it("stops Mockoon that is not ready in time", async () => {
    const ports: PortChecker = {
      isFree: () => Promise.resolve(true),
      accepts: () => Promise.resolve(false),
    };
    const { clock, server } = setup(() => ({ lines: [] }), ports);
    expect(
      await drive(clock, server.start({ file: "/f.json", port: 3000 })),
    ).toEqual({
      ok: false,
      error: { code: "MOCKOON_NOT_READY", port: 3000, seconds: 1 },
    });
  });

  it("stops Mockoon when cancelled while waiting", async () => {
    const ports: PortChecker = {
      isFree: () => Promise.resolve(true),
      accepts: () => Promise.resolve(false),
    };
    const { server } = setup(() => ({ lines: [] }), ports);
    const controller = new AbortController();
    controller.abort();
    expect(
      await server.start({
        file: "/f.json",
        port: 3000,
        signal: controller.signal,
      }),
    ).toEqual({
      ok: false,
      error: { code: "CANCELLED" },
    });
  });
});
