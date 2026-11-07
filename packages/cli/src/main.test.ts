import { describe, expect, it } from "vitest";
import { main } from "./main.js";

describe("main", () => {
  it("exits with 2 and says why, since no command can run yet (CLI-4)", () => {
    const lines: string[] = [];
    expect(main((line) => lines.push(line))).toBe(2);
    expect(lines).toEqual([
      "jagra is not ready yet: no commands are available.",
    ]);
  });
});
