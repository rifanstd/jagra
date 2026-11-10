import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvSecretStore, type Device, type ToolStatus } from "@jagra/core";
import {
  FakeApkReader,
  FakeClock,
  FakeDeviceBridge,
  FakeFlowRunner,
} from "@jagra/core/fakes";
import { main } from "./main.js";
import type { RunDeps } from "./run.js";

let root: string;
let project: string;
let appData: string;
const APK = () =>
  join(project, "app", "build", "outputs", "apk", "debug", "app-debug.apk");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jagra-cli-"));
  project = join(root, "shop");
  appData = join(root, "data");
  await mkdir(join(project, ".jagra", "flows", "parts"), { recursive: true });
  await mkdir(join(APK(), ".."), { recursive: true });
  await writeFile(APK(), "apk");
  await writeFile(
    join(project, ".jagra", "config.yaml"),
    "format: 1\nname: Shop\nappId: dev.jagra.sample\n",
  );
  for (const name of ["a-login", "b-list", "c-save"]) {
    await writeFile(
      join(project, ".jagra", "flows", `${name}.yaml`),
      "appId: dev.jagra.sample\n---\n- launchApp\n",
    );
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const emulator: Device = {
  id: "emulator-5554",
  kind: "emulator",
  state: "emulator-running",
  name: "Pixel_8",
};
const READY: ToolStatus[] = (
  ["java", "adb", "maestro", "emulator"] as const
).map((tool) => ({
  tool,
  state: "ready",
  required: tool !== "emulator",
  path: `/sdk/${tool}`,
  version: "1",
}));

function setup(
  options: {
    devices?: Device[];
    env?: NodeJS.ProcessEnv;
    tools?: ToolStatus[];
  } = {},
) {
  const bridge = new FakeDeviceBridge();
  bridge.setDevices(options.devices ?? [emulator]);
  const flowRunner = new FakeFlowRunner();
  const apkReader = new FakeApkReader();
  apkReader.set(APK(), {
    packageName: "dev.jagra.sample",
    versionName: "1.0",
    versionCode: 7,
  });
  const lines: string[] = [];
  const deps: RunDeps = {
    cwd: project,
    appData,
    clock: new FakeClock(),
    secrets: new EnvSecretStore(options.env ?? {}),
    apkReader,
    checkTools: () => Promise.resolve(options.tools ?? READY),
    bridge: () => bridge,
    flowRunner: () => flowRunner,
    isAlive: () => false,
    out: (line) => lines.push(line),
  };
  const run = (...argv: string[]) => main(argv, deps, "0.0.0");
  return { bridge, flowRunner, lines, run };
}

describe("jagra run (CLI-1, CLI-4)", () => {
  it("runs every flow, prints one line per flow and exits 1 when one fails", async () => {
    const { flowRunner, lines, run } = setup();
    flowRunner.set(join(project, ".jagra", "flows", "c-save.yaml"), {
      status: "failed",
      reason: "Element not found: Save",
    });

    expect(await run("run")).toBe(1);

    expect(lines).toContain("Device Pixel_8 (emulator-5554)");
    expect(lines).toContain("APK app-debug.apk 1.0 (7)");
    const flowLines = lines.filter((l) => /^(PASSED|FAILED)/.test(l));
    expect(flowLines).toEqual([
      "PASSED    a-login.yaml  0.0 s",
      "PASSED    b-list.yaml  0.0 s",
      "FAILED    c-save.yaml  0.0 s  Step failed: Element not found: Save",
    ]);
    expect(lines).toContain("Completed in 0.0 s: 2 passed, 1 failed.");
  });

  it("exits 0 when every flow passes, and saves the run in Jagra's data folder", async () => {
    const { lines, run } = setup();
    expect(await run("run", project)).toBe(0);
    const report =
      lines.find((l) => l.startsWith("Report "))?.slice("Report ".length) ?? "";
    expect(report.startsWith(join(appData, "projects"))).toBe(true);
    expect(await readFile(report, "utf8")).toContain("Jagra run");
  });

  it("saves into --output when given (CLI-2)", async () => {
    const { run } = setup();
    const output = join(root, "report");
    await run("run", "--output", output);
    expect(await readdir(output)).toEqual(
      expect.arrayContaining(["index.html", "run.json"]),
    );
  });
});

describe("jagra run that cannot start (CLI-4: exit 2)", () => {
  it("says no device is ready", async () => {
    const { lines, run } = setup({ devices: [] });
    expect(await run("run")).toBe(2);
    expect(lines.at(-1)).toContain("No device is ready.");
  });

  it("asks for --device when more than one device is ready (CLI-2)", async () => {
    const phone: Device = {
      id: "R58",
      kind: "phone",
      state: "phone-ready",
      name: "SM A525F",
    };
    const { lines, run } = setup({ devices: [emulator, phone] });
    expect(await run("run")).toBe(2);
    expect(lines.at(-1)).toContain("More than one device is ready.");
    expect(await run("run", "--device", "R58")).toBe(0);
    expect(await run("run", "--device", "Pixel_8")).toBe(0);
  });

  it("names a missing tool", async () => {
    const tools = READY.map((t) =>
      t.tool === "maestro" ? { ...t, state: "missing" as const } : t,
    );
    const { lines, run } = setup({ tools });
    expect(await run("run")).toBe(2);
    expect(lines).toEqual([
      "maestro is missing. Install or update it, then run again.",
    ]);
  });

  it("says where to put a missing secret (CLI-3)", async () => {
    await writeFile(
      join(project, ".jagra", "flows", "d-secret.yaml"),
      "appId: dev.jagra.sample\n---\n- inputText: ${PASSWORD}\n",
    );
    const { lines, run } = setup();
    expect(await run("run")).toBe(2);
    expect(lines.at(-1)).toContain("JAGRA_SECRET_PASSWORD");
  });

  it("says there is no APK", async () => {
    await rm(APK());
    const { lines, run } = setup();
    expect(await run("run")).toBe(2);
    expect(lines.at(-1)).toContain("--apk <path>");
  });

  it("refuses an unknown command", async () => {
    const { run } = setup();
    expect(await run("test")).toBe(2);
    expect(await run()).toBe(2);
    expect(await run("--help")).toBe(0);
  });

  it("exits 2 when the phone is lost mid-run", async () => {
    const phone: Device = {
      id: "R58",
      kind: "phone",
      state: "phone-ready",
      name: "SM A525F",
    };
    const { bridge, flowRunner, lines, run } = setup({ devices: [phone] });
    flowRunner.during = () => bridge.setDevices([]);
    expect(await run("run")).toBe(2);
    expect(lines).toContain("Device R58 is not connected.");
  });
});

describe("jagra run and secrets (CLI-3)", () => {
  it("uses a JAGRA_SECRET_ value and never prints it", async () => {
    await writeFile(
      join(project, ".jagra", "flows", "d-secret.yaml"),
      "appId: dev.jagra.sample\n---\n- inputText: ${PASSWORD}\n",
    );
    const { flowRunner, lines, run } = setup({
      env: { JAGRA_SECRET_PASSWORD: "hunter2" },
    });
    expect(await run("run")).toBe(0);
    const secretFlow = flowRunner.requests.find((r) =>
      r.flowFile.endsWith("d-secret.yaml"),
    );
    expect(secretFlow?.variables).toEqual({ PASSWORD: "hunter2" });
    expect(lines.join("\n")).not.toContain("hunter2");
  });
});

describe("jagra run and appId (PRJ-6)", () => {
  it("fills an empty appId from the APK", async () => {
    await writeFile(join(project, ".jagra", "config.yaml"), "format: 1\n");
    const { lines, run } = setup();
    await run("run");
    expect(lines[0]).toBe(
      "appId was empty; set it to dev.jagra.sample in .jagra/config.yaml.",
    );
    expect(
      await readFile(join(project, ".jagra", "config.yaml"), "utf8"),
    ).toContain("appId: dev.jagra.sample");
  });

  it("warns about a different package and goes on", async () => {
    await writeFile(
      join(project, ".jagra", "config.yaml"),
      "format: 1\nappId: com.other\n",
    );
    const { lines, run } = setup();
    expect(await run("run")).toBe(0);
    expect(lines[0]).toContain("Warning: the APK is dev.jagra.sample");
  });
});
