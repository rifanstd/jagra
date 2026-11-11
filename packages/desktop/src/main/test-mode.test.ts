import { describe, expect, it } from "vitest";
import { isTestMode, testToolProbe } from "./test-mode.js";

const request = { paths: {} };

describe("isTestMode (D-81)", () => {
  it("is on only with JAGRA_TEST_MODE=1 in an app that is not packaged", () => {
    expect(isTestMode({ JAGRA_TEST_MODE: "1" }, false)).toBe(true);
    expect(isTestMode({ JAGRA_TEST_MODE: "1" }, true)).toBe(false);
    expect(isTestMode({ JAGRA_TEST_MODE: "true" }, false)).toBe(false);
    expect(isTestMode({}, false)).toBe(false);
  });
});

describe("testToolProbe", () => {
  it("finds every tool by default", async () => {
    const probe = testToolProbe({});
    expect(await probe.probe("maestro", request)).toMatchObject({
      found: true,
      version: "2.12.1",
    });
    expect(await probe.probe("java", request)).toMatchObject({ found: true });
  });

  it("applies JAGRA_TEST_TOOLS and ignores what it does not know", async () => {
    const probe = testToolProbe({
      JAGRA_TEST_TOOLS:
        "maestro=missing,mockoon=9.12.0,adb=needs-java,nope=1,java",
    });
    expect(await probe.probe("maestro", request)).toEqual({ found: false });
    expect(await probe.probe("mockoon", request)).toMatchObject({
      version: "9.12.0",
    });
    expect(await probe.probe("adb", request)).toMatchObject({
      problem: "needs-java",
    });
    expect(await probe.probe("java", request)).toMatchObject({
      version: "17.0.12",
    });
  });
});
