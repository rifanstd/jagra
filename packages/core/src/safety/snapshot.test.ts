import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeGitClient } from "../adapters/git/node-git-client.js";
import { NodeProcessRunner } from "../adapters/process/node-process-runner.js";
import { ActiveProcessFile } from "../process/active-processes.js";
import { FakeGitClient } from "../fakes/git.js";
import type { GitClient } from "../ports/git.js";
import {
  backupFits,
  compare,
  contentBefore,
  flowBefore,
  loadSnapshot,
  restore,
  takeSnapshot,
  undoFlow,
  type SafetyNetOptions,
} from "./snapshot.js";

let root: string;
let folder: string;
let backup: string;
let git: GitClient;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jagra-safety-"));
  folder = join(root, "shop");
  backup = join(root, "data", "backups", "s1");
  git = new NodeGitClient(
    new NodeProcessRunner({
      store: new ActiveProcessFile(join(root, "active.json")),
    }),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(path: string, text: string): Promise<void> {
  const full = join(folder, ...path.split("/"));
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text);
}
const read = (path: string) =>
  readFile(join(folder, ...path.split("/")), "utf8");
const gone = async (path: string) =>
  stat(join(folder, ...path.split("/"))).then(
    () => false,
    () => true,
  );
const run = (...args: string[]) =>
  execFileSync("git", args, { cwd: folder, stdio: "pipe" });

async function project(): Promise<void> {
  await write("app/src/main/res/values/strings.xml", "Sign in\n");
  await write("app/src/main/Login.kt", "class Login\n");
  await write("README.md", "shop\n");
  await write(".jagra/config.yaml", "format: 1\n");
  await write(".jagra/flows/login.yaml", "appId: a\n---\n- launchApp\n");
  await write(".jagra/flows/save.yaml", "appId: a\n---\n- tapOn: Save\n");
  await write("app/build/out.txt", "built\n");
}

/** What a misbehaving agent does, on top of the user's own earlier changes. */
async function agentWork(): Promise<void> {
  await write("app/src/main/res/values/strings.xml", "Log in\n");
  await write("app/src/test/StockTest.kt", "class StockTest\n");
  await unlink(join(folder, "README.md"));
  await write("app/build/out.txt", "built again\n");
  await write(".jagra/flows/new.yaml", "appId: a\n---\n- launchApp\n");
  await write(".jagra/flows/save.yaml", "appId: a\n---\n- tapOn: Simpan\n");
  await unlink(join(folder, ".jagra", "flows", "login.yaml"));
  await write(".jagra/flows/asked.yaml", "appId: a\n---\n- launchApp\n");
}

