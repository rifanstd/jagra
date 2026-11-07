/**
 * Secret values per project (SEC-3). Desktop: OS credential store through safeStorage (M7).
 * CLI: `JAGRA_SECRET_<NAME>` environment variables (CLI-3, M5).
 */
export interface SecretStore {
  get(projectId: string, name: string): Promise<string | undefined>;
  set(projectId: string, name: string, value: string): Promise<void>;
  remove(projectId: string, name: string): Promise<void>;
  listNames(projectId: string): Promise<string[]>;
}
