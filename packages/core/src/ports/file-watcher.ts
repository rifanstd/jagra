/** Reports changes in `.jagra/flows` (FLOW-8). The library is chosen in M9. */
export interface FileWatcher {
  /** Calls `onChange` after files are added, changed or removed. Returns a stop function. */
  watch(folder: string, onChange: () => void): () => void;
}
