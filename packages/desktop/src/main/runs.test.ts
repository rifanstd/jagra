import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ActiveProcessFile,
  addProject,
  runsFolder,
  type Device,
  type ToolStatus,
} from "@jagra/core";
import {
  FakeApkReader,
  FakeClock,
  FakeDeviceBridge,
  FakeFlowRunner,
  FakeMockServer,
  FakePortChecker,
  FakeSecretStore,
} from "@jagra/core/fakes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LiveRun } from "../shared/api.js";
import { reportText } from "./report-text.js";
import { Runs } from "./runs.js";

let root: string;
let appData: string;
let folder: string;
let bridge: FakeDeviceBridge;
let flowRunner: FakeFlowRunner;
let secrets: FakeSecretStore;
let reader: FakeApkReader;
let tools: ToolStatus[];
let updates: LiveRun[];
let opened: string[];
let projectId: string;

const pixel: Device = {
  id: "emulator-5554",
  kind: "emulator",
  state: "emulator-running",
  name: "Pixel_8",
};
const apk = () => join(folder, "app/build/outputs/apk/debug/app-debug.apk");
const flow = (steps: string) => `appId: com.shop\n---\n${steps}`;

async function write(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jagra-runs-"));
  appData = join(root, "data");
  folder = join(root, "shop");
  await write(
    join(folder, ".jagra/config.yaml"),
    "format: 1\nname: Shop\nappId: com.shop\n",
  );
  await write(join(folder, ".jagra/flows/a.yaml"), flow("- launchApp\n"));
  await write(join(folder, ".jagra/flows/b.yaml"), flow("- launchApp\n"));
  await write(apk(), "apk");
  projectId = (await addProject(appData, folder)).id;
  bridge = new FakeDeviceBridge();
  bridge.setDevices([pixel]);
  flowRunner = new FakeFlowRunner();
  secrets = new FakeSecretStore();
  reader = new FakeApkReader();
  reader.set(apk(), {
    packageName: "com.shop",
    versionName: "1.0",
    versionCode: 1,
  });
  tools = (["java", "adb", "maestro", "emulator"] as const).map((tool) => ({
    tool,
    required: tool !== "emulator",
    state: "ready",
    path: `/t/${tool}`,
  }));
  updates = [];
  opened = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function runs(): Runs {
  return new Runs({
    appData,
    // A second ahead, so files written by the test are always older than the run.
    clock: new FakeClock(Date.now() + 1000),
    secrets,
    apkReader: reader,
    checkTools: () => Promise.resolve(tools),
    bridge: () => bridge,
    flowRunner: () => flowRunner,
    mockServer: () => new FakeMockServer(),
    ports: new FakePortChecker(),
    state: new ActiveProcessFile(join(appData, "state", "active.json")),
    isAlive: () => true,
    reportText: () => Promise.resolve(reportText("en")),
    openPath: (path) => {
      opened.push(path);
      return Promise.resolve();
    },
    broadcast: (live) => updates.push(structuredClone(live)),
  });
}

async function finished(): Promise<LiveRun> {
  for (let i = 0; i < 200; i++) {
    const last = updates.at(-1);
    if (last?.finished) return last;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the run did not finish");
}

describe("Runs (spec section 7)", () => {
  it("runs the chosen flows and keeps the result, with a report in the user's language", async () => {
    flowRunner.set(join(folder, ".jagra/flows/b.yaml"), {
      status: "failed",
      reason: "Element not found",
      failedStep: [0],
    });
    const service = runs();
    expect(await service.start({ projectId, deviceId: pixel.id })).toEqual({
      started: true,
    });
    expect(service.active).toBe(true);
    const done = await finished();

    expect(done.run.status).toBe("completed");
    expect(done.run.flows.map((f) => f.status)).toEqual(["passed", "failed"]);
    expect(done).toMatchObject({
      device: "done",
      install: "done",
      mockoon: "skipped",
    });
    expect(service.active).toBe(false);

    const result = await service.result(projectId, done.run.id);
    expect(result).toMatchObject({
      projectName: "Shop",
      mockoon: false,
      run: { id: done.run.id },
    });
    const index = join(
      runsFolder(appData, projectId),
      done.run.id,
      "index.html",
    );
    expect(await readFile(index, "utf8")).toContain("Jagra run report");
    await service.openReport(projectId, done.run.id);
    expect(opened).toEqual([index]);
  });

  it("stops at the first check that fails, before touching the device", async () => {
    tools[2] = { tool: "maestro", required: true, state: "missing" };
    expect(await runs().start({ projectId, deviceId: pixel.id })).toEqual({
      tools: [tools[2]],
    });
    expect(bridge.calls).toEqual([]);
  });

  it("asks for missing variables, and runs once they have a value (RUN-10)", async () => {
    await write(
      join(folder, ".jagra/flows/a.yaml"),
      flow("- inputText: ${PASSWORD}\n"),
    );
    const service = runs();
    expect(await service.start({ projectId, deviceId: pixel.id })).toEqual({
      secrets: ["PASSWORD"],
    });
    await secrets.set(projectId, "PASSWORD", "hunter2");
    expect(await service.start({ projectId, deviceId: pixel.id })).toEqual({
      started: true,
    });
    const done = await finished();
    expect(JSON.stringify(updates)).not.toContain("hunter2");
    expect(done.run.status).toBe("completed");
  });

  it("asks before running an APK whose package is not appId (PRJ-6)", async () => {
    reader.set(apk(), {
      packageName: "com.other",
      versionName: "1.0",
      versionCode: 1,
    });
    const service = runs();
    expect(await service.start({ projectId, deviceId: pixel.id })).toEqual({
      packageDiffers: { appId: "com.shop", packageName: "com.other" },
    });
    expect(
      await service.start({
        projectId,
        deviceId: pixel.id,
        acceptPackage: true,
      }),
    ).toEqual({
      started: true,
    });
    await finished();
  });

  it("runs one run at a time (DEV-8)", async () => {
    flowRunner.during = () => new Promise((resolve) => setTimeout(resolve, 50));
    const service = runs();
    await service.start({ projectId, deviceId: pixel.id });
    await expect(
      service.start({ projectId, deviceId: pixel.id }),
    ).rejects.toThrow();
    await finished();
  });

  it("cancels at once and marks the rest Cancelled (RUN-9)", async () => {
    const service = runs();
    flowRunner.during = () => {
      service.cancel();
    };
    await service.start({ projectId, deviceId: pixel.id });
    const done = await finished();
    expect(done.run.status).toBe("cancelled");
    expect(done.run.flows.map((f) => f.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
    expect(updates.some((u) => u.cancelling)).toBe(true);
  });

  it("asks before uninstalling an app signed with another key (RUN-3)", async () => {
    bridge.installOutcome = "signature-mismatch";
    const service = runs();
    await service.start({ projectId, deviceId: pixel.id });
    for (let i = 0; i < 100 && !updates.at(-1)?.askUninstall; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(updates.at(-1)?.askUninstall).toBe(true);
    service.answerUninstall(true);
    const done = await finished();
    expect(done.askUninstall).toBe(false);
    expect(done.run.status).toBe("completed");
    expect(bridge.calls.map((c) => c.call)).toContain("uninstall");
  });

  it("refuses a run id that could leave the runs folder", async () => {
    const service = runs();
    expect(await service.result(projectId, "../../secrets")).toBeUndefined();
    await service.openReport(projectId, "..");
    expect(opened).toEqual([]);
  });
});

describe("Flow detail and History (RES-4, RES-5, RES-9)", () => {
  it("gives a flow's steps with its helper's, the screenshot and the crash report", async () => {
    await write(
      join(folder, ".jagra/flows/a.yaml"),
      flow("- runFlow: parts/login.yaml\n- tapOn: Save\n"),
    );
    await write(
      join(folder, ".jagra/flows/parts/login.yaml"),
      "appId: com.shop\nname: Log in\n---\n- launchApp\n- inputText: demo\n",
    );
    const file = join(folder, ".jagra/flows/a.yaml");
    flowRunner.during = async (request) => {
      if (request.flowFile !== file) return;
      await write(join(request.outputDir, "shot.png"), "png");
      await write(
        join(request.outputDir, "crash.txt"),
        "FATAL EXCEPTION: main",
      );
      flowRunner.set(file, {
        status: "app-crashed",
        screenshot: join(request.outputDir, "shot.png"),
        crashReport: join(request.outputDir, "crash.txt"),
        steps: [
          { mark: "passed", steps: [{ mark: "passed" }, { mark: "passed" }] },
          { mark: "failed" },
        ],
        failedStep: [1],
      });
    };
    const service = runs();
    await service.start({ projectId, deviceId: pixel.id });
    const done = await finished();

    const detail = await service.flowDetail(projectId, done.run.id, 0);
    expect(detail).toMatchObject({
      projectName: "Shop",
      file: "a.yaml",
      changed: false,
      flow: { status: "failed", failure: "app-crashed" },
      steps: [
        {
          command: "runFlow",
          helper: { file: "parts/login.yaml", name: "Log in" },
          steps: [
            { command: "launchApp" },
            { command: "inputText", args: "demo" },
          ],
        },
        { command: "tapOn", args: "Save", kind: "action" },
      ],
      crashReport: "FATAL EXCEPTION: main",
    });
    expect(detail?.screenshot).toBe(
      `data:image/png;base64,${Buffer.from("png").toString("base64")}`,
    );

    // A flow file edited after the run is said to have changed.
    await write(file, flow("- launchApp\n"));
    const later = new Date(Date.now() + 60_000);
    await utimes(file, later, later);
    expect((await service.flowDetail(projectId, done.run.id, 0))?.changed).toBe(
      true,
    );
    expect(await service.flowDetail(projectId, done.run.id, 9)).toBeUndefined();
    expect(await service.flowDetail(projectId, "../x", 0)).toBeUndefined();
  });

  it("lists the project's runs, newest first, with their counts", async () => {
    flowRunner.set(join(folder, ".jagra/flows/b.yaml"), { status: "failed" });
    const service = runs();
    await service.start({ projectId, deviceId: pixel.id });
    const first = await finished();
    updates.length = 0;
    await service.start({ projectId, deviceId: pixel.id });
    const second = await finished();

    const history = await service.history(projectId);
    expect(history?.map((r) => r.id)).toEqual(
      [second.run.id, first.run.id].sort().reverse(),
    );
    expect(history?.[0]).toMatchObject({
      status: "completed",
      passed: 1,
      failed: 1,
      total: 2,
      apkVersion: "1.0",
      apkCode: 1,
      device: "Pixel_8",
    });
    expect(await service.history("unknown")).toBeUndefined();
  });
});
