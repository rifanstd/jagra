import type { Session, WebContents } from "electron";

/**
 * Whether the app may load a URL. Only its own files, and the Vite dev server while developing.
 * Everything else is refused, so the interface makes no network request (SEC-1, SEC-2).
 */
export function isAllowedUrl(url: string, devServer?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (["file:", "data:", "blob:", "devtools:"].includes(parsed.protocol))
    return true;
  if (devServer === undefined) return false;
  const dev = new URL(devServer);
  // Vite's hot reload talks over a WebSocket on the same host and port.
  const sameServer =
    parsed.host === dev.host && parsed.hostname === "localhost";
  return sameServer && ["http:", "ws:"].includes(parsed.protocol);
}

/** Refuses every request, permission and download the app did not ask for. */
export function lockDownSession(session: Session, devServer?: string): void {
  session.webRequest.onBeforeRequest(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      callback({ cancel: !isAllowedUrl(details.url, devServer) });
    },
  );
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  session.on("will-download", (event) => event.preventDefault());
}

/**
 * No navigation and no new windows (SEC-6). The interface is one page; a link that tries to leave
 * it, even to another local file, is stopped.
 */
export function lockDownContents(contents: WebContents): void {
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}
