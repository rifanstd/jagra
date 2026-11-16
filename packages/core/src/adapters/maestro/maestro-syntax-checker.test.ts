import { describe, expect, it } from "vitest";
import { FakeProcessRunner } from "../../fakes/process-runner.js";
import { FakeToolFiles } from "../../fakes/tool-files.js";
import {
  MaestroSyntaxChecker,
  readSyntaxVerdict,
} from "./maestro-syntax-checker.js";

const MAESTRO = "/opt/maestro/bin/maestro";
const FILE = "/project/.jagra/flows/save-item.yaml";
const RED = (text: string) => `\x1b[31m${text}\x1b[39m\x1b[0m`;

describe("readSyntaxVerdict", () => {
  it("accepts a flow when Maestro exits 0", () => {
    expect(readSyntaxVerdict(FILE, 0, ["OK"])).toEqual({
      ok: true,
      value: { accepted: true },
    });
  });

  // Output as Maestro 2.12.1 printed it (to-verify.md).
  it("reads Maestro's message and line, without its colors", () => {
    expect(
      readSyntaxVerdict(FILE, 1, [
        "",
        RED("Invalid Command: tapOnn at C:\\syntax-checker:4:9"),
      ]),
    ).toEqual({
      ok: true,
      value: { accepted: false, message: "Invalid Command: tapOnn", line: 4 },
    });
  });

  it("leaves the line out when Maestro gives -1", () => {
    expect(
      readSyntaxVerdict(FILE, 1, [
        RED("Unknown Property: idd at C:\\syntax-checker:-1:-1"),
      ]),
    ).toEqual({
      ok: true,
      value: { accepted: false, message: "Unknown Property: idd" },
    });
  });

  it("gives no verdict for output it does not know", () => {
    const result = readSyntaxVerdict(FILE, 1, [
      "Exception in thread main java.lang.Error",
    ]);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "SYNTAX_CHECK_FAILED",
        file: FILE,
        detail: "exit 1\nException in thread main java.lang.Error",
      },
    });
    expect(readSyntaxVerdict(FILE, null, []).ok).toBe(false);
  });
});

describe("MaestroSyntaxChecker", () => {
  it("runs check-syntax for the one file, without a shell", async () => {
    const runner = new FakeProcessRunner();
    runner.define(MAESTRO, {
      lines: [{ stream: "stdout", text: "OK" }],
      exit: { code: 0, signal: null },
    });
    const checker = new MaestroSyntaxChecker({
      runner,
      maestro: MAESTRO,
      platform: "darwin",
      environment: () => Promise.resolve({}),
      home: "/home/someone",
      files: new FakeToolFiles(),
    });
    expect(await checker.check(FILE)).toEqual({
      ok: true,
      value: { accepted: true },
    });
    expect(runner.calls[0]?.program).toBe(MAESTRO);
    expect(runner.calls[0]?.args).toEqual(["check-syntax", FILE]);
    expect(runner.calls[0]?.env?.MAESTRO_CLI_NO_ANALYTICS).toBe("1");
  });
});
