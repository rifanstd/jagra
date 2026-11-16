/** Reports changes in `.jagra/flows` (FLOW-8). Node's own `fs.watch` does it (D-99). */
export interface FileWatcher {
  /** Calls `onChange` after files are added, changed or removed. Returns a stop function. */
  watch(folder: string, onChange: () => void): () => void;
}
