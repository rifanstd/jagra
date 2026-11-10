import { join } from "node:path";
import { defineConfig } from "vitest/config";

const core = (path) => join(import.meta.dirname, "..", "core", "src", path);

// Tests use core's source, so they need no build first.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@jagra\/core$/, replacement: core("index.ts") },
      { find: /^@jagra\/core\/fakes$/, replacement: core("fakes/index.ts") },
    ],
  },
});
