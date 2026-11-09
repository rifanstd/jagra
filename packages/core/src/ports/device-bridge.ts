import type { Result } from "../errors/index.js";
import type { AndroidVersion, Device } from "../types/index.js";

export type InstallOutcome = "installed" | "signature-mismatch";

/** What a device reports while it boots. The `devices` module decides when it is ready (D-44). */
export interface BootState {
  /** `sys.boot_completed` is 1. */
  booted: boolean;
  /** The 1-minute load average, once booted. */
  load?: number;
  /** Number of CPU cores, once booted. */
  cores?: number;
}

/** `adb` and the SDK `emulator` (DEV-1 to DEV-9, RUN-3). */
export interface DeviceBridge {
  /** Running devices and every emulator on this machine, merged (DEV-1). */
  list(signal?: AbortSignal): Promise<Result<Device[]>>;
  /**
   * Calls `onChange` with the new list whenever a device appears, goes away or changes state
   * (DEV-2), and once at the start. Returns a stop function.
   */
  watch(onChange: (devices: Device[]) => void): () => void;
  /** Starts an emulator that keeps running after the run and after Jagra closes (DEV-5). */
  launchEmulator(avdName: string): Promise<Result<void>>;
  bootState(deviceId: string, signal?: AbortSignal): Promise<Result<BootState>>;
  /** Installs over any existing version (RUN-3). */
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
  /** Succeeds when the rule is already gone. */
  removeReverse(
    deviceId: string,
    port: number,
    signal?: AbortSignal,
  ): Promise<Result<void>>;
  androidVersion(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<Result<AndroidVersion>>;
}
