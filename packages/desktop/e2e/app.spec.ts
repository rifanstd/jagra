import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { launch } from "./launch.js";

let home: string;
let app: ElectronApplication;
let page: Page;

async function start(options?: Parameters<typeof launch>[1]): Promise<void> {
  ({ app, page } = await launch(home, options));
}

test.beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "jagra-e2e-"));
});

test.afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("opens with the renderer isolated (SEC-6)", async () => {
  await start();
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
    api: ["app", "environment", "settings"],
  });
});

test("makes no network request (SEC-1, SEC-2)", async () => {
  await start();
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.reload();
  await page.waitForSelector("main h1");
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
  await start();
  await expect(
    page.getByRole("button", { name: "Jagra", exact: true }),
  ).toBeVisible();
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

  expect(dark.background).not.toBe(light.background);
  expect(light.font).toContain("Outfit");
  expect(await page.evaluate(() => document.fonts.check("16px Outfit"))).toBe(
    true,
  );
});

test("switches language without a restart, and keeps it (LNG-1)", async () => {
  await start({ language: "en-US" });
  await expect(
    page.getByRole("heading", { name: "Environment check" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Bahasa Indonesia" }).click();
  await expect(
    page.getByRole("heading", { name: "Pengaturan", level: 1 }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("id");

  await app.close();
  await start({ language: "en-US" });
  await expect(
    page.getByRole("heading", { name: "Cek lingkungan" }),
  ).toBeVisible();
});

test.describe("environment check (ENV)", () => {
  test("opens first, shows every tool ready, and is skipped once continued (ENV-7)", async () => {
    await start();
    await expect(
      page.getByRole("heading", { name: "Environment check" }),
    ).toBeVisible();
    for (const tool of ["java", "adb", "maestro", "emulator", "mockoon"]) {
      await expect(page.getByTestId(`tool-${tool}`)).toContainText("Ready");
    }
    await expect(page.getByTestId("tool-maestro")).toContainText("2.12.1");
    await expect(page.getByTestId("check-summary")).toContainText("Done in");

    await page.getByRole("button", { name: "Continue to projects" }).click();
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(page.getByTestId("environment-indicator")).toHaveText(
      /Environment ready/,
    );

    await app.close();
    await start();
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await page.getByTestId("environment-indicator").click();
    await expect(
      page.getByRole("heading", { name: "Environment check" }),
    ).toBeVisible();
  });

  test("blocks continuing while Maestro is missing, with this system's steps (ENV-2, ENV-4)", async () => {
    await start({ tools: "maestro=missing" });
    const maestro = page.getByTestId("tool-maestro");
    await expect(maestro).toContainText("Not found");
    const guide = page.getByTestId("guide-maestro");
    await expect(guide).toBeVisible();
    await expect(guide).toContainText(
      process.platform === "win32"
        ? "Download maestro.zip"
        : "Run Maestro's install script",
    );
    await expect(
      page.getByRole("button", { name: "Maestro official guide" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue to projects" }),
    ).toBeDisabled();
    await expect(
      page.getByText("You can continue once Maestro is ready"),
    ).toBeVisible();

    // The brand still leads to the project list, where the indicator names the problem.
    await page.getByRole("button", { name: "Jagra", exact: true }).click();
    await expect(page.getByTestId("environment-indicator")).toHaveText(
      /Maestro not found/,
    );
  });

  test("copies a step's command to the clipboard", async () => {
    await start({ tools: "maestro=missing" });
    const guide = page.getByTestId("guide-maestro");
    await guide.getByRole("button", { name: "Copy" }).first().click();
    await expect(guide.getByRole("button", { name: "Copied" })).toBeVisible();
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).toBe(
      process.platform === "win32"
        ? "C:\\maestro"
        : 'curl -Ls "https://get.maestro.mobile.dev" | bash',
    );
  });

  test("lets an optional tool be missing, and an untested version run (ENV-2, ENV-3)", async () => {
    await start({ tools: "mockoon=missing,maestro=2.13.0" });
    const mockoon = page.getByTestId("tool-mockoon");
    await expect(mockoon).toContainText("Not installed, optional");
    await expect(page.getByTestId("guide-mockoon")).toHaveCount(0);
    await mockoon.getByRole("button", { name: "How to install" }).click();
    await expect(page.getByTestId("guide-mockoon")).toContainText(
      "npm install -g @mockoon/cli",
    );

    await expect(page.getByTestId("tool-maestro")).toContainText(
      "Untested version",
    );
    await expect(
      page.getByText("An untested version can still be used."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue to projects" }),
    ).toBeEnabled();
  });

  test("names the reason a tool cannot start (D-35)", async () => {
    await start({ tools: "maestro=needs-java" });
    await expect(page.getByTestId("tool-maestro")).toContainText("Can't start");
    await expect(page.getByTestId("guide-maestro")).toContainText(
      "fix Java first",
    );
  });

  test("checks again (ENV-5)", async () => {
    await start();
    await expect(page.getByTestId("check-summary")).toContainText("Done in");
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByTestId("check-summary")).toContainText("Done in");
    await expect(page.getByTestId("tool-java")).toContainText("Ready");
  });
});
