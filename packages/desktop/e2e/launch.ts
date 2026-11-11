import { join } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

// The package folder, as `electron .` does: Electron reads package.json for the name, version
// and the built main script.
const APP = join(import.meta.dirname, "..");

export interface Launched {
  app: ElectronApplication;
  page: Page;
}

/**
 * Starts the built app in test mode (D-81) with its own data folders, so tests never touch the
 * user's settings or tools. Jagra's data folder follows LOCALAPPDATA on Windows and the home
 * folder on macOS (D-58). `tools` changes what the fake tool check finds, for example
 * `maestro=missing`.
 */
export async function launch(
  home: string,
  options: { language?: string; tools?: string } = {},
): Promise<Launched> {
  const language = options.language ?? "en-US";
  const app = await electron.launch({
    args: [
      APP,
      `--user-data-dir=${join(home, "electron")}`,
      `--lang=${language}`,
    ],
    env: {
      ...process.env,
      LOCALAPPDATA: join(home, "local"),
      HOME: home,
      LANG: language,
      JAGRA_TEST_MODE: "1",
      JAGRA_TEST_TOOLS: options.tools ?? "",
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector("main h1");
  return { app, page };
}
