import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Masker } from "./masker.js";

/** Files Maestro writes as text. Screenshots and recordings cannot be masked (D-48). */
const TEXT_FILES = new Set([
  ".json",
  ".txt",
  ".log",
  ".html",
  ".xml",
  ".yaml",
  ".yml",
]);

/**
 * A masker that also finds each value the way JSON and HTML write it, since Maestro writes secret
 * values into `commands.json`, its logs and its HTML report (RES-7, D-48).
 */
export function outputMasker(values: Iterable<string>): Masker {
  const masker = new Masker();
  for (const value of values) {
    masker.add(value);
    masker.add(JSON.stringify(value).slice(1, -1));
    masker.add(escapeHtml(value));
  }
  return masker;
}

/** Masks every text file under `folder`, in place. */
export async function maskFiles(folder: string, masker: Masker): Promise<void> {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isFile() || !TEXT_FILES.has(extname(entry.name).toLowerCase()))
      continue;
    const file = join(entry.parentPath, entry.name);
    const text = await readFile(file, "utf8");
    const masked = masker.mask(text);
    if (masked !== text) await writeFile(file, masked, "utf8");
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
