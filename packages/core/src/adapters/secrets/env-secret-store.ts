import type { SecretStore } from "../../ports/secret-store.js";

export const SECRET_PREFIX = "JAGRA_SECRET_";

/**
 * Secrets for the CLI, read from `JAGRA_SECRET_<NAME>` environment variables, because a CI machine
 * has no credential store with the user's secrets (CLI-3). The same values for every project.
 */
export class EnvSecretStore implements SecretStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  get(_projectId: string, name: string): Promise<string | undefined> {
    return Promise.resolve(this.env[SECRET_PREFIX + name]);
  }

  /** The CLI never stores a secret: the environment is set by whoever runs it. */
  set(): Promise<void> {
    return Promise.reject(new Error("EnvSecretStore is read-only"));
  }

  remove(): Promise<void> {
    return Promise.reject(new Error("EnvSecretStore is read-only"));
  }

  listNames(): Promise<string[]> {
    return Promise.resolve(
      Object.keys(this.env)
        .filter(
          (key) =>
            key.startsWith(SECRET_PREFIX) && key.length > SECRET_PREFIX.length,
        )
        .map((key) => key.slice(SECRET_PREFIX.length))
        .sort(),
    );
  }
}
