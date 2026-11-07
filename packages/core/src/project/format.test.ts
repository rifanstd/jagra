import { describe, expect, it } from "vitest";
import { SUPPORTED_FORMAT } from "./format.js";

describe("SUPPORTED_FORMAT", () => {
  it("is 1, the only format version 1 knows (PRJ-9)", () => {
    expect(SUPPORTED_FORMAT).toBe(1);
  });
});
