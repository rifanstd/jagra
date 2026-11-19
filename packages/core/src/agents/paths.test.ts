import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkJagraFolder, isInside, noLinksBetween } from "./paths.js";

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

/** A junction needs no admin rights on Windows; false where links cannot be made. */
async function link(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, "junction");
    return true;
  } catch {
    return false;
  }
}

describe("links on the way to a write (D-117)", () => {
  it("refuses a path with '..' as given, since the file system follows a link before '..'", async () => {
    expect(await isInside(flows, `${flows}/parts/../login.yaml`)).toBe(false);
    expect(await isInside(flows, `${flows}\\parts\\..\\login.yaml`)).toBe(
      false,
    );
  });

  it("noLinksBetween accepts real and new folders, and refuses a link or a path outside", async () => {
    expect(await noLinksBetween(project, join(flows, "parts", "a.yaml"))).toBe(
      true,
    );
    expect(await noLinksBetween(project, join(flows, "new", "a.yaml"))).toBe(
      true,
    );
    expect(await noLinksBetween(project, join(project, "..", "a"))).toBe(false);
    expect(await noLinksBetween(project, project)).toBe(false);
    await writeFile(join(project, "file"), "x");
    expect(await noLinksBetween(project, join(project, "file", "a"))).toBe(
      false,
    );
    if (!(await link(join(project, "app"), join(flows, "escape")))) return;
    expect(await noLinksBetween(project, join(flows, "escape", "a.yaml"))).toBe(
      false,
    );
    // The last part itself may be a link: the caller decides what to do with it.
    expect(await noLinksBetween(project, join(flows, "escape"))).toBe(true);
  });

  it("checkJagraFolder fails when .jagra/flows is a link a repository could ship", async () => {
    expect(await checkJagraFolder(project)).toEqual({
      ok: true,
      value: undefined,
    });
    const other = await mkdtemp(join(tmpdir(), "jagra-paths-other-"));
    try {
      expect(await checkJagraFolder(other)).toMatchObject({ ok: true });
      await rm(flows, { recursive: true });
      if (!(await link(join(project, "app"), flows))) return;
      expect(await checkJagraFolder(project)).toEqual({
        ok: false,
        error: { code: "JAGRA_FOLDER_LINKED", path: flows },
      });
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});
