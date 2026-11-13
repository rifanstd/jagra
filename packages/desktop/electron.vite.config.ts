import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import { bundleSample, SAMPLE_APK_FOLDER } from "./src/build/sample.js";

const root = import.meta.dirname;
const coreSource = resolve(root, "../core/src/index.ts");

/**
 * While developing, React's hot reload adds an inline script, which the page's CSP blocks. Only the
 * dev server gets 'unsafe-inline' for scripts; a built app keeps the strict policy (SEC-6).
 */
function devServerCsp(): Plugin {
  return {
    name: "jagra-dev-server-csp",
    apply: "serve",
    transformIndexHtml: (html) =>
      html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
  };
}

/**
 * Copies the sample project next to the built main process, for Try the sample app (SMP-5).
 * Without its APK the app still builds, with a warning; a release build needs it (D-85).
 */
function sampleApp(): Plugin {
  return {
    name: "jagra-sample-app",
    closeBundle() {
      const { apk } = bundleSample(
        resolve(root, "../../sample-app"),
        resolve(root, "out/sample"),
      );
      if (!apk) {
        this.warn(
          `The sample app has no APK in ${SAMPLE_APK_FOLDER}. Run "./gradlew assembleDebug" in sample-app to include it.`,
        );
      }
    },
  };
}

export default defineConfig({
  main: {
    // core is bundled from its source, so the app needs no separate core build (D-58).
    resolve: {
      alias: [
        { find: /^@jagra\/core$/, replacement: coreSource },
        {
          find: /^@jagra\/core\/fakes$/,
          replacement: resolve(root, "../core/src/fakes/index.ts"),
        },
      ],
    },
    plugins: [sampleApp()],
    build: {
      externalizeDeps: { exclude: ["@jagra/core"] },
      rollupOptions: { input: { index: resolve(root, "src/main/index.ts") } },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(root, "src/preload/index.ts") },
        // A sandboxed preload must be CommonJS (SEC-6).
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(root, "src/renderer"),
    plugins: [react(), tailwindcss(), devServerCsp()],
    resolve: { alias: { "@renderer": resolve(root, "src/renderer/src") } },
    // The theme and fonts live in design/ at the repository root (D-38, D-39).
    server: { fs: { allow: [resolve(root, "../..")] } },
    build: {
      rollupOptions: {
        input: { index: resolve(root, "src/renderer/index.html") },
      },
    },
  },
});
