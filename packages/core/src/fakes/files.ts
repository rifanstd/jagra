import type { FileWatcher } from "../ports/file-watcher.js";
import type { SecretStore } from "../ports/secret-store.js";

export class FakeSecretStore implements SecretStore {
  private readonly values = new Map<string, Map<string, string>>();

  get(projectId: string, name: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(projectId)?.get(name));
  }

  set(projectId: string, name: string, value: string): Promise<void> {
    const project = this.values.get(projectId) ?? new Map<string, string>();
    project.set(name, value);
    this.values.set(projectId, project);
    return Promise.resolve();
  }

  remove(projectId: string, name: string): Promise<void> {
    this.values.get(projectId)?.delete(name);
    return Promise.resolve();
  }

  listNames(projectId: string): Promise<string[]> {
    return Promise.resolve(
      [...(this.values.get(projectId)?.keys() ?? [])].sort(),
    );
  }
}

/** `change(folder)` plays the part of a file being added, edited or removed. */
export class FakeFileWatcher implements FileWatcher {
  private readonly watchers = new Map<string, Set<() => void>>();

  watch(folder: string, onChange: () => void): () => void {
    const set = this.watchers.get(folder) ?? new Set<() => void>();
    set.add(onChange);
    this.watchers.set(folder, set);
    return () => set.delete(onChange);
  }

  change(folder: string): void {
    for (const onChange of this.watchers.get(folder) ?? []) onChange();
  }
}
