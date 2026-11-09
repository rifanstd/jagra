import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActiveProcessFile } from "../../process/active-processes.js";
import type { OutputLine, RunningProcess } from "../../ports/process-runner.js";
import {
  NodeProcessRunner,
  resolveWindowsProgram,
} from "./node-process-runner.js";

const NODE = process.execPath;
const isWindows = process.platform === "win32";

let dir: string;
let store: ActiveProcessFile;
let runner: NodeProcessRunner;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jagra-process-"));
  store = new ActiveProcessFile(join(dir, "state", "active.json"));
  runner = new NodeProcessRunner({ store });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function startOk(
  args: string[],
  lines: OutputLine[] = [],
  signal?: AbortSignal,
) {
  const started = await runner.start(
    { program: NODE, args, cwd: dir, signal },
    (line) => lines.push(line),
  );
  if (!started.ok)
    throw new Error(`could not start: ${JSON.stringify(started.error)}`);
  return started.value;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilGone(pid: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// Prints the grandchild's pid, then keeps both processes alive until stopped.
const PARENT_WITH_GRANDCHILD = `
  const { spawn } = require("node:child_process");
  const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  console.log("grandchild " + grandchild.pid);
  setInterval(() => {}, 1000);
`;

async function grandchildPid(lines: OutputLine[]): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const line = lines.find((l) => l.text.startsWith("grandchild "));
    if (line) return Number(line.text.split(" ")[1]);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the parent never reported its grandchild");
}

describe("NodeProcessRunner without a shell (SEC-8)", () => {
  it("passes arguments full of shell characters through unchanged", async () => {
    const hostile = [
      '"; rm -rf ~"',
      "a & echo injected",
      "a | echo injected",
      "a && echo injected",
      "%PATH%",
      "$(echo injected)",
      "`echo injected`",
      "x > created-by-shell.txt",
      "'single quotes'",
      '"double quotes"',
      "^caret !bang!",
      "trailing backslash\\",
      'quote at the end\\"',
      "spaces  and\ttab",
      "",
      "Login with wrong password, ñ é 日本",
    ];
    const lines: OutputLine[] = [];
    const proc = await startOk(
      [
        "-e",
        "process.stdout.write(JSON.stringify(process.argv.slice(1)) + '\\n')",
        ...hostile,
      ],
      lines,
    );
    expect(await proc.exited).toEqual({ code: 0, signal: null });
    expect(JSON.parse(lines[0]?.text ?? "null")).toEqual(hostile);
    expect(await readdir(dir)).not.toContain("created-by-shell.txt");
  });

  it("adds the given variables to the environment", async () => {
    const lines: OutputLine[] = [];
    const started = await runner.start(
      {
        program: NODE,
        args: ["-e", "console.log(process.env.JAGRA_TEST_VALUE)"],
        env: { JAGRA_TEST_VALUE: "a & b" },
      },
      (line) => lines.push(line),
    );
    if (!started.ok) throw new Error("could not start");
    await started.value.exited;
    expect(lines).toEqual([{ stream: "stdout", text: "a & b" }]);
  });

  it("streams stdout and stderr line by line", async () => {
    const lines: OutputLine[] = [];
    const proc = await startOk(
      ["-e", "console.log('one'); console.error('two'); console.log('three')"],
      lines,
    );
    await proc.exited;
    expect(
      lines.filter((l) => l.stream === "stdout").map((l) => l.text),
    ).toEqual(["one", "three"]);
    expect(
      lines.filter((l) => l.stream === "stderr").map((l) => l.text),
    ).toEqual(["two"]);
  });

  it("hands over raw output when asked for chunks", async () => {
    const lines: OutputLine[] = [];
    const started = await runner.start(
      {
        program: NODE,
        // No newline after the first piece, like an empty `adb track-devices` list.
        args: [
          "-e",
          "process.stdout.write('0000'); process.stdout.write('0004abc\\n')",
        ],
        output: "chunks",
      },
      (line) => lines.push(line),
    );
    if (!started.ok) throw new Error("could not start");
    await started.value.exited;
    expect(lines.map((l) => l.text).join("")).toBe("00000004abc\n");
  });

  it("reports a missing program as a code", async () => {
    const started = await runner.start({
      program: "jagra-no-such-program",
      args: [],
    });
    expect(started).toEqual({
      ok: false,
      error: { code: "PROGRAM_NOT_FOUND", program: "jagra-no-such-program" },
    });
  });
});

describe("NodeProcessRunner stopping (REL-3, RUN-9)", () => {
  it(
    "stops the program and the processes it started",
    { timeout: 20_000 },
    async () => {
      const lines: OutputLine[] = [];
      const proc = await startOk(["-e", PARENT_WITH_GRANDCHILD], lines);
      const grandchild = await grandchildPid(lines);
      expect(isAlive(grandchild)).toBe(true);

      await proc.stop();

      expect(isAlive(proc.pid)).toBe(false);
      expect(await waitUntilGone(grandchild)).toBe(true);
    },
  );

  it(
    "stops the program when the signal aborts",
    { timeout: 20_000 },
    async () => {
      const controller = new AbortController();
      const lines: OutputLine[] = [];
      const proc = await startOk(
        ["-e", PARENT_WITH_GRANDCHILD],
        lines,
        controller.signal,
      );
      const grandchild = await grandchildPid(lines);

      controller.abort();
      await proc.exited;

      expect(await waitUntilGone(grandchild)).toBe(true);
    },
  );

  it("does not leave a program running when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const proc = await startOk(
      ["-e", "setInterval(() => {}, 1000)"],
      [],
      controller.signal,
    );
    await proc.exited;
    expect(isAlive(proc.pid)).toBe(false);
  });

  it("can be stopped again after it exited", async () => {
    const proc = await startOk(["-e", ""]);
    await proc.exited;
    await expect(proc.stop()).resolves.toBeUndefined();
  });
});

