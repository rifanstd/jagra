import { defineConfig } from "vitest/config";

// `pnpm --filter @jagra/core test:device` drives a real emulator with the sample APK. Not run in CI.
export default defineConfig({
  test: { include: ["src/**/*.device.ts"], silent: false },
});
