import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Writes `text` to `file` through a new temporary file next to it, so a crash never leaves half a
 * file. The temporary name is new each time and created only if it does not exist, so a link
 * planted under that name is never followed (D-117).
 */
export async function replaceFile(file: string, text: string): Promise<void> {
  const temporary = join(
    dirname(file),
    `.${basename(file)}.${randomUUID()}.tmp`,
  );
  await writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporary, file);
  } catch (e) {
    await rm(temporary, { force: true });
    throw e;
  }
}
