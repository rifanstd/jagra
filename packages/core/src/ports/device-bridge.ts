import type { Result } from "../errors/index.js";
import type { Device } from "../types/index.js";

export type InstallOutcome = "installed" | "signature-mismatch";

/** `adb` and the SDK `emulator`. Shapes are completed in M4 (DEV-1 to DEV-9). */
export interface DeviceBridge {
  list(signal?: AbortSignal): Promise<Result<Device[]>>;
  /** Calls `onChange` with the new list whenever a device appears or goes away. Returns a stop function. */
  watch(onChange: (devices: Device[]) => void): () => void;
  startEmulator(name: string, signal?: AbortSignal): Promise<Result<Device>>;
  waitForBoot(deviceId: string, signal?: AbortSignal): Promise<Result<void>>;
  install(
    deviceId: string,
    apkPath: string,
    signal?: AbortSignal,
  ): Promise<Result<InstallOutcome>>;
  uninstall(
    deviceId: string,
    packageName: string,
    signal?: AbortSignal,
  ): Promise<Result<void>>;
  clearAppData(
    deviceId: string,
    packageName: string,
    signal?: AbortSignal,
  ): Promise<Result<void>>;
  addReverse(
    deviceId: string,
    port: number,
    signal?: AbortSignal,
  ): Promise<Result<void>>;
  removeReverse(
    deviceId: string,
    port: number,
    signal?: AbortSignal,
  ): Promise<Result<void>>;
  androidVersion(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<Result<string>>;
}
