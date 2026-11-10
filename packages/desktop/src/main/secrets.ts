import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecretStore } from "@jagra/core";

/** The parts of Electron's `safeStorage` the store uses, so tests can pass a fake. */
export interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Thrown when the operating system offers no encryption. Values are never stored in plain text. */
export class EncryptionUnavailableError extends Error {
  constructor() {
    super("The operating system's credential store is not available.");
  }
}

/**
 * Secrets for the desktop app (SEC-3). Each value is encrypted with `safeStorage`, whose key the
 * operating system keeps (DPAPI on Windows, the Keychain on macOS), and the encrypted values are
 * written to `secrets/<project id>.json` in Jagra's local data folder (architecture.md section 4).
 */
export class SafeStorageSecretStore implements SecretStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly folder: string,
    private readonly encryption: Encryption,
  ) {}

  async get(projectId: string, name: string): Promise<string | undefined> {
    const stored = (await this.read(projectId))[name];
    if (stored === undefined) return undefined;
    this.requireEncryption();
    return this.encryption.decryptString(Buffer.from(stored, "base64"));
  }

  async set(projectId: string, name: string, value: string): Promise<void> {
    this.requireEncryption();
    const encrypted = this.encryption.encryptString(value).toString("base64");
    await this.change(projectId, (values) => ({
      ...values,
      [name]: encrypted,
    }));
  }

  remove(projectId: string, name: string): Promise<void> {
    return this.change(projectId, (values) => {
      const rest = { ...values };
      delete rest[name];
      return rest;
    });
  }

  async listNames(projectId: string): Promise<string[]> {
    return Object.keys(await this.read(projectId)).sort();
  }

  private requireEncryption(): void {
    if (!this.encryption.isEncryptionAvailable())
      throw new EncryptionUnavailableError();
  }

  private change(
    projectId: string,
    update: (values: Record<string, string>) => Record<string, string>,
  ): Promise<void> {
    const next = this.queue.then(async () => {
      const values = update(await this.read(projectId));
      await mkdir(this.folder, { recursive: true });
      const file = this.file(projectId);
      await writeFile(
        `${file}.tmp`,
        `${JSON.stringify(values, null, 2)}\n`,
        "utf8",
      );
      await rename(`${file}.tmp`, file);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async read(projectId: string): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.file(projectId), "utf8"),
      );
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      )
        return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch {
      return {};
    }
  }

  /** Project ids are made by Jagra, but the file name is still kept to safe characters. */
  private file(projectId: string): string {
    return join(
      this.folder,
      `${projectId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`,
    );
  }
}