for (const mode of ["files", "git"] as const) {
  describe(`safety net in a ${mode === "git" ? "git repository" : "plain folder"} (AGT-19, AGT-20)`, () => {
    const options = (): SafetyNetOptions => ({ backup, git });

    beforeEach(async () => {
      await project();
      if (mode === "git") {
        run("init", "-q");
        run("config", "user.email", "t@example.com");
        run("config", "user.name", "T");
        await write(".gitignore", "build/\n");
        run("add", ".");
        run("commit", "-q", "-m", "first");
      }
      // The user's own change before the agent starts: never counted, never undone.
      await write("app/src/main/Login.kt", "class Login { /* mine */ }\n");
      await write("notes.txt", "my notes\n");
    });

    it("lists only the agent's changes, then Restore puts them back and keeps the user's", async () => {
      const snapshot = await takeSnapshot(folder, options());
      expect(snapshot.mode).toBe(mode);
      await agentWork();

      const changes = await compare(snapshot, options(), "asked.yaml");
      expect(changes.outside).toEqual([
        { path: "README.md", kind: "deleted" },
        { path: "app/src/main/res/values/strings.xml", kind: "changed" },
        { path: "app/src/test/StockTest.kt", kind: "created" },
      ]);
      expect(changes.flows).toEqual([
        { path: "login.yaml", kind: "deleted" },
        { path: "new.yaml", kind: "created" },
        { path: "save.yaml", kind: "changed" },
      ]);

      expect(
        await restore(
          snapshot,
          options(),
          changes.outside.map((c) => c.path),
        ),
      ).toEqual([]);
      expect(await read("app/src/main/res/values/strings.xml")).toBe(
        "Sign in\n",
      );
      expect(await read("README.md")).toBe("shop\n");
      expect(await gone("app/src/test/StockTest.kt")).toBe(true);
      expect(await read("app/src/main/Login.kt")).toBe(
        "class Login { /* mine */ }\n",
      );
      expect(await read("notes.txt")).toBe("my notes\n");
      // Skipped folders are never touched.
      expect(await read("app/build/out.txt")).toBe("built again\n");
      expect(
        (await compare(snapshot, options(), "asked.yaml")).outside,
      ).toEqual([]);
    });

    it("undoes changes to other flows one at a time, and shows them", async () => {
      const snapshot = await takeSnapshot(folder, options());
      await agentWork();
      expect(
        Buffer.from(
          (await flowBefore(snapshot, options(), "save.yaml")) ?? [],
        ).toString(),
      ).toBe("appId: a\n---\n- tapOn: Save\n");
      expect(await flowBefore(snapshot, options(), "new.yaml")).toBeNull();
      expect(await undoFlow(snapshot, options(), "save.yaml")).toBe(true);
      expect(await undoFlow(snapshot, options(), "login.yaml")).toBe(true);
      expect(await undoFlow(snapshot, options(), "new.yaml")).toBe(true);
      expect(await read(".jagra/flows/save.yaml")).toBe(
        "appId: a\n---\n- tapOn: Save\n",
      );
      expect(await read(".jagra/flows/login.yaml")).toBe(
        "appId: a\n---\n- launchApp\n",
      );
      expect(await gone(".jagra/flows/new.yaml")).toBe(true);
      expect(await undoFlow(snapshot, options(), "../config.yaml")).toBe(false);
    });

    it("gives each file as it was before the agent, for View changes", async () => {
      const snapshot = await takeSnapshot(folder, options());
      await agentWork();
      const text = async (path: string) => {
        const before = await contentBefore(snapshot, options(), path);
        return before ? Buffer.from(before).toString() : before;
      };
      expect(await text("app/src/main/res/values/strings.xml")).toBe(
        "Sign in\n",
      );
      expect(await text("app/src/main/Login.kt")).toBe(
        "class Login { /* mine */ }\n",
      );
      expect(await text("app/src/test/StockTest.kt")).toBeNull();
      expect(await loadSnapshot(backup)).toEqual(snapshot);
    });

    it("tells before the agent starts whether Restore will be available", async () => {
      expect(await backupFits(folder, git)).toBe(true);
      expect(await backupFits(folder, git, 5)).toBe(false);
    });

    it("lists changes without a copy when the folder passes the limit", async () => {
      const snapshot = await takeSnapshot(folder, {
        ...options(),
        limitBytes: 5,
      });
      expect(snapshot.restorable).toBe(false);
      await agentWork();
      const changes = await compare(
        snapshot,
        { ...options(), limitBytes: 5 },
        "asked.yaml",
      );
      expect(changes.outside.map((c) => c.kind)).toEqual([
        "deleted",
        "changed",
        "created",
      ]);
    });
  });
}

describe("safety net with a described repository", () => {
  it("reads clean files from the commit and treats files new since then as created", async () => {
    await project();
    const fake = new FakeGitClient().repository("abc", {
      "README.md": "shop\n",
    });
    fake.changedFiles = ["notes.txt"];
    await write("notes.txt", "mine\n");
    const snapshot = await takeSnapshot(folder, { backup, git: fake });
    expect(snapshot).toMatchObject({ mode: "git", head: "abc" });
    await write("README.md", "changed\n");
    fake.changedFiles = ["README.md", "notes.txt", "extra.txt"];
    await write("extra.txt", "x");
    expect((await compare(snapshot, { backup, git: fake })).outside).toEqual([
      { path: "README.md", kind: "changed" },
      { path: "extra.txt", kind: "created" },
    ]);
  });
});

