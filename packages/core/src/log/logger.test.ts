import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../fakes/clock.js";
import { Logger, RotatingFileSink, type LogSink } from "./logger.js";
import { Masker } from "./masker.js";

class MemorySink implements LogSink {
  readonly lines: string[] = [];
  write(line: string): Promise<void> {
    this.lines.push(line);
    return Promise.resolve();
  }
}

describe("Logger", () => {
  it("writes one JSON line per entry with time, level and event", async () => {
    const sink = new MemorySink();
    const logger = new Logger(
      sink,
      new Masker(),
      new FakeClock(Date.UTC(2026, 10, 7, 9, 30)),
    );

    await logger.info("run-started", { flows: 5 });

    expect(sink.lines).toEqual([
      '{"flows":5,"time":"2026-11-07T09:30:00.000Z","level":"info","event":"run-started"}\n',
    ]);
  });

  it("masks secrets in the event and every field before writing (REL-7)", async () => {
    const sink = new MemorySink();
    const masker = new Masker();
    masker.add("hunter2");
    const logger = new Logger(sink, masker, new FakeClock());

    await logger.error("maestro-output hunter2", {
      line: "typed hunter2",
      args: ["-e", "P=hunter2"],
    });

    expect(sink.lines[0]).not.toContain("hunter2");
    expect(JSON.parse(sink.lines[0] ?? "{}")).toMatchObject({
      event: "maestro-output ***",
      line: "typed ***",
      args: ["-e", "P=***"],
    });
  });

  it("does not let a field replace the level or event", async () => {
    const sink = new MemorySink();
    const logger = new Logger(sink, new Masker(), new FakeClock());
    await logger.warn("real-event", { level: "info", event: "fake" });
    expect(JSON.parse(sink.lines[0] ?? "{}")).toMatchObject({
      level: "warn",
      event: "real-event",
    });
  });
});

describe("RotatingFileSink (REL-7)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jagra-logs-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("rotates at the size limit and removes the oldest file first", async () => {
    const sink = new RotatingFileSink(dir, { maxFileBytes: 10, maxFiles: 3 });
    for (const line of ["first-0\n", "second-\n", "third-0\n", "fourth-\n"])
      await sink.write(line);

    expect((await readdir(dir)).sort()).toEqual([
      "jagra.1.log",
      "jagra.2.log",
      "jagra.log",
    ]);
    expect(await readFile(join(dir, "jagra.log"), "utf8")).toBe("fourth-\n");
    expect(await readFile(join(dir, "jagra.1.log"), "utf8")).toBe("third-0\n");
    expect(await readFile(join(dir, "jagra.2.log"), "utf8")).toBe("second-\n");
  });

  it("appends to an existing log and counts its size", async () => {
    await new RotatingFileSink(dir, { maxFileBytes: 100, maxFiles: 2 }).write(
      "old\n",
    );
    await new RotatingFileSink(dir, { maxFileBytes: 100, maxFiles: 2 }).write(
      "new\n",
    );
    expect(await readFile(join(dir, "jagra.log"), "utf8")).toBe("old\nnew\n");
  });

  it("keeps entries in order when many are written at once", async () => {
    const sink = new RotatingFileSink(dir);
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => sink.write(`${i}\n`)),
    );
    const lines = (await readFile(join(dir, "jagra.log"), "utf8"))
      .trim()
      .split("\n");
    expect(lines).toEqual(Array.from({ length: 50 }, (_, i) => String(i)));
  });
});
