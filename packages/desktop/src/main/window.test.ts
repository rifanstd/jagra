import { describe, expect, it } from "vitest";
import { SECURE_WEB_PREFERENCES, windowOptions } from "./window.js";

// SEC-6 and D-19: this test must fail when any of these settings changes. Do not edit the expected
// values to make it pass.
describe("window security settings (SEC-6)", () => {
  it("keeps the renderer isolated", () => {
    expect(SECURE_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
    });
  });

  it("gives every window those settings and the preload script", () => {
    const options = windowOptions("/app/preload/index.cjs");
    expect(options.webPreferences).toEqual({
      ...SECURE_WEB_PREFERENCES,
      preload: "/app/preload/index.cjs",
    });
  });
});
