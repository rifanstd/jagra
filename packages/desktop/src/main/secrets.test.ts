import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EncryptionUnavailableError,
  SafeStorageSecretStore,
  type Encryption,
} from "./secrets.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jagra-secrets-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Stands in for safeStorage with a reversible change, so tests can check the value is not stored. */
class FakeEncryption implements Encryption {
  available = true;
  isEncryptionAvailable(): boolean {
    return this.available;
  }
  encryptString(plainText: string): Buffer {
    return Buffer.from(
      [...Buffer.from(plainText, "utf8")].map((b) => b ^ 0x5a),
    );
  }
  decryptString(encrypted: Buffer): string {
    return Buffer.from([...encrypted].map((b) => b ^ 0x5a)).toString("utf8");
  }
}

describe("SafeStorageSecretStore (SEC-3)", () => {
  it("stores values encrypted, per project, and reads them back", async () => {
    const store = new SafeStorageSecretStore(
      join(dir, "secrets"),
      new FakeEncryption(),
    );
    await store.set("p1", "PASSWORD", "hunter2");
    await store.set("p1", "TOKEN", "abc");
    await store.set("p2", "PASSWORD", "other");

    expect(await store.get("p1", "PASSWORD")).toBe("hunter2");
    expect(await store.get("p2", "PASSWORD")).toBe("other");
    expect(await store.get("p1", "MISSING")).toBeUndefined();
    expect(await store.listNames("p1")).toEqual(["PASSWORD", "TOKEN"]);

    const file = await readFile(join(dir, "secrets", "p1.json"), "utf8");
    expect(file).not.toContain("hunter2");
    expect(file).not.toContain("abc");
  });

  it("removes a value", async () => {
    const store = new SafeStorageSecretStore(
      join(dir, "secrets"),
      new FakeEncryption(),
    );
    await store.set("p1", "PASSWORD", "hunter2");
    await store.remove("p1", "PASSWORD");
    expect(await store.listNames("p1")).toEqual([]);
  });

  it("refuses to store anything without the operating system's encryption", async () => {
    const encryption = new FakeEncryption();
    encryption.available = false;
    const store = new SafeStorageSecretStore(join(dir, "secrets"), encryption);
    await expect(store.set("p1", "PASSWORD", "hunter2")).rejects.toBeInstanceOf(
      EncryptionUnavailableError,
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it("keeps a project id from leaving the secrets folder", async () => {
    const store = new SafeStorageSecretStore(
      join(dir, "secrets"),
      new FakeEncryption(),
    );
    await store.set("../../evil", "X", "y");
    expect(await readdir(join(dir, "secrets"))).toEqual(["______evil.json"]);
  });
});
