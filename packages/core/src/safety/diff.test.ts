import { describe, expect, it } from "vitest";
import { asText, lineDiff } from "./diff.js";

describe("lineDiff", () => {
  it("marks removed and added lines between shared ones", () => {
    expect(
      lineDiff(
        "<string>Sign in</string>\n<string>Save</string>\n",
        "<string>Log in</string>\n<string>Save</string>\n<string>New</string>\n",
      ),
    ).toEqual([
      { kind: "removed", text: "<string>Sign in</string>" },
      { kind: "added", text: "<string>Log in</string>" },
      { kind: "same", text: "<string>Save</string>" },
      { kind: "added", text: "<string>New</string>" },
    ]);
  });

  it("handles a created and a deleted file, and Windows line ends", () => {
    expect(lineDiff("", "a\r\nb")).toEqual([
      { kind: "added", text: "a" },
      { kind: "added", text: "b" },
    ]);
    expect(lineDiff("a\n", "")).toEqual([{ kind: "removed", text: "a" }]);
    expect(lineDiff("same\n", "same\n")).toEqual([
      { kind: "same", text: "same" },
    ]);
  });

  it("gives up on files too large to compare", () => {
    const big = (seed: string) =>
      Array.from({ length: 3000 }, (_, i) => `${seed}${i}`).join("\n");
    expect(lineDiff(big("a"), big("b"))).toBeUndefined();
  });
});

describe("asText", () => {
  it("reads UTF-8 text and refuses binary", () => {
    expect(asText(new TextEncoder().encode("héllo"))).toBe("héllo");
    expect(asText(new Uint8Array([0x89, 0x50, 0x00, 0x47]))).toBeUndefined();
    expect(asText(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeUndefined();
    expect(asText(null)).toBe("");
  });
});
