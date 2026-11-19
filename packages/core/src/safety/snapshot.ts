import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { noLinksBetween } from "../agents/paths.js";
import type { GitClient } from "../ports/git.js";
import type { ChangeKind, Changes, FileChange } from "./types.js";

export type { ChangeKind, Changes, FileChange } from "./types.js";

/** A folder larger than this is not copied, so Restore is not offered (D-114). */
export const BACKUP_LIMIT_BYTES = 500 * 1024 * 1024;

/** Never recorded or compared (architecture.md section 6). `.jagra/flows` is handled apart. */
const SKIPPED = new Set([".git", ".gradle", "build", "node_modules", ".idea"]);
const FLOWS = ".jagra/flows";

const hashes = z.record(z.string(), z.string().nullable());
const snapshotSchema = z.object({
  folder: z.string(),
  mode: z.enum(["git", "files"]),
  /** False when the copy would pass the limit: changes are listed, not restored. */
  restorable: z.boolean(),
  /** git: the commit the clean files are read from. */
  head: z.string().optional(),
  /**
   * Outside `.jagra/flows`, the hash of each recorded file before the agent started, or null for
   * a file that did not exist. git: only the files that differed from `head`. files: every file.
   */
  files: hashes,
  /** Every flow before the agent started, by path inside `.jagra/flows`. */
  flows: z.record(z.string(), z.string()),
  /** git: the repository's git folder, and a hash of the settings files in it (D-117). */
  gitDir: z.string().optional(),
  gitSettings: z.string().optional(),
  /** git: untracked entries, ignored ones included, that existed before the agent started. */
  entries: z.array(z.string()).optional(),
});

export type Snapshot = z.infer<typeof snapshotSchema>;

export interface SafetyNetOptions {
  /** `backups/<session id>`: the record and the copies (architecture.md section 4). */
  backup: string;
  git: GitClient;
  limitBytes?: number;
}

/**
 * AGT-19: right before the agent starts. In a git repository, the commit and a copy of every file
 * that differs from it; in any other folder, or without git, a hash and a copy of every file.
 * Flows are always copied, for AGT-20.
 */
export async function takeSnapshot(
  folder: string,
  options: SafetyNetOptions,
): Promise<Snapshot> {
  await rm(options.backup, { recursive: true, force: true });
  const limit = options.limitBytes ?? BACKUP_LIMIT_BYTES;
  const flows: Record<string, string> = {};
  for (const path of await walk(join(folder, ...FLOWS.split("/")), false)) {
    const source = join(folder, ...FLOWS.split("/"), ...path.split("/"));
    const recorded = await hashEntry(source);
    if (recorded === null) continue;
    flows[path] = recorded;
    // A link is recorded by where it points; what it points to is not copied.
    if ((await lstat(source)).isSymbolicLink()) continue;
    await copyInto(source, join(options.backup, "flows", ...path.split("/")));
  }

  const { git, head, paths } = await recorded(folder, options.git);
  const files: Record<string, string | null> = {};
  const present: string[] = [];
  let size = 0;
  for (const path of paths) {
    const source = join(folder, ...path.split("/"));
    const info = await lstat(source).catch(() => undefined);
    if (info?.isSymbolicLink()) {
      // Recorded by where it points; the file behind it is not copied.
      files[path] = await hashEntry(source);
      continue;
    }
    if (!info?.isFile()) {
      files[path] = null;
      continue;
    }
    files[path] = await hashFile(source);
    present.push(path);
    size += info.size;
  }
  const watch = git ? await gitWatch(folder, options.git) : {};
  const restorable = size <= limit;
  if (restorable) {
    for (const path of present) {
      await copyInto(
        join(folder, ...path.split("/")),
        join(options.backup, "files", ...path.split("/")),
      );
    }
  }
  const snapshot: Snapshot = {
    folder,
    mode: git ? "git" : "files",
    restorable,
    ...(head ? { head } : {}),
    files,
    flows,
    ...watch,
  };
  await mkdir(options.backup, { recursive: true });
  const file = join(options.backup, "snapshot.json");
  await writeFile(`${file}.tmp`, JSON.stringify(snapshot));
  await rename(`${file}.tmp`, file);
  return snapshot;
}

