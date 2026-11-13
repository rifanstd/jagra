import { mkdir, writeFile } from "node:fs/promises";
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
  options: { language?: string; tools?: string; devices?: string } = {},
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
      ...(options.devices === undefined
        ? {}
        : { JAGRA_TEST_DEVICES: options.devices }),
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector("main h1");
  return { app, page };
}

/** The next system dialogs answer with these paths, as if the user picked them. */
export async function answer(
  app: ElectronApplication,
  paths: string[],
): Promise<void> {
  await app.evaluate(({ dialog }, answers) => {
    const queue = [...answers];
    dialog.showOpenDialog = () => {
      const next = queue.shift();
      return Promise.resolve({
        canceled: next === undefined,
        filePaths: next === undefined ? [] : [next],
      });
    };
  }, paths);
}

/** A folder under the test's home, with the given files. */
export async function makeFolder(
  home: string,
  name: string,
  files: Record<string, string> = {},
): Promise<string> {
  const folder = join(home, name);
  await mkdir(folder, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(folder, file, ".."), { recursive: true });
    await writeFile(join(folder, file), text);
  }
  return folder;
}
