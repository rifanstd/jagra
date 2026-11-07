import type { Result } from "../errors/index.js";
import type { ApkInfo } from "../types/index.js";

/** Reads package name and versions from an APK file (PRJ-5). The library is chosen in M4. */
export interface ApkReader {
  read(apkPath: string): Promise<Result<ApkInfo>>;
}
