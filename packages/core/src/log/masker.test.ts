import { describe, expect, it } from "vitest";
import { Masker } from "./masker.js";

describe("Masker (SEC-4)", () => {
  it("masks a secret on its own and inside longer text", () => {
    const masker = new Masker();
    masker.add("hunter2");
    expect(masker.mask("hunter2")).toBe("***");
    expect(masker.mask("inputText: hunter2hunter2 done")).toBe(
      "inputText: ****** done",
    );
    expect(masker.mask("password=hunter2&next=1")).toBe("password=***&next=1");
  });

  it("masks the longer of two overlapping secrets whole", () => {
    const masker = new Masker();
    masker.add("1234");
    masker.add("pin-1234-x");
    expect(masker.mask("got pin-1234-x and 1234")).toBe("got *** and ***");
  });

  it("treats secrets as plain text, not patterns", () => {
    const masker = new Masker();
    masker.add("a.b*c(d)$");
    expect(masker.mask("value a.b*c(d)$ end, aXbbc end")).toBe(
      "value *** end, aXbbc end",
    );
  });

  it("masks a one-character secret too, since safety comes before readability", () => {
    const masker = new Masker();
    masker.add("7");
    expect(masker.mask("pin 7, step 17")).toBe("pin ***, step 1***");
  });

  it("ignores an empty secret", () => {
    const masker = new Masker();
    masker.add("");
    expect(masker.mask("nothing to hide")).toBe("nothing to hide");
  });

  it("stops masking a removed secret", () => {
    const masker = new Masker();
    masker.add("old");
    masker.remove("old");
    expect(masker.mask("old")).toBe("old");
  });

  it("masks keys and values deep inside objects and arrays", () => {
    const masker = new Masker();
    masker.add("s3cret");
    expect(
      masker.maskDeep({
        args: ["-e", "PASSWORD=s3cret"],
        nested: { s3cret: "value s3cret", count: 3, ok: true, none: null },
      }),
    ).toEqual({
      args: ["-e", "PASSWORD=***"],
      nested: { "***": "value ***", count: 3, ok: true, none: null },
    });
  });
});
