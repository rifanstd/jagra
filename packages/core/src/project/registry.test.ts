import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvSecretStore } from "../adapters/secrets/env-secret-store.js";
import type { SecretStore } from "../ports/secret-store.js";
import { cliProjectId, projectsFile } from "./registry.js";

let appData: string;
beforeEach(async () => {
  appData = await mkdtemp(join(tmpdir(), "jagra-registry-"));
});
afterEach(async () => {
  await rm(appData, { recursive: true, force: true });
});

describe("cliProjectId (D-56)", () => {
  it("uses the app's id for a folder the app knows, so both share a history", async () => {
    const folder = join(appData, "Shop");
    await writeFile(
      projectsFile(appData),
      JSON.stringify({ projects: [{ id: "p-123", folder }] }),
    );
    expect(await cliProjectId(appData, folder)).toBe("p-123");
    expect(await cliProjectId(appData, `${folder.toUpperCase()}/`)).toBe(
      "p-123",
    );
  });

  it("makes a stable id from the path for any other folder", async () => {
    const first = await cliProjectId(appData, join(appData, "other"));
    expect(first).toMatch(/^cli-[0-9a-f]{16}$/);
    expect(await cliProjectId(appData, join(appData, "other"))).toBe(first);
    expect(await cliProjectId(appData, join(appData, "third"))).not.toBe(first);
  });

  it("ignores a broken projects.json", async () => {
    await writeFile(projectsFile(appData), "{ broken");
    expect(await cliProjectId(appData, appData)).toMatch(/^cli-/);
  });
});

describe("EnvSecretStore (CLI-3)", () => {
  const store: SecretStore = new EnvSecretStore({
    JAGRA_SECRET_PASSWORD: "hunter2",
    JAGRA_SECRET_: "no name",
    PATH: "/bin",
  });

  it("reads JAGRA_SECRET_<NAME>", async () => {
    expect(await store.get("any", "PASSWORD")).toBe("hunter2");
    expect(await store.get("any", "TOKEN")).toBeUndefined();
    expect(await store.listNames("any")).toEqual(["PASSWORD"]);
  });

  it("never stores anything", async () => {
    await expect(store.set("any", "X", "y")).rejects.toThrow();
  });
});
