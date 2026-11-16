import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
let folder: string;

test.beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "jagra-e2e-"));
  ({ app, page } = await launch(home));
  // Files would open in the machine's real default app; the test only records the path.
  await app.evaluate(({ shell }) => {
    (globalThis as { opened?: string[] }).opened = [];
    shell.openPath = (path: string) => {
      (globalThis as { opened?: string[] }).opened?.push(path);
      return Promise.resolve("");
    };
  });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  folder = await makeFolder(home, "shop", {
    ".jagra/config.yaml": "format: 1\nname: shop\nappId: com.shop\n",
    ".jagra/flows/a.yaml": "appId: com.shop\n---\n- launchApp\n",
  });
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answer(app, [folder]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByTestId("flows-chosen")).toHaveText("1 of 1 chosen");
});

test.afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("creates a flow from the template and opens it in the editor (FLOW-4)", async () => {
  await page.getByRole("button", { name: "New flow" }).click();
  const dialog = page.getByRole("dialog", { name: "New flow" });
  await dialog.getByLabel("Flow name").fill("Login with a wrong password");
  await dialog.getByRole("button", { name: "Create and open" }).click();
  await expect(dialog).toBeHidden();

  const file = join(
    folder,
    ".jagra",
    "flows",
    "login-with-a-wrong-password.yaml",
  );
  expect(await readFile(file, "utf8")).toBe(
    "appId: com.shop\nname: Login with a wrong password\nproperties:\n  condition: success\n---\n- launchApp:\n    clearState: true\n# Write the steps of this test below.\n",
  );
  expect(
    await app.evaluate(() => (globalThis as { opened?: string[] }).opened),
  ).toEqual([file]);
  await expect(
    page.getByTestId("flow-login-with-a-wrong-password.yaml"),
  ).toContainText("Login with a wrong password");

  await page.getByRole("button", { name: "New flow" }).click();
  await dialog.getByLabel("Flow name").fill("login with a WRONG password");
  await dialog.getByRole("button", { name: "Create and open" }).click();
  await expect(dialog).toContainText(
    "login-with-a-wrong-password.yaml exists already.",
  );
});

test("shows a flow added outside Jagra without any action (FLOW-8)", async () => {
  await writeFile(
    join(folder, ".jagra", "flows", "pulled.yaml"),
    "appId: com.shop\nname: Pulled from git\n---\n- launchApp\n",
  );
  await expect(page.getByText("Pulled from git")).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByTestId("flows-chosen")).toHaveText("2 of 2 chosen");
});

test("explains how to find element names with Maestro Studio (FLOW-9)", async () => {
  await page
    .getByRole("button", {
      name: "How to find element names with Maestro Studio",
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Finding element names with Maestro Studio",
  });
  await expect(dialog.getByTestId("studio-steps")).toContainText(
    "Right-click an element on the screen.",
  );
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});
