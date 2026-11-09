import { fail, ok, type Result } from "../../errors/index.js";
import type { Clock } from "../../ports/clock.js";
import type {
  BootState,
  DeviceBridge,
  InstallOutcome,
} from "../../ports/device-bridge.js";
import type {
  OutputLine,
  ProcessRunner,
  RunningProcess,
} from "../../ports/process-runner.js";
import type { AndroidVersion, Device } from "../../types/index.js";
import {
  deviceProblem,
  deviceState,
  isEmulatorSerial,
  isPackageName,
  parseAvdNames,
  parseDeviceLines,
  readTrackFrames,
  type AdbDevice,
} from "./adb-output.js";

/** Most `adb` calls answer in well under a second. */
export const ADB_TIMEOUT_MS = 30_000;
/** Installing pushes the whole APK, which takes a while over USB 2. */
export const INSTALL_TIMEOUT_MS = 5 * 60_000;
/** Wait before starting `adb track-devices` again after it stopped. */
const WATCH_RETRY_MS = 2000;

export interface AdbDeviceBridgeOptions {
  runner: ProcessRunner;
  clock: Clock;
  /** Full path to `adb`, from the environment check. */
  adb: string;
  /** Full path to the SDK `emulator`. Without it, emulators that are off are not listed. */
  emulator?: string;
  timeoutMs?: number;
  installTimeoutMs?: number;
}

interface AdbOutput {
  code: number | null;
  /** stdout and stderr together, in order. */
  text: string;
  stdout: string[];
}

export class AdbDeviceBridge implements DeviceBridge {
  private readonly runner: ProcessRunner;
  private readonly clock: Clock;
  private readonly adbPath: string;
  private readonly emulatorPath: string | undefined;
  private readonly timeoutMs: number;
  private readonly installTimeoutMs: number;
  /** AVD name per emulator connection, so a list does not ask again every time. */
  private readonly avdNames = new Map<string, string>();
  private readonly cores = new Map<string, number>();

  constructor(options: AdbDeviceBridgeOptions) {
    this.runner = options.runner;
    this.clock = options.clock;
    this.adbPath = options.adb;
    this.emulatorPath = options.emulator;
    this.timeoutMs = options.timeoutMs ?? ADB_TIMEOUT_MS;
    this.installTimeoutMs = options.installTimeoutMs ?? INSTALL_TIMEOUT_MS;
  }

  async list(signal?: AbortSignal): Promise<Result<Device[]>> {
    const listed = await this.adb(["devices", "-l"], signal);
    if (!listed.ok) return listed;
    const running: Device[] = [];
    for (const device of parseDeviceLines(listed.value.stdout.join("\n"))) {
      running.push(await this.toDevice(device, signal));
    }
    if (signal?.aborted) return fail({ code: "CANCELLED" });

    const avds = await this.avdList(signal);
    if (!avds.ok) return avds;
    const off: Device[] = avds.value
      .filter(
        (name) =>
          !running.some((d) => d.kind === "emulator" && d.name === name),
      )
      .map((name) => ({
        id: `avd:${name}`,
        kind: "emulator",
        state: "emulator-off",
        name,
      }));
    return ok([...running, ...off]);
  }

  watch(onChange: (devices: Device[]) => void): () => void {
    const stopping = new AbortController();
    let tracker: RunningProcess | undefined;
    let refreshing = false;
    let again = false;

    const refresh = async () => {
      if (refreshing) {
        again = true;
        return;
      }
      refreshing = true;
      do {
        again = false;
        const listed = await this.list(stopping.signal);
        if (listed.ok && !stopping.signal.aborted) onChange(listed.value);
      } while (again && !stopping.signal.aborted);
      refreshing = false;
    };

    const track = async () => {
      while (!stopping.signal.aborted) {
        let buffer = "";
        const started = await this.runner.start(
          {
            program: this.adbPath,
            args: ["track-devices", "-l"],
            output: "chunks",
            signal: stopping.signal,
          },
          (chunk: OutputLine) => {
            if (chunk.stream !== "stdout") return;
            const read = readTrackFrames(buffer + chunk.text);
            buffer = read.rest;
            // The frame only says something changed. A full list also brings AVD names and
            // emulators that are off.
            if (read.frames.length > 0) void refresh();
          },
        );
        if (started.ok) {
          tracker = started.value;
          await tracker.exited;
          tracker = undefined;
        }
        if (stopping.signal.aborted) return;
        // The adb server stopped or adb is missing. Show what is known, then try again.
        void refresh();
        await this.clock
          .sleep(WATCH_RETRY_MS, stopping.signal)
          .catch(() => undefined);
      }
    };

    void track();
    return () => {
      stopping.abort();
      void tracker?.stop();
    };
  }

