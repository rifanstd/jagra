import { join } from "node:path";
import { defineConfig } from "vitest/config";

const core = (path: string) =>
  join(import.meta.dirname, "..", "core", "src", path);

// Unit tests only, on core's source. The Playwright tests in e2e/ run against the built app.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@jagra\/core$/, replacement: core("index.ts") },
      { find: /^@jagra\/core\/fakes$/, replacement: core("fakes/index.ts") },
      { find: /^@jagra\/core\/types$/, replacement: core("public-types.ts") },
    ],
  },
  test: { include: ["src/**/*.test.ts"] },
});
