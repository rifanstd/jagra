import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSyntaxChecker } from "../fakes/maestro.js";
import type { SyntaxChecker } from "../ports/syntax-checker.js";
import { SyntaxChecks } from "./syntax-checks.js";

let folder: string;
let a: string;
let b: string;
let c: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "jagra-syntax-"));
  [a, b, c] = ["a.yaml", "b.yaml", "c.yaml"].map((name) => join(folder, name));
  for (const [file, text] of [
    [a, "appId: x\n---\n- launchApp\n"],
    [b, "appId: x\n---\n- tapOnn: Save\n"],
    [c, "appId: x\n---\n- tapOn: Save\n"],
  ] as const) {
    await writeFile(file, text);
  }
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

function setup(options: { checksAtOnce?: number } = {}) {
  const fake = new FakeSyntaxChecker();
  fake.set(b, {
    accepted: false,
    message: "Invalid Command: tapOnn",
    line: 3,
  });
  const done: string[] = [];
  const failed: string[] = [];
  let checker: SyntaxChecker | undefined = fake;
  const checks = new SyntaxChecks({
    checker: () => checker,
    onChecked: (file) => done.push(file),
    onFailed: (error) => failed.push(error.code),
    ...options,
  });
  return {
    fake,
    checks,
    done,
    failed,
    use: (next: SyntaxChecker | undefined) => (checker = next),
  };
}

describe("SyntaxChecks (FLOW-6, D-98)", () => {
  it("checks in the background and keeps the result until the file changes", async () => {
    const { fake, checks, done } = setup();
    fake.hold = true;
    expect(await checks.state(a)).toEqual({ state: "checking" });
    expect(await checks.state(a)).toEqual({ state: "checking" });
    fake.hold = false;
    fake.release();
    await checks.settle([a]);
    expect(done).toEqual([a]);
    expect(await checks.state(a)).toEqual({ state: "accepted" });
    expect(fake.checked).toEqual([a]);

    await writeFile(a, "appId: x\n---\n- launchApp\n- back\n");
    expect(await checks.state(a)).toEqual({ state: "checking" });
    await checks.settle([a]);
    expect(fake.checked).toEqual([a, a]);
  });

  it("returns Maestro's refusal with the file, line and message", async () => {
    const { checks } = setup();
    const problems = await checks.settle([a, b]);
    const problem = {
      code: "FLOW_MAESTRO_REFUSED",
      file: b,
      line: 3,
      message: "Invalid Command: tapOnn",
    };
    expect([...problems]).toEqual([[b, problem]]);
    expect(await checks.state(b)).toEqual({ state: "refused", problem });
  });

  it("says the whole file when Maestro gives no line", async () => {
    const { fake, checks } = setup();
    fake.set(c, { accepted: false, message: "Unknown Property: idd" });
    expect([...(await checks.settle([c]))]).toEqual([
      [
        c,
        {
          code: "FLOW_MAESTRO_REFUSED_FILE",
          file: c,
          message: "Unknown Property: idd",
        },
      ],
    ]);
  });

  it("runs at most two checks at once", async () => {
    const { fake, checks } = setup();
    fake.hold = true;
    const settled = checks.settle([a, b, c]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.checked).toHaveLength(2);
    fake.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.checked.toSorted()).toEqual([a, b, c]);
    fake.release();
    await settled;
  });

  it("waits for a check already running instead of starting another", async () => {
    const { fake, checks } = setup();
    fake.hold = true;
    await checks.state(a);
    const settled = checks.settle([a]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.release();
    await settled;
    expect(fake.checked).toEqual([a]);
  });

  it("does not hold a flow back when the check gives no verdict, and does not retry it", async () => {
    const { fake, checks, failed } = setup();
    fake.set(a, { code: "SYNTAX_CHECK_FAILED", file: a, detail: "exit 2" });
    expect([...(await checks.settle([a]))]).toEqual([]);
    expect(await checks.state(a)).toEqual({ state: "unknown" });
    expect(failed).toEqual(["SYNTAX_CHECK_FAILED"]);
    expect(fake.checked).toEqual([a]);
  });

  it("knows nothing while there is no Maestro, and starts over with a new one", async () => {
    const { fake, checks, use } = setup();
    use(undefined);
    expect(await checks.state(a)).toEqual({ state: "unknown" });
    expect([...(await checks.settle([b]))]).toEqual([]);

    use(fake);
    await checks.settle([a]);
    const other = new FakeSyntaxChecker();
    use(other);
    expect(await checks.state(a)).toEqual({ state: "checking" });
    await checks.settle([a]);
    expect(other.checked).toEqual([a]);
  });

  it("knows nothing about a file that went away", async () => {
    const { checks } = setup();
    expect(await checks.state(join(folder, "gone.yaml"))).toEqual({
      state: "unknown",
    });
  });
});
