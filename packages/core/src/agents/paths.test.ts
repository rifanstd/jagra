import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInside } from "./paths.js";

let project: string;
let flows: string;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "jagra-paths-"));
  flows = join(project, ".jagra", "flows");
  await mkdir(join(flows, "parts"), { recursive: true });
  await mkdir(join(project, "app"));
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

describe("isInside (AGT-8)", () => {
  it("accepts files and new folders inside, and the folder itself", async () => {
    expect(await isInside(flows, join(flows, "login.yaml"))).toBe(true);
    expect(await isInside(flows, join(flows, "parts", "a.yaml"))).toBe(true);
    expect(await isInside(flows, join(flows, "new", "deep", "a.yaml"))).toBe(
      true,
    );
    expect(await isInside(flows, flows)).toBe(true);
  });

  it("refuses paths that leave the folder, and relative paths", async () => {
    expect(await isInside(flows, join(project, "app", "strings.xml"))).toBe(
      false,
    );
    expect(await isInside(flows, join(flows, "..", "config.yaml"))).toBe(false);
    expect(await isInside(flows, join(flows, "..", "flows-other", "a"))).toBe(
      false,
    );
    expect(await isInside(flows, ".jagra/flows/a.yaml")).toBe(false);
  });

  it("follows a link inside the folder to where it really points", async () => {
    const link = join(flows, "escape");
    try {
      // A junction needs no admin rights on Windows.
      await symlink(join(project, "app"), link, "junction");
    } catch {
      return;
    }
    expect(await isInside(flows, join(link, "strings.xml"))).toBe(false);
  });
});