describe("safety net without git", () => {
  it("works as for a plain folder when git is missing (D-114)", async () => {
    await project();
    const missing: GitClient = {
      head: () =>
        Promise.resolve({
          ok: false,
          error: { code: "PROGRAM_NOT_FOUND", program: "git" },
        }),
      changed: () =>
        Promise.resolve({
          ok: false,
          error: { code: "PROGRAM_NOT_FOUND", program: "git" },
        }),
      show: () =>
        Promise.resolve({
          ok: false,
          error: { code: "PROGRAM_NOT_FOUND", program: "git" },
        }),
      untracked: () =>
        Promise.resolve({
          ok: false,
          error: { code: "PROGRAM_NOT_FOUND", program: "git" },
        }),
      gitDir: () =>
        Promise.resolve({
          ok: false,
          error: { code: "PROGRAM_NOT_FOUND", program: "git" },
        }),
    };
    const snapshot = await takeSnapshot(folder, { backup, git: missing });
    expect(snapshot.mode).toBe("files");
    await write("README.md", "changed\n");
    expect((await compare(snapshot, { backup, git: missing })).outside).toEqual(
      [{ path: "README.md", kind: "changed" }],
    );
  });
});

describe("safety net against an agent that hides or redirects its writes (D-117)", () => {
  const options = (): SafetyNetOptions => ({ backup, git });
  let outside: string;

  beforeEach(async () => {
    await project();
    run("init", "-q");
    run("config", "user.email", "t@example.com");
    run("config", "user.name", "T");
    await write(".gitignore", "build/\n");
    await write("docs/notes.txt", "notes\n");
    run("add", ".");
    run("commit", "-q", "-m", "first");
    outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "victim.txt"), "outside\n");
  });

  /** A junction needs no admin rights on Windows; false where links cannot be made. */
  const link = async (target: string, path: string) => {
    try {
      await symlink(target, join(folder, ...path.split("/")), "junction");
      return true;
    } catch {
      return false;
    }
  };

  it("lists a folder the agent hid with its own ignore rules, and Restore removes it", async () => {
    const snapshot = await takeSnapshot(folder, options());
    await write("buildSrc/.gitignore", "*\n");
    await write("buildSrc/build.gradle.kts", "println(1)\n");
    const changes = await compare(snapshot, options(), "asked.yaml");
    expect(changes.outside).toEqual([{ path: "buildSrc/", kind: "created" }]);
    expect(await restore(snapshot, options(), ["buildSrc/"])).toEqual([]);
    expect(await gone("buildSrc")).toBe(true);
  });

  it("stops trusting git when the repository's settings changed, and shows that", async () => {
    const snapshot = await takeSnapshot(folder, options());
    run("config", "core.fsmonitor", "something");
    const changes = await compare(snapshot, options(), "asked.yaml");
    expect(changes.outside).toEqual([{ path: ".git", kind: "changed" }]);
  });

  it("never restores through a folder the agent replaced with a link", async () => {
    const snapshot = await takeSnapshot(folder, options());
    await rm(join(folder, "docs"), { recursive: true });
    if (!(await link(outside, "docs"))) return;
    const changes = await compare(snapshot, options(), "asked.yaml");
    expect(changes.outside).toEqual([{ path: "docs", kind: "changed" }]);
    expect(
      await restore(snapshot, options(), ["docs", "docs/notes.txt"]),
    ).toEqual(["docs", "docs/notes.txt"]);
    expect(await readdir(outside)).toEqual(["victim.txt"]);
  });

  it("puts a file back in place of a link instead of writing through it", async () => {
    const snapshot = await takeSnapshot(folder, options());
    await unlink(join(folder, "README.md"));
    try {
      // A link to a file needs Developer Mode on Windows; macOS always allows it.
      await symlink(
        join(outside, "victim.txt"),
        join(folder, "README.md"),
        "file",
      );
    } catch {
      return;
    }
    const changes = await compare(snapshot, options(), "asked.yaml");
    expect(changes.outside).toEqual([{ path: "README.md", kind: "changed" }]);
    expect(await restore(snapshot, options(), ["README.md"])).toEqual([]);
    expect(await read("README.md")).toBe("shop\n");
    expect(await readFile(join(outside, "victim.txt"), "utf8")).toBe(
      "outside\n",
    );
  });

  it("shows .jagra/flows replaced with a link, and never undoes a flow through it", async () => {
    const snapshot = await takeSnapshot(folder, options());
    await rm(join(folder, ".jagra", "flows"), { recursive: true });
    if (!(await link(outside, ".jagra/flows"))) return;
    const changes = await compare(snapshot, options(), "asked.yaml");
    expect(changes.outside).toContainEqual({
      path: ".jagra/flows",
      kind: "changed",
    });
    expect(changes.flows).toEqual([]);
    expect(await undoFlow(snapshot, options(), "victim.txt")).toBe(false);
    expect(await readdir(outside)).toEqual(["victim.txt"]);
  });
});
