import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActiveProcessFile } from "../../process/active-processes.js";
import { NodeProcessRunner } from "../process/node-process-runner.js";
import { NodeGitClient } from "./node-git-client.js";

let root: string;
let git: NodeGitClient;

const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jagra-git-"));
  git = new NodeGitClient(
    new NodeProcessRunner({
      store: new ActiveProcessFile(join(root, "active.json")),
    }),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A repository whose app lives in `android/`, with one commit. */
async function repository(): Promise<string> {
  const repo = join(root, "repo");
  const app = join(repo, "android");
  await mkdir(join(app, "app"), { recursive: true });
  run(repo, "init", "-q");
  run(repo, "config", "user.email", "test@example.com");
  run(repo, "config", "user.name", "Test");
  await writeFile(join(app, "app", "strings.xml"), "Sign in\n");
  await writeFile(join(app, "README.md"), "app\n");
  await writeFile(join(repo, ".gitignore"), "build/\n");
  run(repo, "add", ".");
  run(repo, "commit", "-q", "-m", "first");
  return app;
}

describe("NodeGitClient (AGT-19, D-114)", () => {
  it("reads HEAD, the files that differ from it, and a file at a commit", async () => {
    const app = await repository();
    const head = await git.head(app);
    if (!head.ok || !head.value) throw new Error("no head");
    expect(head.value).toMatch(/^[0-9a-f]{40,64}$/);

    await writeFile(join(app, "app", "strings.xml"), "Log in\n");
    await unlink(join(app, "README.md"));
    await writeFile(join(app, "new file.txt"), "x");
    await mkdir(join(app, "build"));
    await writeFile(join(app, "build", "out.txt"), "ignored");
    expect(await git.changed(app, head.value)).toEqual({
      ok: true,
      value: ["README.md", "app/strings.xml", "new file.txt"],
    });

    const before = await git.show(app, head.value, "app/strings.xml");
    expect(before.ok && Buffer.from(before.value ?? []).toString()).toBe(
      "Sign in\n",
    );
    expect(await git.show(app, head.value, "new file.txt")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("lists every file in a repository without commits", async () => {
    const repo = join(root, "empty");
    await mkdir(repo);
    run(repo, "init", "-q");
    await writeFile(join(repo, "a.txt"), "a");
    expect(await git.head(repo)).toEqual({ ok: true, value: undefined });
    expect(await git.changed(repo, undefined)).toEqual({
      ok: true,
      value: ["a.txt"],
    });
  });

  it("fails outside a repository, and when git is missing", async () => {
    const plain = join(root, "plain");
    await mkdir(plain);
    expect((await git.head(plain)).ok).toBe(false);
    const missing = new NodeGitClient(
      new NodeProcessRunner({
        store: new ActiveProcessFile(join(root, "active.json")),
      }),
      "git-that-does-not-exist",
    );
    expect((await missing.head(plain)).ok).toBe(false);
  });
});