describe("NodeProcessRunner records running processes (REL-2)", () => {
  it("lists a process while it runs and removes it after it exits", async () => {
    let proc: RunningProcess | undefined;
    try {
      proc = await startOk(["-e", "setInterval(() => {}, 1000)"]);
      const records = await store.list();
      expect(records.map((r) => r.pid)).toEqual([proc.pid]);
      expect(records[0]?.program).toBe(NODE);
    } finally {
      await proc?.stop();
    }
    expect(await store.list()).toEqual([]);
  });
});

describe("NodeProcessRunner launching a program that outlives Jagra (DEV-5)", () => {
  it(
    "starts it without recording it, and it keeps running on its own",
    { timeout: 20_000 },
    async () => {
      const pidFile = join(dir, "pid.txt");
      const launched = await runner.launch({
        program: NODE,
        args: [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 30000)`,
        ],
      });
      expect(launched).toEqual({ ok: true, value: undefined });

      let pid = 0;
      for (let i = 0; i < 100 && pid === 0; i++) {
        pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
        if (pid === 0) await new Promise((r) => setTimeout(r, 50));
      }
      try {
        expect(isAlive(pid)).toBe(true);
        expect(await store.list()).toEqual([]);
      } finally {
        process.kill(pid);
      }
    },
  );

  it("reports a missing program as a code", async () => {
    expect(
      await runner.launch({ program: "jagra-no-such-program", args: [] }),
    ).toEqual({
      ok: false,
      error: { code: "PROGRAM_NOT_FOUND", program: "jagra-no-such-program" },
    });
  });
});

describe.runIf(isWindows)("resolveWindowsProgram", () => {
  it("finds an .exe on PATH", () => {
    const found = resolveWindowsProgram("node", process.env);
    expect(found.ok && found.value.toLowerCase().endsWith("node.exe")).toBe(
      true,
    );
  });

  it("refuses a .cmd or .bat, since running one needs a shell (D-21)", async () => {
    await writeFile(join(dir, "maestro.bat"), "@echo off\r\n");
    await writeFile(join(dir, "maestro"), "#!/bin/sh\n");
    const env = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    expect(resolveWindowsProgram("maestro", env)).toEqual({
      ok: false,
      error: {
        code: "PROGRAM_IS_SCRIPT",
        program: "maestro",
        path: join(dir, "maestro.bat"),
      },
    });
  });

  it("refuses a script given by its full path", async () => {
    const script = join(dir, "tool.cmd");
    await writeFile(script, "@echo off\r\n");
    const started = await runner.start({ program: script, args: [] });
    expect(started).toEqual({
      ok: false,
      error: { code: "PROGRAM_IS_SCRIPT", program: script, path: script },
    });
  });
});
