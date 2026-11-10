import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maskFiles, outputMasker } from "./mask-files.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jagra-mask-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("outputMasker (RES-7)", () => {
  it("masks a value written plainly, in JSON and in HTML", () => {
    const secret = 'p"a<ss>&';
    const masker = outputMasker([secret]);
    expect(masker.mask(`raw ${secret} end`)).toBe("raw *** end");
    expect(masker.mask(JSON.stringify({ v: secret }))).toBe('{"v":"***"}');
    expect(masker.mask("<td>p&quot;a&lt;ss&gt;&amp;</td>")).toBe(
      "<td>***</td>",
    );
  });
});

describe("maskFiles (RES-7, D-48)", () => {
  it("masks every text file in the folder and its subfolders", async () => {
    await mkdir(join(dir, "debug", "flow", "logs"), { recursive: true });
    const files = {
      "report.html": "<p>hunter2</p>",
      "debug/maestro.log": "env MAESTRO_JAGRA_SECRET_PW=hunter2",
      "debug/flow/commands.json": '{"PW":"hunter2"}',
      "debug/flow/logs/device-logcat.txt": "typed hunter2",
    };
    for (const [path, text] of Object.entries(files))
      await writeFile(join(dir, path), text);
    const png = Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      ...Buffer.from("hunter2"),
    ]);
    await writeFile(join(dir, "debug", "flow", "shot.png"), png);

    await maskFiles(dir, outputMasker(["hunter2"]));

    for (const path of Object.keys(files)) {
      expect(await readFile(join(dir, path), "utf8")).not.toContain("hunter2");
    }
    expect(await readFile(join(dir, "debug", "flow", "shot.png"))).toEqual(png);
  });
});
