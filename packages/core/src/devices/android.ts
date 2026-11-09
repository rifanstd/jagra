import { ok, type Result } from "../errors/index.js";
import type { DeviceBridge } from "../ports/device-bridge.js";
import type { AndroidVersion } from "../types/index.js";

/**
 * The lowest API level Maestro supports: `minSdk = 24` (Android 7.0) in its Android driver at
 * v2.12.1 (to-verify.md). Review it whenever the tested Maestro version changes (ENV-3).
 */
export const MAESTRO_MIN_ANDROID_SDK = 24;

export interface AndroidSupport {
  version: AndroidVersion;
  /** False means Jagra warns before the run (DEV-7). */
  supported: boolean;
}

export async function checkAndroidVersion(
  bridge: DeviceBridge,
  deviceId: string,
  signal?: AbortSignal,
): Promise<Result<AndroidSupport>> {
  const version = await bridge.androidVersion(deviceId, signal);
  if (!version.ok) return version;
  return ok({
    version: version.value,
    supported: version.value.sdk >= MAESTRO_MIN_ANDROID_SDK,
  });
}
