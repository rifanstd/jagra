import { watch, type FSWatcher } from "node:fs";
import type { FileWatcher } from "../../ports/file-watcher.js";

/** Editors and `git pull` write several files at once; one refresh is enough for all of them. */
export const WATCH_SETTLE_MS = 250;

/**
 * FLOW-8 with Node's own recursive `fs.watch`, which Node 24 supports on Windows, macOS and Linux,
 * so no watching library is needed (D-99). A folder that cannot be watched, or that goes away,
 * is simply not watched; the page still refreshes when the window gets focus.
 */
export class NodeFileWatcher implements FileWatcher {
  constructor(private readonly settleMs = WATCH_SETTLE_MS) {}

  watch(folder: string, onChange: () => void): () => void {
    let timer: NodeJS.Timeout | undefined;
    let watcher: FSWatcher | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, this.settleMs);
    };
    try {
      watcher = watch(folder, { recursive: true, persistent: false }, changed);
      watcher.on("error", () => watcher?.close());
    } catch {
      watcher = undefined;
    }
    return () => {
      clearTimeout(timer);
      watcher?.close();
    };
  }
}
