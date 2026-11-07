import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// Package dependency rules from docs/architecture.md section 1 (D-18). CI fails when one is broken.
const ELECTRON = "^(@electron/|electron(-[\\w-]+)?(/|$))";
const REACT = "^(react|react-dom|@radix-ui/[\\w-]+)(/|$)";
const CLI = "^(jagra(/|$)|(\\.\\./)+(packages/)?cli(/|$))";
const DESKTOP = "^(@jagra/desktop(/|$)|(\\.\\./)+(packages/)?desktop(/|$))";

const forbid = (pkg, rules) => ({
  files: [`packages/${pkg}/**/*.ts`],
  rules: {
    "@typescript-eslint/no-restricted-imports": [
      "error",
      {
        patterns: rules.map(([regex, target]) => ({
          regex,
          message: `${pkg} must not depend on ${target} (docs/architecture.md section 1).`,
        })),
      },
    ],
  },
});

export default defineConfig(
  { ignores: ["**/dist/", "**/coverage/"] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  forbid("core", [
    [ELECTRON, "Electron"],
    [REACT, "React"],
    [CLI, "cli"],
    [DESKTOP, "desktop"],
  ]),
  forbid("cli", [
    [ELECTRON, "Electron"],
    [REACT, "React"],
    [DESKTOP, "desktop"],
  ]),
  forbid("desktop", [[CLI, "cli"]]),
  {
    // Modules call ports, not programs. Only the ProcessRunner adapter may start one (SEC-8).
    files: ["packages/**/*.ts"],
    ignores: ["packages/core/src/adapters/process/**", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "child_process",
              message: "Start programs through the ProcessRunner port.",
            },
            {
              name: "node:child_process",
              message: "Start programs through the ProcessRunner port.",
            },
          ],
        },
      ],
    },
  },
  {
    // A dynamic import() would slip past the dependency rules above.
    files: ["packages/core/**/*.ts", "packages/cli/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Use a static import so the dependency rules can check it.",
        },
      ],
    },
  },
  prettier,
);
