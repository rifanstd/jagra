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

const HEADER = "appId: dev.jagra.sample\n---\n";

/** A project whose flows end as `outcomes` says, after one run. */
async function ranProject(outcomes: string): Promise<void> {
  ({ app, page } = await launch(home, {
    env: { JAGRA_TEST_RUN: outcomes, JAGRA_TEST_FLOW_MS: "100" },
  }));
  await page.getByRole("button", { name: "Continue to projects" }).click();
  const folder = await makeFolder(home, "shop", {
    ".jagra/config.yaml": "format: 1\nname: shop\nappId: dev.jagra.sample\n",
    "app/build/outputs/apk/debug/app-debug.apk": "apk",
    ".jagra/flows/save.yaml": `${HEADER}- runFlow: parts/login.yaml\n- tapOn: Save\n`,
    ".jagra/flows/list.yaml": `${HEADER}- launchApp:\n    clearState: true\n- assertVisible: Items\n`,
    ".jagra/flows/parts/login.yaml": `${HEADER}- launchApp\n- inputText: demo\n`,
  });
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answer(app, [folder]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Run 2 flows" }).click();
  await page.getByTestId("results-headline").waitFor({ timeout: 15_000 });
}

test("shows a failed flow step by step, with its helper's steps (RES-4)", async () => {
  await ranProject("save.yaml=failed");
  await page.getByTestId("result-save.yaml").click();

  await expect(
    page.getByRole("heading", { name: "save", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("detail-status")).toContainText("Failed");
  await expect(page.getByTestId("detail-status")).toContainText(
    "at step 2 of 2",
  );
  await expect(page.getByTestId("failure-note")).toContainText(
    "Step 2: Element not found: Text matching regex: Save",
  );
  const steps = page.getByTestId("steps");
  await expect(steps).toContainText("Run parts/login.yaml · login");
  await expect(steps).toContainText('Tap "Save"');
  await expect(steps).toContainText('Type "demo"');
  await expect(
    page.getByText("Maestro saved no screenshot for this flow."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Run results" }).click();
  await page.getByTestId("result-list.yaml").click();
  await expect(page.getByTestId("detail-status")).toContainText("Passed");
  await expect(page.getByTestId("steps")).toContainText(
    "Open the app with clean data",
  );
  await expect(page.getByTestId("steps")).toContainText(
    'Check "Items" is visible',
  );
});

test("says a black screenshot probably comes from FLAG_SECURE (RES-5)", async () => {
  await ranProject("save.yaml=black");
  await page.getByTestId("result-save.yaml").click();
  await expect(
    page.getByRole("img", {
      name: "Screenshot from Maestro at the failing step",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("black-screenshot")).toContainText(
    "FLAG_SECURE",
  );
});

test("shows the crash report of an app that crashed (RUN-6)", async () => {
  await ranProject("save.yaml=app-crashed");
  await page.getByTestId("result-save.yaml").click();
  await expect(page.getByTestId("failure-note")).toContainText(
    "The app crashed while the flow ran.",
  );
  await expect(page.getByTestId("crash-report")).toContainText(
    "FATAL EXCEPTION: main",
  );
});

test("lists the project's runs, and opens one (RES-9)", async () => {
  await ranProject("save.yaml=failed");
  await page.getByRole("button", { name: "See all runs" }).click();
  await expect(
    page.getByRole("heading", { name: "Run history" }),
  ).toBeVisible();
  const rows = page.locator("[data-testid^=history-]");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("1 passed, 1 failed");
  await expect(rows.first()).toContainText("1.0 (1)");
  await rows.first().click();
  await expect(page.getByTestId("results-headline")).toHaveText(
    "✕1 flow failed",
  );

  await page.getByRole("button", { name: "shop" }).click();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.locator("[data-testid^=history-]")).toHaveCount(1);
});
