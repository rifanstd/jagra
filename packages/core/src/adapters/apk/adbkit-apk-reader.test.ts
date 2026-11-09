import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdbkitApkReader } from "./adbkit-apk-reader.js";

// tiny.apk is test-fixtures/tiny-manifest.xml linked with aapt2 from build-tools 36.0.0:
// aapt2 link -o tiny.apk --manifest tiny-manifest.xml -I android-36/android.jar
const TINY_APK = fileURLToPath(
  new URL("../../../test-fixtures/tiny.apk", import.meta.url),
);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jagra-apk-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("AdbkitApkReader (PRJ-5)", () => {
  const reader = new AdbkitApkReader();

  it("reads the package name, version name and version code", async () => {
    expect(await reader.read(TINY_APK)).toEqual({
      ok: true,
      value: {
        packageName: "dev.jagra.fixture",
        versionName: "1.2.3",
        versionCode: 42,
      },
    });
  });

  it("reports a missing file", async () => {
    const file = join(dir, "gone.apk");
    expect(await reader.read(file)).toEqual({
      ok: false,
      error: { code: "FILE_NOT_FOUND", file },
    });
  });

  it("reports a file that is not an APK", async () => {
    const file = join(dir, "broken.apk");
    await writeFile(file, "not a zip file");
    const read = await reader.read(file);
    expect(read.ok ? undefined : read.error.code).toBe("APK_UNREADABLE");
  });
});
