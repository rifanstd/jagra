import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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

const answerDialogs = (paths: string[]) => answer(app, paths);
const appFolder = (name: string, files: Record<string, string> = {}) =>
  makeFolder(home, name, files);

test("an empty list offers the sample app, which opens its project page (SMP-6)", async () => {
  await expect(
    page.getByRole("heading", { name: "No projects yet" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await expect(
    page.getByRole("heading", { name: "Jagra sample app" }),
  ).toBeVisible();

  // Test mode keeps the copy inside the test's own data folder (D-87).
  // Jagra's data folder follows LOCALAPPDATA on Windows and the home folder on macOS (D-58).
  const appData =
    process.platform === "win32"
      ? join(home, "local", "jagra")
      : join(home, "Library", "Application Support", "jagra");
  const copy = join(appData, "documents", "Jagra", "sample-app");
  expect(await readdir(join(copy, ".jagra"))).toContain("config.yaml");

  await page.getByRole("button", { name: "Jagra", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(copy)).toBeVisible();
  await expect(page.getByText("Not run yet")).toBeVisible();
});

test("creates a project from a folder without .jagra (PRJ-1, PRJ-2, PRJ-4)", async () => {
  const folder = await appFolder("toko-kopi", { "build.gradle.kts": "// app" });
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answerDialogs([folder]);
  await page.getByRole("button", { name: "Choose folder" }).click();

  await expect(page.getByTestId("folder-note")).toContainText(
    "There is no .jagra folder yet",
  );
  await expect(page.getByLabel("Project name")).toHaveValue("toko-kopi");
  await expect(page.getByTestId("found-apk")).toContainText(
    "There is no APK in that folder yet",
  );
  await page.getByLabel("Project name").fill("Toko Kopi");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: "Toko Kopi" })).toBeVisible();
  expect((await readdir(folder)).sort()).toEqual([
    ".jagra",
    "build.gradle.kts",
  ]);
  expect(
    await readFile(join(folder, ".jagra", "config.yaml"), "utf8"),
  ).toContain("name: Toko Kopi");
});

test("shows the Mockoon tips once a Mockoon file is chosen (MCK-6)", async () => {
  const folder = await appFolder("shop", { ".jagra/mockoon.json": "{}" });
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answerDialogs([
    folder,
    join(home, "elsewhere.json"),
    join(folder, ".jagra", "mockoon.json"),
  ]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "Choose file" }).click();
  await expect(page.getByText("is outside the project folder")).toBeVisible();
  await page.getByRole("button", { name: "Choose file" }).click();
  await expect(page.getByLabel("Mockoon file")).toHaveValue(
    ".jagra/mockoon.json",
  );
  await expect(page.getByTestId("mockoon-tips")).toContainText(
    "network security config",
  );
});

test("adds a folder with a broken config.yaml untouched, and the list shows the problem (PRJ-10)", async () => {
  const text = "format: 1\nname: [\n";
  const folder = await appFolder("broken", { ".jagra/config.yaml": text });
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answerDialogs([folder]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByTestId("folder-note")).toContainText(
    "is not valid YAML",
  );
  await page.getByRole("button", { name: "Add project as it is" }).click();

  await page.getByRole("button", { name: "Jagra", exact: true }).click();
  await expect(page.getByText("config.yaml has a problem")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open file" })).toBeVisible();
  expect(await readFile(join(folder, ".jagra", "config.yaml"), "utf8")).toBe(
    text,
  );
});

test("finds a moved project with Locate, and removes one without deleting files (PRJ-7, PRJ-8)", async () => {
  const folder = await appFolder("moving", {
    ".jagra/config.yaml": "format: 1\nname: moving\n",
  });
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answerDialogs([folder]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "moving" })).toBeVisible();

  const moved = await appFolder("moved", {
    ".jagra/config.yaml": "format: 1\nname: moving\n",
  });
  await rm(folder, { recursive: true });
  await page.getByRole("button", { name: "Jagra", exact: true }).click();
  await expect(page.getByText("Folder not found")).toBeVisible();
  await answerDialogs([moved]);
  await page.getByRole("button", { name: "Locate" }).click();
  await expect(page.getByText(moved)).toBeVisible();

  await page.getByText(moved).click();
  await page.getByRole("button", { name: "Remove from list" }).click();
  await expect(
    page.getByRole("heading", { name: "No projects yet" }),
  ).toBeVisible();
  expect(await readdir(join(moved, ".jagra"))).toContain("config.yaml");
});
