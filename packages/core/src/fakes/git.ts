import { fail, ok, type Result } from "../errors/index.js";
import type { GitClient } from "../ports/git.js";

/**
 * A repository described by hand: its HEAD commit, the files that differ from it, and file
 * contents at HEAD. Until `repository` is called, every call fails as outside a repository.
 */
export class FakeGitClient implements GitClient {
  changedFiles: string[] = [];
  private inRepository = false;
  private commit: string | undefined;
  private readonly committed = new Map<string, Uint8Array>();

  /** Makes the folder a repository at `commit` (undefined: no commit yet) holding `files`. */
  repository(
    commit: string | undefined,
    files: Record<string, string> = {},
  ): this {
    this.inRepository = true;
    this.commit = commit;
    for (const [path, text] of Object.entries(files)) {
      this.committed.set(path, new TextEncoder().encode(text));
    }
    return this;
  }

  head(): Promise<Result<string | undefined>> {
    return this.inRepository
      ? Promise.resolve(ok(this.commit))
      : this.outside();
  }

  changed(): Promise<Result<string[]>> {
    return this.inRepository
      ? Promise.resolve(ok([...this.changedFiles].sort()))
      : this.outside();
  }

  show(
    _folder: string,
    _commit: string,
    path: string,
  ): Promise<Result<Uint8Array | undefined>> {
    return this.inRepository
      ? Promise.resolve(ok(this.committed.get(path)))
      : this.outside();
  }

  private outside(): Promise<Result<never>> {
    return Promise.resolve(
      fail({ code: "GIT_FAILED", detail: "not a git repository" }),
    );
  }
}
