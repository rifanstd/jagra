import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { deflateSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import {
  fail,
  ok,
  type ApkReader,
  type Device,
  type DeviceState,
  type FlowRunner,
  type FlowRunOutcome,
  type FlowRunRequest,
  type FlowRunStatus,
  type Result,
  type ToolFinding,
  type ToolName,
} from "@jagra/core";
import { FakeDeviceBridge, FakeToolProbe } from "@jagra/core/fakes";

/**
 * The test mode that Playwright starts the built app in, so the screens can be tested on every CI
 * system without tools or devices (D-81). Only `JAGRA_TEST_MODE=1` turns it on, and a packaged
 * app ignores it.
 */
export function isTestMode(env: NodeJS.ProcessEnv, packaged: boolean): boolean {
  return !packaged && env.JAGRA_TEST_MODE === "1";
}

const VERSIONS: Readonly<Record<ToolName, string>> = {
  java: "17.0.12",
  adb: "37.0.0",
  maestro: "2.12.1",
  emulator: "36.5.11.0",
  mockoon: "9.10.0",
};

/**
 * Every tool found, except those `JAGRA_TEST_TOOLS` changes, for example
 * `maestro=missing,mockoon=9.12.0`.
 */
export function testToolProbe(env: NodeJS.ProcessEnv): FakeToolProbe {
  const probe = new FakeToolProbe();
  for (const [tool, version] of Object.entries(VERSIONS) as [
    ToolName,
    string,
  ][]) {
    probe.set(tool, { found: true, path: `/test/${tool}`, version });
  }
  for (const pair of (env.JAGRA_TEST_TOOLS ?? "").split(",").filter(Boolean)) {
    const [tool, value] = pair.split("=") as [ToolName, string | undefined];
    if (!(tool in VERSIONS) || value === undefined) continue;
    const finding: ToolFinding =
      value === "missing"
        ? { found: false }
        : value === "needs-java"
          ? { found: true, path: `/test/${tool}`, problem: "needs-java" }
          : { found: true, path: `/test/${tool}`, version: value };
    probe.set(tool, finding);
  }
  return probe;
}

const DEVICE_STATES: readonly DeviceState[] = [
  "emulator-running",
  "emulator-starting",
  "emulator-off",
  "phone-ready",
  "phone-not-authorised",
  "phone-not-responding",
];

/**
 * One running emulator by default. `JAGRA_TEST_DEVICES` replaces the list with `id|state|name`
 * entries separated by commas, for example `R58M|phone-not-authorised|SM-A525F`, or `none`.
 */
export function testDeviceBridge(env: NodeJS.ProcessEnv): FakeDeviceBridge {
  const bridge = new FakeDeviceBridge();
  const text =
    env.JAGRA_TEST_DEVICES ?? "emulator-5554|emulator-running|Pixel_8";
  const devices: Device[] = [];
  for (const entry of text.split(",").filter((e) => e && e !== "none")) {
    const [id, state, name] = entry.split("|") as [
      string,
      DeviceState,
      string | undefined,
    ];
    if (!DEVICE_STATES.includes(state) || !name) continue;
    devices.push({
      id,
      state,
      name,
      kind: state.startsWith("phone") ? "phone" : "emulator",
    });
  }
  bridge.setDevices(devices);
  return bridge;
}

/**
 * Flows in test mode: each takes `JAGRA_TEST_FLOW_MS` (400 by default) and passes, unless
 * `JAGRA_TEST_RUN` gives its file another outcome, for example `save-item.yaml=failed`.
 */
export class TestFlowRunner implements FlowRunner {
  private readonly outcomes = new Map<string, FlowRunStatus | "black">();
  private readonly ms: number;

  constructor(env: NodeJS.ProcessEnv) {
    this.ms = Number(env.JAGRA_TEST_FLOW_MS ?? "400");
    for (const pair of (env.JAGRA_TEST_RUN ?? "").split(",").filter(Boolean)) {
      const [file, status] = pair.split("=") as [
        string,
        FlowRunStatus | "black" | undefined,
      ];
      if (status) this.outcomes.set(file, status);
    }
  }

  async run(request: FlowRunRequest): Promise<Result<FlowRunOutcome>> {
    request.onStep?.("Launch app");
    try {
      await sleep(this.ms, undefined, { signal: request.signal });
    } catch {
      return ok({ status: "cancelled" });
    }
    const status = this.outcomes.get(basename(request.flowFile)) ?? "passed";
    const marks = {
      failedStep: [1],
      steps: [{ mark: "passed" as const }, { mark: "failed" as const }],
    };
    if (status === "app-crashed") {
      const crashReport = join(request.outputDir, "crash.txt");
      await mkdir(request.outputDir, { recursive: true });
      await writeFile(
        crashReport,
        "FATAL EXCEPTION: main\nProcess: dev.jagra.sample, PID: 6218\n",
      );
      return ok({ status, crashReport, ...marks });
    }
    if (status === "black") {
      // What an app with FLAG_SECURE gives Maestro (RES-5).
      const screenshot = join(request.outputDir, "screenshot.png");
      await mkdir(request.outputDir, { recursive: true });
      await writeFile(screenshot, blackPng(8, 8));
      return ok({
        status: "failed",
        screenshot,
        reason: "Element not found: Save",
        ...marks,
      });
    }
    if (status !== "failed") return ok({ status });
    return ok({
      status,
      reason: "Element not found: Text matching regex: Save",
      ...marks,
    });
  }
}

/** Any existing file reads as version 1.0 (1) of `JAGRA_TEST_APK_PACKAGE`, or the sample's package. */
export function testApkReader(env: NodeJS.ProcessEnv): ApkReader {
  return {
    async read(path) {
      try {
        await stat(path);
      } catch {
        return fail({ code: "APK_UNREADABLE", file: path, detail: "missing" });
      }
      return ok({
        packageName: env.JAGRA_TEST_APK_PACKAGE ?? "dev.jagra.sample",
        versionName: "1.0",
        versionCode: 1,
      });
    },
  };
}

/** A small all-black RGB PNG. */
function blackPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const rows = Buffer.alloc(height * (1 + width * 3));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
