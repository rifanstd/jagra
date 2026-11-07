import { defineConfig } from "vitest/config";

// `pnpm --filter @jagra/core test:tools` checks the tools on this machine. Not run in CI.
export default defineConfig({
  test: { include: ["src/**/*.tools.ts"], silent: false },
});
