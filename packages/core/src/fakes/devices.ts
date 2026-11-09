import { fail, ok, type JagraError, type Result } from "../errors/index.js";
import type { ApkReader } from "../ports/apk-reader.js";
import type {
  BootState,
  DeviceBridge,
  InstallOutcome,
} from "../ports/device-bridge.js";
import type { AndroidVersion, ApkInfo, Device } from "../types/index.js";

export type DeviceCall =
  | { call: "launchEmulator"; name: string }
  | { call: "bootState" | "androidVersion"; deviceId: string }
  | { call: "install"; deviceId: string; apkPath: string }
  | {
      call: "uninstall" | "clearAppData";
      deviceId: string;
      packageName: string;
    }
  | { call: "addReverse" | "removeReverse"; deviceId: string; port: number };

/**
 * Devices held in memory. `setDevices` notifies watchers, like plugging a phone in. A call for a
 * device that is not in the list fails the way `adb` does when a phone was unplugged.
 */
export class FakeDeviceBridge implements DeviceBridge {
  readonly calls: DeviceCall[] = [];
  /** What `install` answers until the app is uninstalled. */
  installOutcome: InstallOutcome = "installed";
  /** Answers for `bootState`, one per call. The last one repeats. */
  bootStates: BootState[] = [{ booted: true, load: 0.5, cores: 4 }];
  /** Android version per device id. Others get Android 15. */
  readonly versions = new Map<string, AndroidVersion>();
  /** An error the next call of that kind returns instead of its answer. */
  readonly failNext = new Map<DeviceCall["call"], JagraError>();
  private devices: Device[] = [];
  private readonly watchers = new Set<(devices: Device[]) => void>();
  private nextPort = 5554;

  setDevices(devices: Device[]): void {
    this.devices = devices;
    for (const watcher of this.watchers) watcher(devices);
  }

  get current(): readonly Device[] {
    return this.devices;
  }

  list(): Promise<Result<Device[]>> {
    return Promise.resolve(ok([...this.devices]));
  }

  watch(onChange: (devices: Device[]) => void): () => void {
    this.watchers.add(onChange);
    onChange([...this.devices]);
    return () => this.watchers.delete(onChange);
  }

  /** The emulator shows up in the list as starting, with the next free serial. */
  launchEmulator(name: string): Promise<Result<void>> {
    const failure = this.take({ call: "launchEmulator", name });
    if (failure) return failure;
    const device: Device = {
      id: `emulator-${this.nextPort}`,
      kind: "emulator",
      state: "emulator-starting",
      name,
    };
    this.nextPort += 2;
    this.setDevices([...this.devices.filter((d) => d.name !== name), device]);
    return Promise.resolve(ok(undefined));
  }

  bootState(deviceId: string): Promise<Result<BootState>> {
    const failure = this.take({ call: "bootState", deviceId });
    if (failure) return failure;
    const state =
      this.bootStates.length > 1 ? this.bootStates.shift() : this.bootStates[0];
    return this.answer(deviceId, state ?? { booted: true });
  }

  install(deviceId: string, apkPath: string): Promise<Result<InstallOutcome>> {
    const failure = this.take({ call: "install", deviceId, apkPath });
    return failure ?? this.answer(deviceId, this.installOutcome);
  }

  uninstall(deviceId: string, packageName: string): Promise<Result<void>> {
    const failure = this.take({ call: "uninstall", deviceId, packageName });
    if (failure) return failure;
    this.installOutcome = "installed";
    return this.answer(deviceId, undefined);
  }

  clearAppData(deviceId: string, packageName: string): Promise<Result<void>> {
    const failure = this.take({ call: "clearAppData", deviceId, packageName });
    return failure ?? this.answer(deviceId, undefined);
  }

  addReverse(deviceId: string, port: number): Promise<Result<void>> {
    const failure = this.take({ call: "addReverse", deviceId, port });
    return failure ?? this.answer(deviceId, undefined);
  }

  removeReverse(deviceId: string, port: number): Promise<Result<void>> {
    const failure = this.take({ call: "removeReverse", deviceId, port });
    return failure ?? this.answer(deviceId, undefined);
  }

  androidVersion(deviceId: string): Promise<Result<AndroidVersion>> {
    const failure = this.take({ call: "androidVersion", deviceId });
    return (
      failure ??
      this.answer(
        deviceId,
        this.versions.get(deviceId) ?? { release: "15", sdk: 35 },
      )
    );
  }

  private take(call: DeviceCall): Promise<Result<never>> | undefined {
    this.calls.push(call);
    const error = this.failNext.get(call.call);
    if (error === undefined) return undefined;
    this.failNext.delete(call.call);
    return Promise.resolve(fail(error));
  }

  private answer<T>(deviceId: string, value: T): Promise<Result<T>> {
    const device = this.devices.find((d) => d.id === deviceId);
    if (device === undefined) {
      return Promise.resolve(fail({ code: "DEVICE_NOT_FOUND", deviceId }));
    }
    if (device.state === "phone-not-authorised") {
      return Promise.resolve(fail({ code: "DEVICE_NOT_AUTHORISED", deviceId }));
    }
    if (device.state === "phone-not-responding") {
      return Promise.resolve(fail({ code: "DEVICE_NOT_RESPONDING", deviceId }));
    }
    return Promise.resolve(ok(value));
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
        : fail({ code: "APK_UNREADABLE", file: apkPath, detail: "not set" }),
    );
  }
}
