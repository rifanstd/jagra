import { fail, ok, type Result } from "../../errors/index.js";
import type { GitClient } from "../../ports/git.js";
import type { ProcessRunner } from "../../ports/process-runner.js";

/** Keeps git from taking locks a running IDE might be waiting for. */
const GIT_ENV = { GIT_OPTIONAL_LOCKS: "0" };

/**
 * Settings given on the command line, which win over the repository's own: no fsmonitor program,
 * no untracked cache, and no bare repository found by itself. The safety net also stops using git
 * when the repository's settings changed while the agent ran (D-117).
 */
const SAFE_CONFIG = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
  "-c",
  "safe.bareRepository=explicit",
];

interface GitOutput {
  code: number | null;
  stdout: Uint8Array;
  stderr: string;
}

/** `git` started without a shell, reading from the folder it is asked about (D-114). */
export class NodeGitClient implements GitClient {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly program = "git",
  ) {}

  async head(folder: string): Promise<Result<string | undefined>> {
    const inside = await this.git(folder, [
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    if (!inside.ok) return inside;
    if (inside.value.code !== 0) return this.failed(inside.value);
    const head = await this.git(folder, [
      "rev-parse",
      "--verify",
      "--quiet",
      "HEAD",
    ]);
    if (!head.ok) return head;
    // Exit 1 without output: a repository with no commit yet.
    if (head.value.code === 1) return ok(undefined);
    if (head.value.code !== 0) return this.failed(head.value);
    return ok(text(head.value.stdout).trim());
  }

  async changed(
    folder: string,
    commit: string | undefined,
  ): Promise<Result<string[]>> {
    const lists = commit
      ? [
          [
            "diff",
            "--name-only",
            "-z",
            "--relative",
            "--no-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--ignore-submodules=all",
            commit,
            "--",
          ],
          ["ls-files", "--others", "--exclude-standard", "-z"],
        ]
      : [["ls-files", "--cached", "--others", "--exclude-standard", "-z"]];
    const paths = new Set<string>();
    for (const args of lists) {
      const output = await this.git(folder, args);
      if (!output.ok) return output;
      if (output.value.code !== 0) return this.failed(output.value);
      for (const path of text(output.value.stdout).split("\0")) {
        if (path !== "") paths.add(path);
      }
    }
    return ok([...paths].sort());
  }

  async untracked(folder: string): Promise<Result<string[]>> {
    const output = await this.git(folder, [
      "ls-files",
      "--others",
      "--directory",
      "--no-empty-directory",
      "-z",
    ]);
    if (!output.ok) return output;
    if (output.value.code !== 0) return this.failed(output.value);
    return ok(
      text(output.value.stdout)
        .split("\0")
        .filter((path) => path !== "")
        .sort(),
    );
  }

  async gitDir(folder: string): Promise<Result<string>> {
    const output = await this.git(folder, ["rev-parse", "--absolute-git-dir"]);
    if (!output.ok) return output;
    if (output.value.code !== 0) return this.failed(output.value);
    return ok(text(output.value.stdout).trim());
  }

  async show(
    folder: string,
    commit: string,
    path: string,
  ): Promise<Result<Uint8Array | undefined>> {
    // `<commit>:./<path>` reads the path relative to the folder, wherever the repository starts.
    const output = await this.git(folder, ["show", `${commit}:./${path}`]);
    if (!output.ok) return output;
    if (output.value.code === 0) return ok(output.value.stdout);
    if (
      /does not exist|exists on disk, but not in/i.test(output.value.stderr)
    ) {
      return ok(undefined);
    }
    return this.failed(output.value);
  }

  private async git(
    folder: string,
    args: string[],
  ): Promise<Result<GitOutput>> {
    let stderr = "";
    const started = await this.runner.start(
      {
        program: this.program,
        args: [...SAFE_CONFIG, "-C", folder, ...args],
        env: GIT_ENV,
        output: "stream",
      },
      (line) => {
        if (line.stream === "stderr") stderr += `${line.text}\n`;
      },
    );
    if (!started.ok) return started;
    const { input, output, exited } = started.value;
    // git reads nothing from standard input here.
    await input?.close().catch(() => undefined);
    const chunks: Uint8Array[] = [];
    if (output) {
      for await (const chunk of output) chunks.push(chunk);
    }
    const exit = await exited;
    return ok({ code: exit.code, stdout: Buffer.concat(chunks), stderr });
  }

  private failed(output: GitOutput): Result<never> {
    return fail({
      code: "GIT_FAILED",
      detail: `exit ${output.code ?? "none"}: ${output.stderr.trim().slice(-500)}`,
    });
  }
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}
