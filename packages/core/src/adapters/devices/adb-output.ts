import type { DeviceError } from "../../errors/index.js";
import type { DeviceState } from "../../types/index.js";

export interface AdbDevice {
  serial: string;
  /** The state word `adb` prints: `device`, `offline`, `unauthorized` and so on. */
  adbState: string;
  /** The `model:` field, with underscores turned back into spaces. */
  model?: string;
  /** The `transport_id:` field. It changes whenever the device connects again. */
  transportId?: string;
}

const PROPERTY = /^([a-z_]+):(\S*)$/;

/** Reads the device lines of `adb devices -l` and of `adb track-devices -l`. */
export function parseDeviceLines(text: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (
      line === "" ||
      line.startsWith("List of devices") ||
      line.startsWith("*")
    )
      continue;
    const [serial, ...rest] = line.split(/\s+/);
    if (serial === undefined || rest.length === 0) continue;
    // `no permissions (...)` is the one state with spaces in it.
    const properties: Record<string, string> = {};
    const words: string[] = [];
    for (const word of rest) {
      const match = PROPERTY.exec(word);
      if (match && words.length > 0)
        properties[match[1] ?? ""] = match[2] ?? "";
      else words.push(word);
    }
    devices.push({
      serial,
      adbState: words[0] === "no" ? "no permissions" : (words[0] ?? ""),
      model: properties.model?.replaceAll("_", " "),
      transportId: properties.transport_id,
    });
  }
  return devices;
}

export function isEmulatorSerial(serial: string): boolean {
  return /^emulator-\d+$/.test(serial);
}

/** Maps what `adb` says onto the states in spec section 5 (D-43). */
export function deviceState(device: AdbDevice): DeviceState {
  if (isEmulatorSerial(device.serial)) {
    return device.adbState === "device"
      ? "emulator-running"
      : "emulator-starting";
  }
  if (device.adbState === "device") return "phone-ready";
  if (device.adbState === "unauthorized") return "phone-not-authorised";
  return "phone-not-responding";
}

/**
 * `adb track-devices` sends each list as 4 hex digits of length and then the list. An empty list
 * is just `0000`, with no newline, so the output cannot be read line by line.
 */
export function readTrackFrames(buffer: string): {
  frames: string[];
  rest: string;
} {
  const frames: string[] = [];
  let rest = buffer;
  while (rest.length >= 4) {
    const length = Number.parseInt(rest.slice(0, 4), 16);
    if (Number.isNaN(length)) {
      // Not framed output (a daemon notice, say): drop it and wait for the next frame.
      return { frames, rest: "" };
    }
    if (rest.length < 4 + length) break;
    frames.push(rest.slice(4, 4 + length));
    rest = rest.slice(4 + length);
  }
  return { frames, rest };
}

/** AVD names allow letters, digits, `.`, `_` and `-`. Other lines are emulator notices. */
export function parseAvdNames(lines: readonly string[]): string[] {
  return lines.map((l) => l.trim()).filter((l) => /^[A-Za-z0-9._-]+$/.test(l));
}

/** The device problem `adb` reports in its output, if any. */
export function deviceProblem(
  deviceId: string,
  output: string,
): DeviceError | undefined {
  if (/device '[^']*' not found|no devices\/emulators found/.test(output))
    return { code: "DEVICE_NOT_FOUND", deviceId };
  if (/device unauthorized/.test(output))
    return { code: "DEVICE_NOT_AUTHORISED", deviceId };
  if (/device offline|device still (connecting|authorizing)/.test(output))
    return { code: "DEVICE_NOT_RESPONDING", deviceId };
  return undefined;
}

/** A Java package name. It reaches a shell on the device, so nothing else may pass. */
export function isPackageName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(name);
}
