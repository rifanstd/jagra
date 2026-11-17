import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { z } from "zod";
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
    flows[path] = await hashFile(source);
    await copyInto(source, join(options.backup, "flows", ...path.split("/")));
  }

  const { git, head, paths } = await recorded(folder, options.git);
  const files: Record<string, string | null> = {};
  const present: string[] = [];
  let size = 0;
  for (const path of paths) {
    const source = join(folder, ...path.split("/"));
    const info = await stat(source).catch(() => undefined);
    if (!info?.isFile()) {
      files[path] = null;
      continue;
    }
    files[path] = await hashFile(source);
    present.push(path);
    size += info.size;
  }
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
    const info = await stat(join(folder, ...path.split("/"))).catch(
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
    const changed = await options.git.changed(folder, snapshot.head);
    candidates = [
      ...new Set([
        ...Object.keys(snapshot.files),
        ...(changed.ok ? changed.value : []),
      ]),
    ].filter((path) => counted(path));
  } else {
    candidates = [
      ...new Set([
        ...Object.keys(snapshot.files),
        ...(await walk(folder, true)),
      ]),
    ];
  }
  for (const path of candidates.sort()) {
    const before = await hashBefore(snapshot, options, path);
    const after = await hashFile(join(folder, ...path.split("/"))).catch(
      () => null,
    );
    const kind = changeKind(before, after);
    if (kind) outside.push({ path, kind });
  }

  const flows: FileChange[] = [];
  const flowsNow = await walk(join(folder, ...FLOWS.split("/")), false);
  for (const path of [
    ...new Set([...Object.keys(snapshot.flows), ...flowsNow]),
  ].sort()) {
    if (path === requestedFlow) continue;
    const after = await hashFile(
      join(folder, ...FLOWS.split("/"), ...path.split("/")),
    ).catch(() => null);
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
  if (recorded === null) return null;
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
    if (!counted(path)) {
      failed.push(path);
      continue;
    }
    const target = join(snapshot.folder, ...path.split("/"));
    const before = await contentBefore(snapshot, options, path).catch(
      () => undefined,
    );
    try {
      if (before === undefined) failed.push(path);
      else if (before === null) await rm(target, { force: true });
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, before);
      }
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
  try {
    if (snapshot.flows[path] === undefined) {
      await rm(target, { force: true });
    } else {
      await copyInto(join(options.backup, "flows", ...path.split("/")), target);
    }
    return true;
  } catch {
    return false;
  }
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

/** Every file under `folder`, relative with `/`. Skips links, so nothing outside is followed. */
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
      } else if (entry.isFile()) {
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
