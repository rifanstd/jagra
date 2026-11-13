import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { answer, launch, makeFolder } from "./launch.js";

let home: string;
let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "jagra-e2e-"));
});

test.afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

async function start(
  options: Parameters<typeof launch>[1] = {},
): Promise<void> {
  ({ app, page } = await launch(home, options));
  // With a required tool missing, Continue stays off; the name in the top bar still leads on.
  await page.getByRole("button", { name: "Jagra", exact: true }).click();
}

/** A project with an APK and flows, created through the Create project screen. */
async function project(files: Record<string, string>): Promise<void> {
  const folder = await makeFolder(home, "shop", {
    ".jagra/config.yaml": "format: 1\nname: shop\nappId: dev.jagra.sample\n",
    "app/build/outputs/apk/debug/app-debug.apk": "apk",
    ...files,
  });
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answer(app, [folder]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("heading", { name: "shop", exact: true }),
  ).toBeVisible();
}

const FLOW = "appId: dev.jagra.sample\n---\n- launchApp\n";

test("runs the chosen flows and shows what failed (RUN-8, RES-2, RES-3)", async () => {
  await start({
    env: { JAGRA_TEST_RUN: "c.yaml=failed", JAGRA_TEST_FLOW_MS: "600" },
  });
  await project({
    ".jagra/flows/a.yaml": FLOW,
    ".jagra/flows/b.yaml": FLOW,
    ".jagra/flows/c.yaml": FLOW,
  });

  await page.getByRole("button", { name: "Run 3 flows" }).click();
  await expect(page.getByTestId("running-title")).toHaveText(/Flow \d of 3/);
  await expect(page.getByTestId("run-flow-a.yaml")).toContainText(
    /Running|Passed/,
  );

  await expect(page.getByTestId("results-headline")).toHaveText(
    "✕1 flow failed",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("results-counts")).toHaveText(
    "2 passed, 1 failed of 3 flows",
  );
  await expect(page.getByTestId("result-c.yaml")).toContainText(
    "Step 2: Element not found: Text matching regex: Save",
  );
  await expect(page.getByTestId("result-a.yaml")).toContainText("Passed");

  await page.getByRole("button", { name: "shop" }).click();
  await expect(page.getByTestId("last-run")).toContainText(
    "2 passed, 1 failed",
  );
  await page.getByTestId("last-run").getByRole("button").click();
  await expect(page.getByTestId("results-headline")).toHaveText(
    "✕1 flow failed",
  );
});

test("cancels at once and keeps what finished (RUN-9)", async () => {
  await start({ env: { JAGRA_TEST_FLOW_MS: "4000" } });
  await project({ ".jagra/flows/a.yaml": FLOW, ".jagra/flows/b.yaml": FLOW });
  await page.getByRole("button", { name: "Run 2 flows" }).click();
  await expect(page.getByTestId("run-flow-a.yaml")).toContainText("Running");
  await page.getByRole("button", { name: "Cancel run" }).click();
  await expect(page.getByTestId("results-headline")).toHaveText(
    "–Run cancelled",
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("results-counts")).toHaveText(
    "2 cancelled of 2 flows",
  );
});

test("asks for a missing variable before the run, and never shows it (RUN-10, SEC-4)", async () => {
  await start({ env: { JAGRA_TEST_FLOW_MS: "100" } });
  await project({
    ".jagra/flows/login.yaml":
      "appId: dev.jagra.sample\n---\n- inputText: ${PASSWORD}\n",
  });
  await page.getByRole("button", { name: "Run 1 flow" }).click();

  const dialog = page.getByRole("dialog", {
    name: "Fill in the variable values",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("PASSWORD").fill("hunter2");
  await dialog.getByRole("button", { name: "Save and run" }).click();
  await expect(page.getByTestId("results-headline")).toHaveText(
    "✓All flows passed",
    { timeout: 10_000 },
  );
  expect(await page.content()).not.toContain("hunter2");
});

test("asks before running an APK with another package (PRJ-6)", async () => {
  await start({
    env: { JAGRA_TEST_APK_PACKAGE: "com.other", JAGRA_TEST_FLOW_MS: "100" },
  });
  await project({ ".jagra/flows/a.yaml": FLOW });
  await page.getByRole("button", { name: "Run 1 flow" }).click();
  const dialog = page.getByRole("dialog", { name: "Different APK package" });
  await expect(dialog).toContainText("This APK is com.other, while appId");
  await dialog.getByRole("button", { name: "Run anyway" }).click();
  await expect(page.getByTestId("results-headline")).toHaveText(
    "✓All flows passed",
    { timeout: 10_000 },
  );
});

test("names the tool that stops a run (ENV-8)", async () => {
  await start({ tools: "maestro=missing" });
  await project({ ".jagra/flows/a.yaml": FLOW });
  await page.getByRole("button", { name: "Run 1 flow" }).click();
  await expect(page.getByTestId("run-blocked")).toContainText(
    "Maestro not found",
  );
});
