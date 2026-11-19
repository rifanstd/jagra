import type { Result } from "../errors/index.js";

/**
 * The few `git` reads the safety net needs (AGT-19). Paths are relative to the folder asked
 * about, with `/`. Every call fails when the folder is not inside a repository or `git` is not
 * installed; the safety net then works as for a plain folder (D-114).
 */
export interface GitClient {
  /** The commit `HEAD` points to, or undefined in a repository without commits yet. */
  head(folder: string): Promise<Result<string | undefined>>;
  /**
   * Files that differ from `commit` (or every file, without one): changed, added and deleted
   * tracked files, and untracked files that are not ignored.
   */
  changed(
    folder: string,
    commit: string | undefined,
  ): Promise<Result<string[]>>;
  /**
   * Untracked entries, ignored ones included, with a folder that holds only untracked files
   * listed once as `folder/`. Lets the safety net see what the agent hid with ignore rules (D-117).
   */
  untracked(folder: string): Promise<Result<string[]>>;
  /** The absolute path of the repository's git folder. */
  gitDir(folder: string): Promise<Result<string>>;
  /** A file's bytes at `commit`, or undefined when the file is not in that commit. */
  show(
    folder: string,
    commit: string,
    path: string,
  ): Promise<Result<Uint8Array | undefined>>;
}
