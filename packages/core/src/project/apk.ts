import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { fail, ok, type JagraError, type Result } from "../errors/index.js";
import type { ApkInfo } from "../types/index.js";
import { configFile, type ProjectConfig } from "./config.js";

export interface FoundApk {
  path: string;
  /** Milliseconds since the epoch, for "built 5 minutes ago" (PRJ-5). */
  modifiedAt: number;
  /** Chosen by hand rather than found under `apk.searchPath`. */
  handPicked: boolean;
}

/**
 * PRJ-4: a hand-picked APK wins until the user clears it. Otherwise the newest `.apk` under
 * `apk.searchPath`, by modification time, in any subfolder (build variants make their own).
 */
export async function findApk(
  projectFolder: string,
  config: ProjectConfig,
  handPicked?: string,
): Promise<Result<FoundApk>> {
  if (handPicked !== undefined) {
    try {
      const info = await stat(handPicked);
      if (info.isFile()) {
        return ok({
          path: handPicked,
          modifiedAt: info.mtimeMs,
          handPicked: true,
        });
      }
    } catch {
      // Reported below.
    }
    return fail({ code: "FILE_NOT_FOUND", file: handPicked });
  }

  const root = resolve(projectFolder, config.apk.searchPath);
  const notFound = fail<JagraError>({
    code: "APK_NOT_FOUND",
    searchPath: config.apk.searchPath,
  });
  let entries;
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch {
    return notFound;
  }

  let newest: FoundApk | undefined;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".apk")) continue;
    const path = join(entry.parentPath, entry.name);
    try {
      const { mtimeMs } = await stat(path);
      if (newest === undefined || mtimeMs > newest.modifiedAt) {
        newest = { path, modifiedAt: mtimeMs, handPicked: false };
      }
    } catch {
      // Deleted while searching, as a Gradle build does.
    }
  }
  return newest ? ok(newest) : notFound;
}

/** How the APK's package compares with `appId` (PRJ-6). */
export type AppIdCheck =
  | { result: "same" }
  /** `appId` is empty and should be filled from the APK. */
  | { result: "empty"; packageName: string }
  /** Jagra warns before the run and lets the user cancel or continue. */
  | { result: "different"; appId: string; packageName: string };

export function checkAppId(config: ProjectConfig, apk: ApkInfo): AppIdCheck {
  if (config.appId === "")
    return { result: "empty", packageName: apk.packageName };
  if (config.appId === apk.packageName) return { result: "same" };
  return {
    result: "different",
    appId: config.appId,
    packageName: apk.packageName,
  };
}

/**
 * Writes the APK's package name into an empty `appId` in `.jagra/config.yaml`, keeping comments
 * and every other field (PRJ-6). It never replaces an `appId` that has a value.
 */
export async function fillAppId(
  projectFolder: string,
  packageName: string,
): Promise<Result<void>> {
  const file = configFile(projectFolder);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    return fail({
      code: "FILE_READ_FAILED",
      file,
      detail: (e as Error).message,
    });
  }
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    return fail({
      code: "CONFIG_WRITE_FAILED",
      file,
      detail: "config.yaml has errors",
    });
  }
  const current: unknown = doc.get("appId");
  if (current !== undefined && current !== null && current !== "")
    return ok(undefined);
  doc.set("appId", packageName);

  // Write next to it first, so a crash never leaves a half-written config.yaml.
  const temporary = join(projectFolder, ".jagra", `.${basename(file)}.tmp`);
  try {
    await writeFile(temporary, doc.toString(), "utf8");
    await rename(temporary, file);
  } catch (e) {
    return fail({
      code: "CONFIG_WRITE_FAILED",
      file,
      detail: (e as Error).message,
    });
  }
  return ok(undefined);
}
