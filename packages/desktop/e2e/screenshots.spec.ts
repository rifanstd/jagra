import { join } from "node:path";
import { _electron as electron, test } from "@playwright/test";

// Not a check: saves screenshots of the placeholder screen for a person to look at.
// `SCREENSHOTS=<folder> pnpm --filter @jagra/desktop exec playwright test screenshots`
const folder = process.env.SCREENSHOTS;

test.skip(!folder, "set SCREENSHOTS to a folder to take screenshots");

test("screenshots in light and dark mode", async () => {
  const app = await electron.launch({
    args: [join(import.meta.dirname, "..")],
  });
  const page = await app.firstWindow();
  await page.waitForSelector("[data-testid=version]");
  await page.emulateMedia({ colorScheme: null });
  for (const theme of ["light", "dark"] as const) {
    await app.evaluate(
      ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
      theme,
    );
    await page.waitForTimeout(300);
    await page.screenshot({
      path: join(folder ?? "", `placeholder-${theme}.png`),
    });
  }
  await app.close();
});
