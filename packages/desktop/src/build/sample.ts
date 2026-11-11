import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

// Build output, caches and machine-specific files of the sample project, left out of the app (D-85).
const SKIPPED = new Set([
  ".gradle",
  ".kotlin",
  ".idea",
  "build",
  "local.properties",
]);

/** Where the sample's debug APK lives, which is also where the project looks for it (PRJ-4). */
export const SAMPLE_APK_FOLDER = "app/build/outputs/apk/debug";

export function keepSampleFile(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/);
  return !parts.some((part) => SKIPPED.has(part) || part.endsWith(".iml"));
}

/**
 * Copies the sample project for Try the sample app (SMP-5): its sources, its `.jagra` folder and
 * the debug APK, without build output. Returns whether an APK was found to copy.
 */
export function bundleSample(from: string, to: string): { apk: boolean } {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, {
    recursive: true,
    filter: (source) => keepSampleFile(relative(from, source)),
  });
  const apks = join(from, SAMPLE_APK_FOLDER);
  const files = existsSync(apks)
    ? readdirSync(apks).filter((f) => f.endsWith(".apk"))
    : [];
  for (const file of files) {
    cpSync(join(apks, file), join(to, SAMPLE_APK_FOLDER, file));
  }
  return { apk: files.length > 0 };
}
