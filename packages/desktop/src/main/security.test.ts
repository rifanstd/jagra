import type { Session, WebContents } from "electron";
import { describe, expect, it } from "vitest";
import { isAllowedUrl, lockDownContents, lockDownSession } from "./security.js";

describe("isAllowedUrl (SEC-1)", () => {
  it.each([
    [
      "file:///C:/Program%20Files/Jagra/resources/app/out/renderer/index.html",
      true,
    ],
    ["data:font/ttf;base64,AAAA", true],
    ["devtools://devtools/bundled/inspector.html", true],
    ["https://fonts.googleapis.com/css2?family=Outfit", false],
    ["http://example.com/", false],
    ["wss://example.com/socket", false],
    ["http://localhost:5173/src/main.tsx", false],
    ["not a url", false],
  ])("%s in a built app: %s", (url, allowed) => {
    expect(isAllowedUrl(url)).toBe(allowed);
  });

  it("allows the Vite dev server and its hot reload while developing, and nothing else", () => {
    const dev = "http://localhost:5173/";
    expect(isAllowedUrl("http://localhost:5173/src/main.tsx", dev)).toBe(true);
    expect(isAllowedUrl("ws://localhost:5173/", dev)).toBe(true);
    expect(isAllowedUrl("http://localhost:3000/items", dev)).toBe(false);
    expect(isAllowedUrl("https://localhost:5173/", dev)).toBe(false);
    expect(isAllowedUrl("http://example.com:5173/", dev)).toBe(false);
  });
});

type Prevent = { preventDefault: () => void };
type RequestFilter = (
  details: { url: string },
  callback: (response: { cancel: boolean }) => void,
) => void;

function fakeSession() {
  let filter: RequestFilter | undefined;
  let permission:
    | ((c: unknown, p: string, callback: (granted: boolean) => void) => void)
    | undefined;
  let check: (() => boolean) | undefined;
  const events = new Map<string, (event: Prevent) => void>();
  const session = {
    webRequest: {
      onBeforeRequest: (_f: unknown, listener: RequestFilter) =>
        (filter = listener),
    },
    setPermissionRequestHandler: (handler: typeof permission) =>
      (permission = handler),
    setPermissionCheckHandler: (handler: typeof check) => (check = handler),
    on: (event: string, listener: (event: Prevent) => void) =>
      events.set(event, listener),
  };
  return {
    session: session as unknown as Session,
    request(url: string) {
      let result: { cancel: boolean } | undefined;
      filter?.({ url }, (response) => (result = response));
      return result;
    },
    permission() {
      let granted: boolean | undefined;
      permission?.(undefined, "media", (value) => (granted = value));
      return granted;
    },
    check: () => check?.(),
    prevented(name: string) {
      let prevented = false;
      events.get(name)?.({ preventDefault: () => (prevented = true) });
      return prevented;
    },
  };
}

describe("lockDownSession (SEC-1, SEC-6)", () => {
  it("cancels requests to the network and keeps the app's own files", () => {
    const fake = fakeSession();
    lockDownSession(fake.session);
    expect(fake.request("https://example.com/")).toEqual({ cancel: true });
    expect(fake.request("file:///app/out/renderer/index.html")).toEqual({
      cancel: false,
    });
  });

  it("refuses every permission and download", () => {
    const fake = fakeSession();
    lockDownSession(fake.session);
    expect(fake.permission()).toBe(false);
    expect(fake.check()).toBe(false);
    expect(fake.prevented("will-download")).toBe(true);
  });
});

describe("lockDownContents (SEC-6)", () => {
  it("stops every navigation and every new window", () => {
    const events = new Map<string, (event: Prevent) => void>();
    let openHandler: (() => { action: string }) | undefined;
    const contents = {
      on: (event: string, listener: (event: Prevent) => void) =>
        events.set(event, listener),
      setWindowOpenHandler: (handler: typeof openHandler) =>
        (openHandler = handler),
    } as unknown as WebContents;

    lockDownContents(contents);

    for (const name of ["will-navigate", "will-attach-webview"]) {
      let prevented = false;
      events.get(name)?.({ preventDefault: () => (prevented = true) });
      expect(prevented, name).toBe(true);
    }
    expect(openHandler?.()).toEqual({ action: "deny" });
  });
});
