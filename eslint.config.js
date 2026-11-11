import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// Package dependency rules from docs/architecture.md section 1 (D-18). CI fails when one is broken.
const ELECTRON = "^(@electron/|electron(-[\\w-]+)?(/|$))";
const REACT = "^(react|react-dom|@radix-ui/[\\w-]+)(/|$)";
const CLI = "^(jagra(/|$)|(\\.\\./)+(packages/)?cli(/|$))";
const DESKTOP = "^(@jagra/desktop(/|$)|(\\.\\./)+(packages/)?desktop(/|$))";
// Node built-ins, which the sandboxed renderer does not have (SEC-6).
const NODE =
  "^(node:|(fs|path|os|net|child_process|crypto|url|util|stream|events|zlib)(/|$))";

const restrict = (pkg, rules) =>
  rules.map(([regex, target]) => ({
    regex,
    message: `${pkg} must not depend on ${target} (docs/architecture.md section 1).`,
  }));

const forbid = (pkg, rules) => ({
  files: [`packages/${pkg}/**/*.{ts,tsx}`],
  rules: {
    "@typescript-eslint/no-restricted-imports": [
      "error",
      { patterns: restrict(pkg, rules) },
    ],
  },
});

export default defineConfig(
  {
    ignores: [
      "**/dist/",
      "**/coverage/",
      "packages/desktop/out/",
      "packages/desktop/test-results/",
    ],
  },
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
  {
    // The mockups' review script runs in a browser.
    files: ["design/screens/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
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
    // The renderer reaches main only through the preload API, and takes nothing but types from
    // core (SEC-6, architecture.md section 7).
    files: ["packages/desktop/src/renderer/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@jagra/core",
              message:
                "The renderer imports types from @jagra/core/types only.",
            },
            {
              name: "@jagra/core/types",
              allowTypeImports: true,
              message: "The renderer imports types only, with `import type`.",
            },
          ],
          patterns: restrict("The renderer", [
            [CLI, "cli"],
            [ELECTRON, "Electron; use the preload API"],
            [NODE, "Node; use the preload API"],
          ]),
        },
      ],
    },
  },
  {
    // React stays in the renderer.
    files: ["packages/desktop/src/{main,preload,shared}/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: restrict("Main and preload", [
            [CLI, "cli"],
            [REACT, "React"],
          ]),
        },
      ],
    },
  },
  {
    // Modules call ports, not programs. Only the ProcessRunner adapter may start one (SEC-8).
    files: ["packages/**/*.{ts,tsx}"],
    ignores: [
      "packages/core/src/adapters/process/**",
      "**/*.test.ts",
      "packages/desktop/e2e/**",
    ],
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
    files: [
      "packages/core/**/*.ts",
      "packages/cli/**/*.ts",
      "packages/desktop/src/**/*.{ts,tsx}",
    ],
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
