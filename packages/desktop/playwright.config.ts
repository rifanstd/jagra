import { defineConfig } from "@playwright/test";

// Runs the built app (`electron-vite build`) on this machine. CI runs it on Windows and macOS.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
});
