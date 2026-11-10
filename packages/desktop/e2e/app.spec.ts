import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

// The package folder, as `electron .` does: Electron reads package.json for the name, version
// and the built main script.
const APP = join(import.meta.dirname, "..");

let home: string;
let app: ElectronApplication;
let page: Page;

/**
 * Starts the built app with its own data folders, so tests never touch the user's settings.
 * Jagra's data folder follows LOCALAPPDATA on Windows and the home folder on macOS (D-58).
 */
async function launch(language = "en-US"): Promise<void> {
  app = await electron.launch({
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
    },
  });
  page = await app.firstWindow();
  await page.waitForSelector("[data-testid=version]");
}

test.beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "jagra-e2e-"));
});

test.afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("opens with the renderer isolated (SEC-6)", async () => {
  await launch();
  // getLastWebPreferences is not in Electron's typings, but it reports what the window really got.
  const preferences = await app.evaluate(({ BrowserWindow }) =>
    (
      BrowserWindow.getAllWindows()[0]?.webContents as unknown as {
        getLastWebPreferences(): Record<string, unknown>;
      }
    ).getLastWebPreferences(),
  );
  expect(preferences).toMatchObject({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });

  const exposed = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    api: Object.keys((window as unknown as { jagra: object }).jagra).sort(),
  }));
  expect(exposed).toEqual({
    require: "undefined",
    process: "undefined",
    api: ["app", "settings"],
  });
  await expect(page.getByTestId("version")).toHaveText("Version 0.0.0");
});

test("makes no network request (SEC-1, SEC-2)", async () => {
  await launch();
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.reload();
  await page.waitForSelector("[data-testid=version]");
  expect(requested.length).toBeGreaterThan(0);
  for (const url of requested) expect(url).toMatch(/^(file|data):/);

  const reached = await page.evaluate(async () => {
    try {
      await fetch("https://example.com/");
      return true;
    } catch {
      return false;
    }
  });
  expect(reached).toBe(false);
});

test("shows the theme with its bundled font, in light and dark mode (SET-2)", async () => {
  await launch();
  await expect(page.getByText("Jagra", { exact: true })).toBeVisible();
  const look = () =>
    page.evaluate(() => ({
      dark: document.documentElement.classList.contains("dark"),
      background: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(document.body).fontFamily,
    }));

  // What the operating system setting does: Electron's theme source drives prefers-color-scheme.
  // Playwright forces a light scheme by default, which would hide that, so it is switched off.
  await page.emulateMedia({ colorScheme: null });
  const system = (theme: "light" | "dark") =>
    app.evaluate(
      ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
      theme,
    );
  await system("light");
  await expect.poll(look).toMatchObject({ dark: false });
  const light = await look();
  await system("dark");
  await expect.poll(look).toMatchObject({ dark: true });
  const dark = await look();

  expect(light.dark).toBe(false);
  expect(dark.dark).toBe(true);
  expect(dark.background).not.toBe(light.background);
  expect(light.font).toContain("Outfit");
  expect(await page.evaluate(() => document.fonts.check("16px Outfit"))).toBe(
    true,
  );
});

test("switches language without a restart, and keeps it (LNG-1)", async () => {
  await launch("en-US");
  await expect(
    page.getByText("Tests Android builds before they go to QA."),
  ).toBeVisible();

  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Bahasa Indonesia" }).click();
  await expect(
    page.getByText("Menguji build Android sebelum masuk ke QA."),
  ).toBeVisible();

  await app.close();
  await launch("en-US");
  await expect(
    page.getByText("Menguji build Android sebelum masuk ke QA."),
  ).toBeVisible();
});
