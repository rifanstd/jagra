import { describe, expect, it } from "vitest";
import {
  deviceProblem,
  deviceState,
  isPackageName,
  parseAvdNames,
  parseDeviceLines,
  readTrackFrames,
} from "./adb-output.js";

// Real `adb devices -l` output (2026-11-09), plus the other states adb can print.
const DEVICES = [
  "List of devices attached",
  "emulator-5554          device product:sdk_gphone16k_x86_64 model:sdk_gphone16k_x86_64 device:emu64xa16k transport_id:8",
  "R58N12ABCDE            device usb:1-1 product:a52qnsxx model:SM_A525F device:a52q transport_id:3",
  "9B021FFAZ001K4         unauthorized usb:1-2 transport_id:4",
  "emulator-5556          offline transport_id:5",
  "0123456789ABCDEF       no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:1-3 transport_id:6",
  "",
].join("\r\n");

describe("parseDeviceLines", () => {
  it("reads serial, state, model and transport id", () => {
    expect(parseDeviceLines(DEVICES)).toEqual([
      {
        serial: "emulator-5554",
        adbState: "device",
        model: "sdk gphone16k x86 64",
        transportId: "8",
      },
      {
        serial: "R58N12ABCDE",
        adbState: "device",
        model: "SM A525F",
        transportId: "3",
      },
      {
        serial: "9B021FFAZ001K4",
        adbState: "unauthorized",
        model: undefined,
        transportId: "4",
      },
      {
        serial: "emulator-5556",
        adbState: "offline",
        model: undefined,
        transportId: "5",
      },
      {
        serial: "0123456789ABCDEF",
        adbState: "no permissions",
        model: undefined,
        transportId: "6",
      },
    ]);
  });

  it("skips daemon notices and an empty list", () => {
    const text = [
      "* daemon not running; starting now at tcp:5037",
      "* daemon started successfully",
      "List of devices attached",
      "",
    ].join("\n");
    expect(parseDeviceLines(text)).toEqual([]);
  });
});

describe("deviceState (D-43)", () => {
  it.each([
    ["emulator-5554", "device", "emulator-running"],
    ["emulator-5554", "offline", "emulator-starting"],
    ["R58N12ABCDE", "device", "phone-ready"],
    ["R58N12ABCDE", "unauthorized", "phone-not-authorised"],
    ["R58N12ABCDE", "offline", "phone-not-responding"],
    ["R58N12ABCDE", "authorizing", "phone-not-responding"],
    ["192.168.1.20:5555", "device", "phone-ready"],
  ])("%s %s is %s", (serial, adbState, state) => {
    expect(deviceState({ serial, adbState })).toBe(state);
  });
});

describe("readTrackFrames", () => {
  it("splits length-prefixed lists, including the empty list with no newline", () => {
    const one = "emulator-5554\tdevice transport_id:8\n";
    const length = one.length.toString(16).padStart(4, "0");
    expect(readTrackFrames(`${length}${one}0000`)).toEqual({
      frames: [one, ""],
      rest: "",
    });
  });

  it("keeps a frame that has not fully arrived", () => {
    expect(readTrackFrames("0010emulator")).toEqual({
      frames: [],
      rest: "0010emulator",
    });
    expect(readTrackFrames("00")).toEqual({ frames: [], rest: "00" });
  });

  it("drops output that is not framed", () => {
    expect(readTrackFrames("* daemon started successfully\n")).toEqual({
      frames: [],
      rest: "",
    });
  });
});

describe("parseAvdNames", () => {
  it("keeps AVD names and drops emulator notices", () => {
    expect(
      parseAvdNames([
        "INFO    | Storing crashdata in: C:\\tmp",
        "Pixel_8",
        "Small.Phone-API_24",
        "",
      ]),
    ).toEqual(["Pixel_8", "Small.Phone-API_24"]);
  });
});

describe("deviceProblem", () => {
  it.each([
    ["adb.exe: device 'R58N12ABCDE' not found", "DEVICE_NOT_FOUND"],
    ["adb: no devices/emulators found", "DEVICE_NOT_FOUND"],
    ["adb.exe: device unauthorized.", "DEVICE_NOT_AUTHORISED"],
    ["adb: device offline", "DEVICE_NOT_RESPONDING"],
    ["Success", undefined],
  ])("%s", (output, code) => {
    expect(deviceProblem("R58N12ABCDE", output)?.code).toBe(code);
  });
});

describe("isPackageName", () => {
  it.each([
    ["dev.jagra.sample", true],
    ["com.example.app_2", true],
    ["single", false],
    ["dev.jagra.sample; reboot", false],
    ["dev.jagra.$(id)", false],
    ["-d.evil", false],
    ["", false],
  ])("%s is %s", (name, valid) => {
    expect(isPackageName(name)).toBe(valid);
  });
});
