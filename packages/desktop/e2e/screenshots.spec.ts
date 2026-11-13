import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "@playwright/test";
import { launch } from "./launch.js";

// Not a check: saves screenshots of the screens for a person to compare with the mockups.
// `SCREENSHOTS=<folder> pnpm --filter @jagra/desktop exec playwright test screenshots`
const folder = process.env.SCREENSHOTS ?? "";

test.skip(!folder, "set SCREENSHOTS to a folder to take screenshots");

const STATES = {
  ready: "",
  "maestro-missing": "maestro=missing,mockoon=missing",
  untested: "mockoon=9.12.0",
};

for (const [name, tools] of Object.entries(STATES)) {
  test(`environment check, ${name}`, async () => {
    const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
    for (const language of ["en", "id"] as const) {
      const { app, page } = await launch(home, { tools });
      // Windows ignores --lang, so the language is set the way the Settings screen does.
      await page.evaluate(
        (value) =>
          (
            window as unknown as {
              jagra: { settings: { set(change: object): Promise<unknown> } };
            }
          ).jagra.settings.set({ language: value }),
        language,
      );
      await page.reload();
      await page.setViewportSize({ width: 1200, height: 900 });
      await page
        .getByTestId("check-summary")
        .filter({ hasText: /\d/ })
        .waitFor();
      await page.emulateMedia({ colorScheme: null });
      for (const theme of ["light", "dark"] as const) {
        await app.evaluate(
          ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
          theme,
        );
        await page.waitForTimeout(300);
        await page.screenshot({
          path: join(folder, `environment-${name}-${language}-${theme}.png`),
          fullPage: true,
        });
      }
      await app.close();
    }
    await rm(home, { recursive: true, force: true });
  });
}

test("project screens", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
  const { app, page } = await launch(home);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  const answer = (paths: string[]) =>
    app.evaluate(({ dialog }, answers) => {
      const queue = [...answers];
      dialog.showOpenDialog = () => {
        const next = queue.shift();
        return Promise.resolve({
          canceled: next === undefined,
          filePaths: next === undefined ? [] : [next],
        });
      };
    }, paths);
  const shoot = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      await app.evaluate(
        ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
        theme,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(folder, `${name}-${theme}.png`),
        fullPage: true,
      });
    }
  };
  await shoot("projects-empty");

  // Create, with the sample's own folder so the existing .jagra and its APK show.
  const sample = join(import.meta.dirname, "..", "out", "sample");
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answer([sample]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByTestId("folder-note").waitFor();
  await shoot("create-existing");

  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByTestId("flows-chosen").waitFor();
  await page.getByTestId("device").getByRole("combobox").waitFor();
  await shoot("project-sample");
  await page.getByRole("button", { name: "Jagra", exact: true }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await answer([home]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByTestId("folder-note").waitFor();
  await shoot("create-new");
  await page.getByRole("button", { name: "Create project" }).click();
  await shoot("project-page");

  await page.getByRole("button", { name: "Jagra", exact: true }).click();
  await page.getByText("Not run yet").first().waitFor();
  await shoot("projects-list");
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("run screens", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
  const { app, page } = await launch(home, {
    env: {
      JAGRA_TEST_FLOW_MS: "2500",
      JAGRA_TEST_RUN: "save-item.yaml=failed",
    },
  });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await page.getByTestId("flows-chosen").waitFor();
  const shoot = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      await app.evaluate(
        ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
        theme,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(folder, `${name}-${theme}.png`),
        fullPage: true,
      });
    }
  };
  await page.getByRole("button", { name: "Run 5 flows" }).click();
  await page
    .getByTestId("run-flow-item-list.yaml")
    .filter({ hasText: "Running" })
    .waitFor();
  await shoot("running");
  await page.getByTestId("results-headline").waitFor({ timeout: 30_000 });
  await shoot("results");
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("flow detail and history screens", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
  const { app, page } = await launch(home, {
    env: { JAGRA_TEST_FLOW_MS: "100", JAGRA_TEST_RUN: "save-item.yaml=black" },
  });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await page.getByRole("button", { name: "Run 5 flows" }).click();
  await page.getByTestId("results-headline").waitFor({ timeout: 30_000 });
  const shoot = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      await app.evaluate(
        ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
        theme,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(folder, `${name}-${theme}.png`),
        fullPage: true,
      });
    }
  };
  await page.getByTestId("result-save-item.yaml").click();
  await page.getByTestId("steps").waitFor();
  await shoot("flow-detail");
  await page.getByRole("button", { name: "Run results" }).click();
  await page.getByRole("button", { name: "See all runs" }).click();
  await page.locator("[data-testid^=history-]").first().waitFor();
  await shoot("history");
  await app.close();
  await rm(home, { recursive: true, force: true });
});
