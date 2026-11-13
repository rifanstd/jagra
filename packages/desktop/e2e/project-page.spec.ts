import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function start(devices?: string): Promise<void> {
  ({ app, page } = await launch(home, { devices }));
  const next = page.getByRole("button", { name: "Continue to projects" });
  if (await next.isVisible()) await next.click();
}

/** Creates a project from a new folder through the Create project screen. */
async function project(
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const folder = await makeFolder(home, name, files);
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answer(app, [folder]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return folder;
}

const FLOW = "appId: com.shop\n---\n";

test("shows the sample's flows, helper flow, Mockoon and device, and keeps the choice (RUN-2, DEV-3)", async () => {
  await start();
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await expect(
    page.getByRole("heading", { name: "Jagra sample app" }),
  ).toBeVisible();

  await expect(page.getByTestId("flows-chosen")).toHaveText("5 of 5 chosen");
  await expect(page.getByText("Renaming an item and saving it")).toBeVisible();
  await expect(page.getByTestId("helper-parts/login.yaml")).toContainText(
    "Used by",
  );
  await expect(page.getByTestId("mockoon")).toHaveText(
    ".jagra/mockoon.json, port 3000",
  );
  await expect(page.getByTestId("device").getByRole("combobox")).toHaveText(
    "Pixel_8 · emulator, running",
  );
  await expect(page.getByTestId("last-run")).toHaveText("Not run yet");

  await page.getByTestId("flow-save-item.yaml").getByRole("checkbox").click();
  await expect(page.getByTestId("flows-chosen")).toHaveText("4 of 5 chosen");

  await app.close();
  await start();
  await page.getByText("Jagra sample app").click();
  await expect(page.getByTestId("flows-chosen")).toHaveText("4 of 5 chosen");
  await expect(
    page.getByTestId("flow-save-item.yaml").getByRole("checkbox"),
  ).not.toBeChecked();
});

test("shows a new build without any action (PRJ-4)", async () => {
  await start();
  const folder = await project("shop", {});
  await expect(page.getByTestId("apk")).toContainText("No APK was found");

  await makeFolder(folder, "app/build/outputs/apk/debug");
  await writeFile(
    join(folder, "app/build/outputs/apk/debug/app-debug.apk"),
    "not a real apk",
  );
  await expect(page.getByTestId("apk")).toContainText("app-debug.apk", {
    timeout: 15_000,
  });
  // Test mode reads any APK file as version 1.0 (1) (D-81).
  await expect(page.getByTestId("apk")).toContainText("Version 1.0 (1)");
});

test("leaves a broken flow out, with its file and problem (FLOW-6)", async () => {
  await start();
  await project("broken-flow", {
    ".jagra/flows/good.yaml": `${FLOW}- launchApp\n`,
    ".jagra/flows/bad.yaml": `${FLOW}- tapOn: [Save\n`,
  });
  await expect(page.getByTestId("flows-chosen")).toHaveText(
    "1 of 2 chosen, 1 cannot run",
  );
  const bad = page.getByTestId("flow-bad.yaml");
  await expect(bad).toContainText("Broken");
  await expect(bad).toContainText("is not valid YAML");
  await expect(bad.getByRole("checkbox")).toBeDisabled();
  await expect(bad.getByRole("button", { name: "Open file" })).toBeVisible();
});

test("shows the phone checklist for a phone that is not authorised (DEV-6)", async () => {
  await start("R58M|phone-not-authorised|2201117TY");
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await expect(page.getByTestId("device").getByRole("combobox")).toHaveText(
    "2201117TY · phone, not authorised",
  );
  const note = page.getByTestId("device-note");
  await expect(note).toContainText("This phone has not allowed USB debugging.");
  await expect(note).toContainText(
    "Keep the screen on and unlocked during the run.",
  );
});

test("explains how to get a device when there is none", async () => {
  await start("none");
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await expect(page.getByTestId("device")).toContainText(
    "There is no emulator or phone yet.",
  );
});
