import { readFileSync, realpathSync, statSync } from "node:fs";

/** The few file system reads the tool adapters need, so tests can describe a machine. */
export interface ToolFiles {
  isFile(path: string): boolean;
  isFolder(path: string): boolean;
  readText(path: string): string | undefined;
  /** Follows symbolic links. Returns the path unchanged when it cannot. */
  realPath(path: string): string;
}

export const nodeToolFiles: ToolFiles = {
  isFile: (path) => stat(path)?.isFile() ?? false,
  isFolder: (path) => stat(path)?.isDirectory() ?? false,
  readText(path) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
  realPath(path) {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  },
};

function stat(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}