  async launchEmulator(avdName: string): Promise<Result<void>> {
    if (this.emulatorPath === undefined) {
      return fail({ code: "PROGRAM_NOT_FOUND", program: "emulator" });
    }
    return this.runner.launch({
      program: this.emulatorPath,
      args: ["-avd", avdName],
    });
  }

  async bootState(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<Result<BootState>> {
    const booted = await this.shell(
      deviceId,
      ["getprop", "sys.boot_completed"],
      signal,
    );
    if (!booted.ok) return booted;
    if (booted.value.trim() !== "1") return ok({ booted: false });

    const loadavg = await this.shell(
      deviceId,
      ["cat", "/proc/loadavg"],
      signal,
    );
    if (!loadavg.ok) return loadavg;
    const load = Number.parseFloat(loadavg.value.trim().split(/\s+/)[0] ?? "");

    let cores = this.cores.get(deviceId);
    if (cores === undefined) {
      const nproc = await this.shell(deviceId, ["nproc"], signal);
      if (!nproc.ok) return nproc;
      cores = Number.parseInt(nproc.value.trim(), 10);
      if (Number.isInteger(cores) && cores > 0) this.cores.set(deviceId, cores);
    }
    return ok({
      booted: true,
      load: Number.isFinite(load) ? load : undefined,
      cores: Number.isInteger(cores) && cores > 0 ? cores : undefined,
    });
  }

  async install(
    deviceId: string,
    apkPath: string,
    signal?: AbortSignal,
  ): Promise<Result<InstallOutcome>> {
    // -r replaces the installed app, -d allows an older version code (RUN-3).
    const result = await this.adb(
      ["-s", deviceId, "install", "-r", "-d", apkPath],
      signal,
      this.installTimeoutMs,
    );
    if (!result.ok) return result;
    const { code, text } = result.value;
    if (code === 0 && /^Success/m.test(text)) return ok("installed");
    if (text.includes("INSTALL_FAILED_UPDATE_INCOMPATIBLE")) {
      return ok("signature-mismatch");
    }
    return fail(
      deviceProblem(deviceId, text) ?? {
        code: "INSTALL_FAILED",
        detail: lastLines(text),
      },
    );
  }

  async uninstall(
    deviceId: string,
    packageName: string,
    signal?: AbortSignal,
  ): Promise<Result<void>> {
    if (!isPackageName(packageName)) {
      return fail({ code: "PACKAGE_NAME_INVALID", packageName });
    }
    return this.expectSuccess(deviceId, ["uninstall", packageName], signal);
  }

  async clearAppData(
    deviceId: string,
    packageName: string,
    signal?: AbortSignal,
  ): Promise<Result<void>> {
    if (!isPackageName(packageName)) {
      return fail({ code: "PACKAGE_NAME_INVALID", packageName });
    }
    return this.expectSuccess(
      deviceId,
      ["shell", "pm", "clear", packageName],
      signal,
    );
  }

  async addReverse(
    deviceId: string,
    port: number,
    signal?: AbortSignal,
  ): Promise<Result<void>> {
    const rule = tcp(port);
    const result = await this.adb(
      ["-s", deviceId, "reverse", rule, rule],
      signal,
    );
    return this.plainResult(deviceId, result, "reverse");
  }

  async removeReverse(
    deviceId: string,
    port: number,
    signal?: AbortSignal,
  ): Promise<Result<void>> {
    const result = await this.adb(
      ["-s", deviceId, "reverse", "--remove", tcp(port)],
      signal,
    );
    if (result.ok && /listener '[^']*' not found/.test(result.value.text)) {
      return ok(undefined);
    }
    return this.plainResult(deviceId, result, "reverse --remove");
  }

