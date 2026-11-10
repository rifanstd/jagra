import { defineConfig } from "vitest/config";

// Unit tests only. The Playwright tests in e2e/ run against the built app (`test:e2e`).
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