/**
 * Whether Restore will be available, for the notice before the agent starts (architecture.md
 * section 6). It adds up the sizes a snapshot would copy, without copying.
 */
export async function backupFits(
  folder: string,
  git: GitClient,
  limitBytes = BACKUP_LIMIT_BYTES,
): Promise<boolean> {
  const { paths } = await recorded(folder, git);
  let size = 0;
  for (const path of paths) {
    const info = await lstat(join(folder, ...path.split("/"))).catch(
      () => undefined,
    );
    if (info?.isFile()) size += info.size;
    if (size > limitBytes) return false;
  }
  return true;
}

/** The files a snapshot records: those that differ from `HEAD` in git, every file otherwise. */
async function recorded(
  folder: string,
  git: GitClient,
): Promise<{ git: boolean; head?: string; paths: string[] }> {
  const head = await git.head(folder);
  if (head.ok) {
    const changed = await git.changed(folder, head.value);
    if (changed.ok) {
      return {
        git: true,
        ...(head.value ? { head: head.value } : {}),
        paths: changed.value.filter((path) => counted(path)),
      };
    }
  }
  return { git: false, paths: await walk(folder, true) };
}

export async function loadSnapshot(
  backup: string,
): Promise<Snapshot | undefined> {
  try {
    const parsed = snapshotSchema.safeParse(
      JSON.parse(await readFile(join(backup, "snapshot.json"), "utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * AGT-19, AGT-20: right after the agent stops, for any reason. Changes the user made before the
 * agent started are part of the snapshot, so they never count.
 */
export async function compare(
  snapshot: Snapshot,
  options: SafetyNetOptions,
  requestedFlow?: string,
): Promise<Changes> {
  const folder = snapshot.folder;
  const outside: FileChange[] = [];
  let candidates: string[];
  if (snapshot.mode === "git") {
    candidates = Object.keys(snapshot.files);
    if (await gitUnchanged(snapshot)) {
      const changed = await options.git.changed(folder, snapshot.head);
      if (changed.ok) candidates.push(...changed.value);
      // Entries the agent hid from git with its own ignore rules, links or nested repositories.
      const entries = await options.git.untracked(folder);
      const known = new Set(snapshot.entries ?? []);
      if (entries.ok && snapshot.entries) {
        const listed = changed.ok ? changed.value : [];
        candidates.push(
          ...entries.value.filter(
            (entry) =>
              !known.has(entry) &&
              // A new folder whose files git already listed shows by those files.
              !(entry.endsWith("/") && listed.some((p) => p.startsWith(entry))),
          ),
        );
      }
    } else {
      // The repository's settings changed while the agent ran: git is not trusted to list
      // changes, and the change itself is shown (D-117).
      outside.push({ path: ".git", kind: "changed" });
    }
  } else {
    candidates = [
      ...Object.keys(snapshot.files),
      ...(await walk(folder, true)),
    ];
  }
  // A path under a link the agent made shows as the link itself: what lies behind it is
  // outside the project.
  const listed = new Set<string>();
  for (const path of candidates) listed.add(await underLink(folder, path));
  candidates = [...listed].filter((path) => counted(path));
  for (const path of candidates.sort()) {
    const before = path.endsWith("/")
      ? (snapshot.files[path] ?? null)
      : await hashBefore(snapshot, options, path);
    const after = await hashEntry(join(folder, ...path.split("/")));
    const kind = changeKind(before, after);
    if (kind) outside.push({ path, kind });
  }

  const flows: FileChange[] = [];
  if (!(await noLinksBetween(folder, join(folder, FLOWS, "flow.yaml")))) {
    // `.jagra` or `.jagra/flows` became a link: its files are not listed as flows.
    outside.push({ path: FLOWS, kind: "changed" });
    return { outside, flows };
  }
  const flowsNow = await walk(join(folder, ...FLOWS.split("/")), false);
  for (const path of [
    ...new Set([...Object.keys(snapshot.flows), ...flowsNow]),
  ].sort()) {
    if (path === requestedFlow) continue;
    const after = await hashEntry(
      join(folder, ...FLOWS.split("/"), ...path.split("/")),
    );
    const kind = changeKind(snapshot.flows[path] ?? null, after);
    if (kind) flows.push({ path, kind });
  }
  return { outside, flows };
}

/**
 * A file outside `.jagra/flows` as it was right before the agent started: its bytes, null when it
 * did not exist, or undefined when the snapshot cannot tell (no copy was made).
 */
export async function contentBefore(
  snapshot: Snapshot,
  options: SafetyNetOptions,
  path: string,
): Promise<Uint8Array | null | undefined> {
  const recorded = snapshot.files[path];
  // A folder listed as `name/` is one the agent created (D-117).
  if (recorded === null || path.endsWith("/")) return null;
  if (recorded !== undefined) {
    if (!snapshot.restorable) return undefined;
    return readFile(join(options.backup, "files", ...path.split("/")));
  }
  if (snapshot.mode === "git" && snapshot.head) {
    const shown = await options.git.show(snapshot.folder, snapshot.head, path);
    return shown.ok ? (shown.value ?? null) : undefined;
  }
  // A plain folder records every file, so one it does not know did not exist.
  return snapshot.mode === "files" ? null : undefined;
}

/**
 * Restore (AGT-19): puts each listed file back as it was right before the agent started, and
 * deletes the ones the agent created. Only what the user asked for, inside the project (PRJ-11).
 * Returns the paths it could not restore.
 */
export async function restore(
  snapshot: Snapshot,
  options: SafetyNetOptions,
  paths: readonly string[],
): Promise<string[]> {
  const failed: string[] = [];
  for (const path of paths) {
    const target = join(snapshot.folder, ...path.split("/"));
    // A link on the way could send the write outside the project (D-117).
    if (!counted(path) || !(await noLinksBetween(snapshot.folder, target))) {
      failed.push(path);
      continue;
    }
    const before = await contentBefore(snapshot, options, path).catch(
      () => undefined,
    );
    try {
      if (before === undefined) failed.push(path);
      // Removes a link itself, never what it points to.
      else if (before === null)
        await rm(target, { recursive: true, force: true });
      else await putBack(target, before);
    } catch {
      failed.push(path);
    }
  }
  return failed;
}

/** AGT-20: undoes the agent's change to one flow other than the requested one. */
export async function undoFlow(
  snapshot: Snapshot,
  options: SafetyNetOptions,
  path: string,
): Promise<boolean> {
  if (path.split("/").includes("..")) return false;
  const target = join(snapshot.folder, ...FLOWS.split("/"), ...path.split("/"));
  if (!(await noLinksBetween(snapshot.folder, target))) return false;
  try {
    if (snapshot.flows[path] === undefined) {
      await rm(target, { force: true });
    } else {
      await putBack(
        target,
        await readFile(join(options.backup, "flows", ...path.split("/"))),
      );
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a file back. A link to a file left in its place is removed first, never written
 * through. A link to a folder is refused: Jagra cannot tell what the folder held (D-117).
 */
async function putBack(target: string, bytes: Uint8Array): Promise<void> {
  const info = await lstat(target).catch(() => undefined);
  if (info?.isSymbolicLink()) {
    const pointed = await stat(target).catch(() => undefined);
    if (pointed?.isDirectory()) throw new Error("a link to a folder");
    await rm(target, { force: true });
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

/** `path`, or the first part of it that is a link, as a path relative to `folder`. */
async function underLink(folder: string, path: string): Promise<string> {
  const parts = path.split("/").filter((part) => part !== "");
  for (let i = 1; i < parts.length; i++) {
    const head = parts.slice(0, i);
    const info = await lstat(join(folder, ...head)).catch(() => undefined);
    if (!info) break;
    if (info.isSymbolicLink()) return head.join("/");
  }
  return path;
}

/** The flow as it was before the agent started, for showing its change. Null for a new flow. */
export async function flowBefore(
  snapshot: Snapshot,
  options: SafetyNetOptions,
  path: string,
): Promise<Uint8Array | null> {
  if (snapshot.flows[path] === undefined) return null;
  return readFile(join(options.backup, "flows", ...path.split("/")));
}

async function hashBefore(
  snapshot: Snapshot,
  options: SafetyNetOptions,
  path: string,
): Promise<string | null | undefined> {
  const recorded = snapshot.files[path];
  if (recorded !== undefined) return recorded;
  if (snapshot.mode === "files") return null;
  if (!snapshot.head) return null;
  const shown = await options.git.show(snapshot.folder, snapshot.head, path);
  return shown.ok ? (shown.value ? hash(shown.value) : null) : undefined;
}

function changeKind(
  before: string | null | undefined,
  after: string | null,
): ChangeKind | undefined {
  if (before === after) return undefined;
  if (before === null || before === undefined) {
    return after === null ? undefined : before === null ? "created" : "changed";
  }
  return after === null ? "deleted" : "changed";
}

/** Outside `.jagra/flows`, and in no skipped folder. */
function counted(path: string): boolean {
  if (path === FLOWS || path.startsWith(`${FLOWS}/`)) return false;
  const parts = path.split("/");
  return !parts.includes("..") && !parts.some((part) => SKIPPED.has(part));
}

/**
 * A file's hash, a link's hash by where it points (the link is not followed), a fixed hash for a
 * folder, or null when nothing is there.
 */
async function hashEntry(path: string): Promise<string | null> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) return null;
  if (info.isSymbolicLink()) {
    return hash(Buffer.from(`link\0${await readlink(path)}`));
  }
  if (info.isDirectory()) return hash(Buffer.from("folder\0"));
  return hashFile(path).catch(() => null);
}

/** What git mode watches besides the files: the git folder, its settings, untracked entries. */
async function gitWatch(
  folder: string,
  git: GitClient,
): Promise<Pick<Snapshot, "gitDir" | "gitSettings" | "entries">> {
  const gitDir = await git.gitDir(folder);
  const entries = await git.untracked(folder);
  return {
    ...(gitDir.ok
      ? {
          gitDir: gitDir.value,
          gitSettings: await settingsHash(folder, gitDir.value),
        }
      : {}),
    ...(entries.ok ? { entries: entries.value.filter((e) => counted(e)) } : {}),
  };
}

/** Whether the repository's settings are as they were before the agent started. */
async function gitUnchanged(snapshot: Snapshot): Promise<boolean> {
  if (snapshot.gitDir === undefined || snapshot.gitSettings === undefined) {
    return true;
  }
  return (
    (await settingsHash(snapshot.folder, snapshot.gitDir)) ===
    snapshot.gitSettings
  );
}

/**
 * A hash of what decides how git behaves in the folder: the `.git` entry in the folder itself (a
 * new one would make git read another repository) and the settings files of the git folder.
 * Read from disk, without running git.
 */
async function settingsHash(folder: string, gitDir: string): Promise<string> {
  const parts: string[] = [];
  const read = async (path: string) => {
    const info = await lstat(path).catch(() => undefined);
    if (!info) return "-";
    if (info.isSymbolicLink()) return `link:${await readlink(path)}`;
    if (info.isDirectory()) return "folder";
    return hash(await readFile(path));
  };
  parts.push(await read(join(folder, ".git")));
  for (const name of [
    "config",
    "config.worktree",
    "commondir",
    join("info", "attributes"),
    join("info", "exclude"),
  ]) {
    parts.push(await read(join(gitDir, name)));
  }
  const common = await readFile(join(gitDir, "commondir"), "utf8").catch(
    () => undefined,
  );
  if (common !== undefined) {
    const commonDir = common.trim();
    parts.push(
      await read(
        join(
          isAbsolute(commonDir) ? commonDir : resolve(gitDir, commonDir),
          "config",
        ),
      ),
    );
  }
  return hash(Buffer.from(parts.join("\n")));
}

/**
 * Every file under `folder`, relative with `/`. Links are listed but not followed, so nothing
 * outside is read and a link the agent made still counts as a change (D-117).
 */
async function walk(folder: string, skip: boolean): Promise<string[]> {
  const found: string[] = [];
  const visit = async (current: string) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      const path = relative(folder, full).split(sep).join("/");
      if (entry.isDirectory()) {
        if (skip && (SKIPPED.has(entry.name) || path === FLOWS)) continue;
        await visit(full);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        found.push(path);
      }
    }
  };
  await visit(folder);
  return found.sort();
}

async function hashFile(path: string): Promise<string> {
  return hash(await readFile(path));
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function copyInto(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}