  async androidVersion(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<Result<AndroidVersion>> {
    const release = await this.shell(
      deviceId,
      ["getprop", "ro.build.version.release"],
      signal,
    );
    if (!release.ok) return release;
    const sdk = await this.shell(
      deviceId,
      ["getprop", "ro.build.version.sdk"],
      signal,
    );
    if (!sdk.ok) return sdk;
    const level = Number.parseInt(sdk.value.trim(), 10);
    if (!Number.isInteger(level)) {
      return fail({
        code: "ADB_FAILED",
        command: "shell getprop ro.build.version.sdk",
        detail: sdk.value.trim(),
      });
    }
    return ok({ release: release.value.trim(), sdk: level });
  }

  private async toDevice(
    device: AdbDevice,
    signal?: AbortSignal,
  ): Promise<Device> {
    const state = deviceState(device);
    if (!isEmulatorSerial(device.serial)) {
      return {
        id: device.serial,
        kind: "phone",
        state,
        name: device.model ?? device.serial,
      };
    }
    return {
      id: device.serial,
      kind: "emulator",
      state,
      name: (await this.avdName(device, signal)) ?? device.serial,
    };
  }

  /** `adb emu avd name` asks the emulator's console, which answers even while Android boots. */
  private async avdName(
    device: AdbDevice,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const key = `${device.serial}#${device.transportId ?? ""}`;
    const known = this.avdNames.get(key);
    if (known !== undefined) return known;
    const result = await this.adb(
      ["-s", device.serial, "emu", "avd", "name"],
      signal,
    );
    if (!result.ok || result.value.code !== 0) return undefined;
    const name = parseAvdNames(result.value.stdout).find(
      (line) => line !== "OK",
    );
    if (name !== undefined && device.transportId !== undefined) {
      this.avdNames.set(key, name);
    }
    return name;
  }

  private async avdList(signal?: AbortSignal): Promise<Result<string[]>> {
    if (this.emulatorPath === undefined) return ok([]);
    const started = await this.run(
      this.emulatorPath,
      ["-list-avds"],
      signal,
      this.timeoutMs,
    );
    if (!started.ok) return started;
    return ok(parseAvdNames(started.value.stdout));
  }

  /** Runs a command on the device. Arguments are fixed words or checked names, never user text. */
  private async shell(
    deviceId: string,
    command: string[],
    signal?: AbortSignal,
  ): Promise<Result<string>> {
    const result = await this.adb(
      ["-s", deviceId, "shell", ...command],
      signal,
    );
    if (!result.ok) return result;
    const problem = deviceProblem(deviceId, result.value.text);
    if (problem) return fail(problem);
    if (result.value.code !== 0) {
      return fail({
        code: "ADB_FAILED",
        command: ["shell", ...command].join(" "),
        detail: lastLines(result.value.text),
      });
    }
    return ok(result.value.stdout.join("\n"));
  }

  /** For `adb` commands that print `Success` when they worked. */
  private async expectSuccess(
    deviceId: string,
    args: string[],
    signal?: AbortSignal,
  ): Promise<Result<void>> {
    const result = await this.adb(["-s", deviceId, ...args], signal);
    if (!result.ok) return result;
    if (result.value.code === 0 && /^Success/m.test(result.value.text)) {
      return ok(undefined);
    }
    return fail(
      deviceProblem(deviceId, result.value.text) ?? {
        code: "ADB_FAILED",
        command: args.join(" "),
        detail: lastLines(result.value.text),
      },
    );
  }

  private plainResult(
    deviceId: string,
    result: Result<AdbOutput>,
    command: string,
  ): Result<void> {
    if (!result.ok) return result;
    if (result.value.code === 0) return ok(undefined);
    return fail(
      deviceProblem(deviceId, result.value.text) ?? {
        code: "ADB_FAILED",
        command,
        detail: lastLines(result.value.text),
      },
    );
  }

  private adb(
    args: string[],
    signal?: AbortSignal,
    timeoutMs = this.timeoutMs,
  ): Promise<Result<AdbOutput>> {
    return this.run(this.adbPath, args, signal, timeoutMs);
  }

  private async run(
    program: string,
    args: string[],
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Result<AdbOutput>> {
    if (signal?.aborted) return fail({ code: "CANCELLED" });
    const timeout = AbortSignal.timeout(timeoutMs);
    const lines: OutputLine[] = [];
    const started = await this.runner.start(
      {
        program,
        args,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
      (line) => lines.push(line),
    );
    if (!started.ok) return started;
    const exit = await started.value.exited;
    if (signal?.aborted) return fail({ code: "CANCELLED" });
    if (timeout.aborted) {
      return fail({ code: "ADB_TIMED_OUT", command: commandName(args) });
    }
    return ok({
      code: exit.code,
      text: lines.map((l) => l.text).join("\n"),
      stdout: lines.filter((l) => l.stream === "stdout").map((l) => l.text),
    });
  }
}

function tcp(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`not a port: ${port}`);
  }
  return `tcp:${port}`;
}

/** The command without the serial, for error codes. */
function commandName(args: readonly string[]): string {
  return (args[0] === "-s" ? args.slice(2) : args).join(" ");
}

function lastLines(text: string): string {
  return text.trim().split(/\r?\n/).slice(-5).join("\n");
}
