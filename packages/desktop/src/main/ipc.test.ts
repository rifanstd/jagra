import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANNELS } from "../shared/api.js";
import { registerIpc, type IpcMainLike } from "./ipc.js";
import { SettingsFile } from "./settings.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jagra-ipc-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const OWN_PAGE = "file:///app/out/renderer/index.html";

function setup() {
  const handlers = new Map<string, Parameters<IpcMainLike["handle"]>[1]>();
  const ipc: IpcMainLike = {
    handle: (channel, listener) => handlers.set(channel, listener),
  };
  registerIpc(
    ipc,
    {
      appInfo: () => ({ version: "0.0.0", platform: "win32" }),
      settings: new SettingsFile(dir, () => ["en-US"]),
    },
    (url) => url === OWN_PAGE,
  );
  const call = (channel: string, args: unknown[], url = OWN_PAGE) =>
    Promise.resolve().then(() =>
      handlers.get(channel)?.({ senderFrame: { url } }, ...args),
    );
  return { handlers, call };
}

describe("registerIpc (SEC-6)", () => {
  it("registers exactly the preload API's channels", () => {
    expect([...setup().handlers.keys()].sort()).toEqual(
      Object.values(CHANNELS).sort(),
    );
  });

  it("answers valid calls from the app's own page", async () => {
    const { call } = setup();
    expect(await call(CHANNELS.appInfo, [])).toEqual({
      version: "0.0.0",
      platform: "win32",
    });
    expect(await call(CHANNELS.settingsSet, [{ language: "id" }])).toEqual({
      settings: { language: "id" },
      language: "id",
    });
  });

  it("refuses calls from anywhere else", async () => {
    const { call } = setup();
    await expect(
      call(CHANNELS.appInfo, [], "https://example.com/"),
    ).rejects.toThrow("not from the app's own page");
  });

  it.each([
    [[{ language: "fr" }]],
    [[{ language: "id", extra: true }]],
    [["id"]],
    [[]],
    [[{ language: "id" }, "more"]],
  ])("refuses settings.set with %j", async (args) => {
    const { call } = setup();
    await expect(call(CHANNELS.settingsSet, args)).rejects.toThrow(
      "invalid arguments",
    );
  });

  it("refuses arguments to calls that take none", async () => {
    const { call } = setup();
    await expect(call(CHANNELS.appInfo, ["x"])).rejects.toThrow(
      "invalid arguments",
    );
  });
});
