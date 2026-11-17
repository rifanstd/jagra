import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/**
 * Whether `path` is inside `folder`, after following links on the way. A link inside
 * `.jagra/flows` that points elsewhere is outside (AGT-8). Paths that do not exist yet count
 * by their nearest existing parent folder.
 */
export async function isInside(folder: string, path: string): Promise<boolean> {
  if (!isAbsolute(path)) return false;
  const [base, target] = await Promise.all([
    realFolder(resolve(folder)),
    realFolder(resolve(path)),
  ]);
  const inside = relative(base, target);
  return !inside.startsWith("..") && !isAbsolute(inside);
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
