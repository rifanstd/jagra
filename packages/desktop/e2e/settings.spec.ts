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
  ({ app, page } = await launch(home));
  await page.getByRole("button", { name: "Continue to projects" }).click();
});

test.afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

async function openSettings(name: string): Promise<void> {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

test("lists a project's variables and keeps their values hidden (FLOW-7, SEC-4)", async () => {
  const folder = await makeFolder(home, "shop", {
    ".jagra/config.yaml": "format: 1\nname: shop\n",
    ".jagra/flows/login.yaml":
      "appId: com.shop\n---\n- inputText: ${PASSWORD}\n",
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

  await openSettings("Secrets");
  const row = page.getByTestId("secret-PASSWORD");
  await expect(row).toContainText("Not set");
  await row.getByRole("button", { name: "Set value" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("hunter2");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("***");
  expect(await page.content()).not.toContain("hunter2");

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toContainText("Not set");
});

test("follows the system language again when asked (LNG-1)", async () => {
  await openSettings("Language");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Bahasa Indonesia" }).click();
  await expect(
    page.getByRole("heading", { name: "Pengaturan", level: 1 }),
  ).toBeVisible();

  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: /^Ikuti sistem/ }).click();
  const settings = await page.evaluate(() =>
    (
      window as unknown as {
        jagra: {
          settings: { get(): Promise<{ settings: { language?: string } }> };
        };
      }
    ).jagra.settings.get(),
  );
  expect(settings.settings.language).toBeUndefined();
});

test("sets a tool's location by hand, and goes back to automatic (ENV-6)", async () => {
  const maestro = join(
    await makeFolder(home, "tools", { "maestro.bat": "" }),
    "maestro.bat",
  );
  await openSettings("Tool locations");
  const row = page.getByTestId("location-maestro");
  await expect(row).toContainText("Automatic: /test/maestro");
  await answer(app, [maestro]);
  await row.getByRole("button", { name: "Set" }).click();
  await expect(row).toContainText(`Set by hand: ${maestro}`);
  await row.getByRole("button", { name: "Back to automatic" }).click();
  await expect(row).toContainText("Automatic:");
});

test("opens flows with a program chosen through the system's dialog (FLOW-5, D-96)", async () => {
  const editor = join(
    await makeFolder(home, "editor", { "Code.exe": "" }),
    "Code.exe",
  );
  await openSettings("Editor");
  await expect(
    page.getByRole("radio", {
      name: "The system's default app for .yaml files",
    }),
  ).toBeChecked();
  await answer(app, [editor]);
  await page.getByRole("radio", { name: "A program you choose" }).click();
  await expect(page.getByTestId("editor-path")).toHaveText(editor);
  await page
    .getByRole("radio", { name: "The system's default app for .yaml files" })
    .click();
  await expect(page.getByTestId("editor-path")).toHaveCount(0);
});

test("shows About, and copies the bug report info (ABT-1, REL-7)", async () => {
  await page.getByRole("button", { name: "About" }).click();
  await expect(page.getByTestId("version")).toHaveText("0.0.0");
  await expect(page.getByText("Rifan Setiadi")).toBeVisible();
  await expect(page.getByText("github.com/rifanstd/jagra")).toBeVisible();
  await page.getByRole("button", { name: "Copy info for bug report" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(copied).toContain("Jagra 0.0.0");
  expect(copied).toContain("- maestro: 2.12.1 (ready)");
  expect(copied).toContain("Log (latest part):");
});
