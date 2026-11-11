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
