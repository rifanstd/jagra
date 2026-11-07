import { ok, type Result } from "../errors/index.js";
import type { ApkReader } from "../ports/apk-reader.js";
import type { DeviceBridge, InstallOutcome } from "../ports/device-bridge.js";
import type { ApkInfo, Device } from "../types/index.js";

export type DeviceCall =
  | { call: "startEmulator"; name: string }
  | { call: "waitForBoot" | "androidVersion"; deviceId: string }
  | { call: "install"; deviceId: string; apkPath: string }
  | {
      call: "uninstall" | "clearAppData";
      deviceId: string;
      packageName: string;
    }
  | { call: "addReverse" | "removeReverse"; deviceId: string; port: number };

/** Devices held in memory. `setDevices` notifies watchers, like plugging a phone in. */
export class FakeDeviceBridge implements DeviceBridge {
  readonly calls: DeviceCall[] = [];
  installOutcome: InstallOutcome = "installed";
  private devices: Device[] = [];
  private watchers = new Set<(devices: Device[]) => void>();

  setDevices(devices: Device[]): void {
    this.devices = devices;
    for (const watcher of this.watchers) watcher(devices);
  }

  list(): Promise<Result<Device[]>> {
    return Promise.resolve(ok(this.devices));
  }

  watch(onChange: (devices: Device[]) => void): () => void {
    this.watchers.add(onChange);
    return () => this.watchers.delete(onChange);
  }

  startEmulator(name: string): Promise<Result<Device>> {
    this.calls.push({ call: "startEmulator", name });
    const device: Device = {
      id: `emulator-${name}`,
      kind: "emulator",
      state: "emulator-running",
      name,
    };
    this.setDevices([...this.devices.filter((d) => d.name !== name), device]);
    return Promise.resolve(ok(device));
  }

  waitForBoot(deviceId: string): Promise<Result<void>> {
    this.calls.push({ call: "waitForBoot", deviceId });
    return Promise.resolve(ok(undefined));
  }

  install(deviceId: string, apkPath: string): Promise<Result<InstallOutcome>> {
    this.calls.push({ call: "install", deviceId, apkPath });
    return Promise.resolve(ok(this.installOutcome));
  }

  uninstall(deviceId: string, packageName: string): Promise<Result<void>> {
    this.calls.push({ call: "uninstall", deviceId, packageName });
    return Promise.resolve(ok(undefined));
  }

  clearAppData(deviceId: string, packageName: string): Promise<Result<void>> {
    this.calls.push({ call: "clearAppData", deviceId, packageName });
    return Promise.resolve(ok(undefined));
  }

  addReverse(deviceId: string, port: number): Promise<Result<void>> {
    this.calls.push({ call: "addReverse", deviceId, port });
    return Promise.resolve(ok(undefined));
  }

  removeReverse(deviceId: string, port: number): Promise<Result<void>> {
    this.calls.push({ call: "removeReverse", deviceId, port });
    return Promise.resolve(ok(undefined));
  }

  androidVersion(deviceId: string): Promise<Result<string>> {
    this.calls.push({ call: "androidVersion", deviceId });
    const device = this.devices.find((d) => d.id === deviceId);
    return Promise.resolve(ok(device?.androidVersion ?? "14"));
  }
}

export class FakeApkReader implements ApkReader {
  private readonly apks = new Map<string, ApkInfo>();

  set(apkPath: string, info: ApkInfo): void {
    this.apks.set(apkPath, info);
  }

  read(apkPath: string): Promise<Result<ApkInfo>> {
    const info = this.apks.get(apkPath);
    return Promise.resolve(
      info
        ? ok(info)
        : { ok: false, error: { code: "FILE_NOT_FOUND", file: apkPath } },
    );
  }
}
