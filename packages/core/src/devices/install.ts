import { fail, ok, type Result } from "../errors/index.js";
import type { DeviceBridge } from "../ports/device-bridge.js";

export interface InstallOptions {
  bridge: DeviceBridge;
  deviceId: string;
  apkPath: string;
  /** The APK's package name, which is uninstalled if the user agrees. */
  packageName: string;
  /**
   * Asked when the installed app was signed with another key. Jagra never uninstalls without a
   * yes, because uninstalling deletes the app's data on the device (RUN-3).
   */
  confirmUninstall: () => Promise<boolean>;
  signal?: AbortSignal;
}

/** Installs the APK over any existing version (RUN-3). */
export async function installApk(
  options: InstallOptions,
): Promise<Result<void>> {
  const { bridge, deviceId, apkPath, packageName, signal } = options;
  const first = await bridge.install(deviceId, apkPath, signal);
  if (!first.ok) return first;
  if (first.value === "installed") return ok(undefined);

  if (!(await options.confirmUninstall())) {
    return fail({ code: "INSTALL_SIGNATURE_MISMATCH", packageName });
  }
  if (signal?.aborted) return fail({ code: "CANCELLED" });
  const removed = await bridge.uninstall(deviceId, packageName, signal);
  if (!removed.ok) return removed;
  const second = await bridge.install(deviceId, apkPath, signal);
  if (!second.ok) return second;
  return second.value === "installed"
    ? ok(undefined)
    : fail({ code: "INSTALL_SIGNATURE_MISMATCH", packageName });
}
