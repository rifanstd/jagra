import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fail, ok, type Result } from "../errors/index.js";

/**
 * Whether `path` is inside `folder`, after following links on the way. A link inside
 * `.jagra/flows` that points elsewhere is outside (AGT-8). Paths that do not exist yet count
 * by their nearest existing parent folder.
 *
 * A path with a `..` part is refused as it is given: the check would resolve `..` before
 * following a link, while the file system follows the link first (D-117).
 */
export async function isInside(folder: string, path: string): Promise<boolean> {
  if (!isAbsolute(path) || path.split(/[\\/]/).includes("..")) return false;
  const [base, target] = await Promise.all([
    realFolder(resolve(folder)),
    realFolder(resolve(path)),
  ]);
  const inside = relative(base, target);
  return !inside.startsWith("..") && !isAbsolute(inside);
}

/**
 * Whether every folder between `root` and `path` is a real folder, not a link. Folders that do
 * not exist yet count as real: whatever creates them makes real folders. `path` itself may be
 * anything. Used before a write or delete that must stay inside `root` (D-117).
 */
export async function noLinksBetween(
  root: string,
  path: string,
): Promise<boolean> {
  const inside = relative(resolve(root), resolve(path));
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    return false;
  }
  const parts = inside.split(/[\\/]/).slice(0, -1);
  let current = resolve(root);
  for (const part of parts) {
    current = join(current, part);
    const info = await lstat(current).catch(() => undefined);
    if (!info) return true;
    if (info.isSymbolicLink() || !info.isDirectory()) return false;
  }
  return true;
}

/**
 * Fails when `.jagra`, `.jagra/flows` or `.jagra/flows/parts` exists and is a link or not a
 * folder. A cloned repository could ship one as a link, which would move every write meant for
 * the project somewhere else (PRJ-11, D-117).
 */
export async function checkJagraFolder(
  projectFolder: string,
): Promise<Result<void>> {
  for (const path of [
    join(projectFolder, ".jagra"),
    join(projectFolder, ".jagra", "flows"),
    join(projectFolder, ".jagra", "flows", "parts"),
  ]) {
    const info = await lstat(path).catch(() => undefined);
    if (!info) return ok(undefined);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      return fail({ code: "JAGRA_FOLDER_LINKED", path });
    }
  }
  return ok(undefined);
}

/** The real path, or the real path of the nearest existing parent plus the rest. */
async function realFolder(path: string): Promise<string> {
  let current = path;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return rest.length === 0 ? real : resolve(real, ...rest.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      rest.push(current.slice(parent.length).replace(/^[\\/]/, ""));
      current = parent;
    }
  }
}
