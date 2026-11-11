import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolStatus } from "@jagra/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANNELS, EVENTS } from "../shared/api.js";
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
const KNOWN = "https://docs.maestro.dev/";

const STATUS: ToolStatus = {
  tool: "adb",
  required: true,
  state: "ready",
  path: "/sdk/adb",
  version: "37.0.0",
};

function setup() {
  const handlers = new Map<string, Parameters<IpcMainLike["handle"]>[1]>();
  const ipc: IpcMainLike = {
    handle: (channel, listener) => handlers.set(channel, listener),
  };
  const opened: string[] = [];
  const copied: string[] = [];
  const sent: [string, unknown[]][] = [];
  registerIpc(
    ipc,
    {
      appInfo: () => ({ version: "0.0.0", platform: "win32" }),
      isKnownLink: (url) => url === KNOWN,
      openLink: (url) => {
        opened.push(url);
        return Promise.resolve();
      },
      copyText: (text) => {
        copied.push(text);
        return Promise.resolve();
      },
      settings: new SettingsFile(dir, () => ["en-US"]),
      checkEnvironment: (onProgress) => {
        onProgress(STATUS);
        return Promise.resolve({
          tools: [{ status: STATUS }],
          ready: true,
          tookMs: 5,
        });
      },
    },
    (url) => url === OWN_PAGE,
  );
  const call = (channel: string, args: unknown[], url = OWN_PAGE) =>
    Promise.resolve().then(() =>
      handlers.get(channel)?.(
        {
          senderFrame: { url },
          sender: { send: (event, ...values) => sent.push([event, values]) },
        },
        ...args,
      ),
    );
  return { handlers, call, opened, copied, sent };
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
    [[{ environmentSeen: "yes" }]],
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
    await expect(call(CHANNELS.environmentCheck, ["x"])).rejects.toThrow(
      "invalid arguments",
    );
  });

  it("opens only the links of the install instructions", async () => {
    const { call, opened } = setup();
    await call(CHANNELS.appOpenLink, [KNOWN]);
    await expect(
      call(CHANNELS.appOpenLink, ["https://example.com/"]),
    ).rejects.toThrow("unknown link");
    await expect(call(CHANNELS.appOpenLink, [42])).rejects.toThrow(
      "invalid arguments",
    );
    expect(opened).toEqual([KNOWN]);
  });

  it("copies text, and refuses anything that is not a string", async () => {
    const { call, copied } = setup();
    await call(CHANNELS.appCopyText, ["npm install -g @mockoon/cli"]);
    await expect(call(CHANNELS.appCopyText, [{}])).rejects.toThrow(
      "invalid arguments",
    );
    expect(copied).toEqual(["npm install -g @mockoon/cli"]);
  });

  it("sends each tool's status to the page that asked while checking", async () => {
    const { call, sent } = setup();
    const view = await call(CHANNELS.environmentCheck, []);
    expect(view).toMatchObject({ ready: true });
    expect(sent).toEqual([[EVENTS.environmentProgress, [STATUS]]]);
  });
});
