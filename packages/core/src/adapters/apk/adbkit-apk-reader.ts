import ApkFile from "@devicefarmer/adbkit-apkreader";
import { fail, ok, type Result } from "../../errors/index.js";
import type { ApkReader } from "../../ports/apk-reader.js";
import type { ApkInfo } from "../../types/index.js";

/** Reads the binary `AndroidManifest.xml` inside the APK, with no Android tools needed (D-46). */
export class AdbkitApkReader implements ApkReader {
  async read(apkPath: string): Promise<Result<ApkInfo>> {
    let manifest: ApkFile.Manifest;
    try {
      manifest = await (await ApkFile.open(apkPath)).readManifest();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return fail({ code: "FILE_NOT_FOUND", file: apkPath });
      }
      return fail({ code: "APK_UNREADABLE", file: apkPath, detail: String(e) });
    }
    const versionCode = Number(manifest.versionCode ?? 0);
    if (typeof manifest.package !== "string" || manifest.package === "") {
      return fail({
        code: "APK_UNREADABLE",
        file: apkPath,
        detail: "no package name",
      });
    }
    return ok({
      packageName: manifest.package,
      versionName: manifest.versionName ?? "",
      versionCode: Number.isInteger(versionCode) ? versionCode : 0,
    });
  }
}
