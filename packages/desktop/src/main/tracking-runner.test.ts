import { FakeProcessRunner } from "@jagra/core/fakes";
import { describe, expect, it } from "vitest";
import { TrackingProcessRunner } from "./tracking-runner.js";

describe("TrackingProcessRunner (REL-3)", () => {
  it("stops every program still running", async () => {
    const fake = new FakeProcessRunner();
    fake.define("mockoon-cli", {});
    fake.define("adb", { exit: { code: 0, signal: null } });
    const runner = new TrackingProcessRunner(fake);

    const mockoon = await runner.start({ program: "mockoon-cli", args: [] });
    const adb = await runner.start({ program: "adb", args: ["devices"] });
    expect(mockoon.ok && adb.ok).toBe(true);
    if (!adb.ok) return;
    await adb.value.exited;
    await Promise.resolve();
    expect(runner.count).toBe(1);

    await runner.stopAll();
    await Promise.resolve();
    expect(runner.count).toBe(0);
  });

  it("does not track launched programs, which outlive Jagra (DEV-5)", async () => {
    const fake = new FakeProcessRunner();
    fake.define("emulator", {});
    const runner = new TrackingProcessRunner(fake);
    expect(
      (await runner.launch({ program: "emulator", args: ["-avd", "Pixel_8"] }))
        .ok,
    ).toBe(true);
    expect(runner.count).toBe(0);
  });

  it("passes failures through", async () => {
    const runner = new TrackingProcessRunner(new FakeProcessRunner());
    const result = await runner.start({ program: "missing", args: [] });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROGRAM_NOT_FOUND" },
    });
    expect(runner.count).toBe(0);
  });
});
