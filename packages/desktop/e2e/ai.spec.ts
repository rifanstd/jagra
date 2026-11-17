import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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

/** A project with one flow and a source file, opened on the Create flow with AI screen. */
async function start(env: Record<string, string> = {}): Promise<void> {
  home = await mkdtemp(join(tmpdir(), "jagra-e2e-"));
  ({ app, page } = await launch(home, {
    env: {
      JAGRA_TEST_FLOW_MS: "200",
      JAGRA_TEST_APK_PACKAGE: "com.shop",
      ...env,
    },
  }));
  await page.getByRole("button", { name: "Continue to projects" }).click();
  folder = await makeFolder(home, "shop", {
    ".jagra/config.yaml": "format: 1\nname: shop\nappId: com.shop\n",
    ".jagra/flows/login.yaml":
      "appId: com.shop\nname: Login\n---\n- launchApp\n",
    "app/strings.xml": "Sign in\n",
    "app/build/outputs/apk/debug/app-debug.apk": "apk",
  });
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answer(app, [folder]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Create flow with AI" }).click();
}

test.afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

const flowFile = (name: string) => join(folder, ".jagra", "flows", name);
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function ask(scenario: string, flowName?: string): Promise<void> {
  await page.getByLabel("Scenario").fill(scenario);
  if (flowName) await page.getByLabel("File name").fill(flowName);
  await page.getByRole("button", { name: "Create flow" }).click();
}

test("asks once per project, then writes, runs and reviews the flow (AGT-11 to AGT-23, AGT-26)", async () => {
  await start();
  await ask(
    "Log in with a wrong password, an error must appear",
    "Wrong password",
  );

  const notice = page.getByRole("dialog", {
    name: "Claude Code will read this project's code",
  });
  await expect(notice).toContainText(folder);
  await notice.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { name: "Review the flow" }),
  ).toBeVisible();
  expect(await readFile(flowFile("wrong-password.yaml"), "utf8")).toContain(
    "Written by the test agent",
  );
  // AGT-21: the flow runs once by itself on the device used last.
  await expect(page.getByTestId("review-status")).toContainText("Passed", {
    timeout: 15_000,
  });
  const steps = page.getByTestId("review-steps");
  await expect(steps).toContainText("Check");
  await expect(page.getByTestId("agent-report")).toContainText(
    "The item list shows after logging in.",
  );
  await page.getByRole("button", { name: "Show YAML" }).click();
  await expect(page.getByText("name: Written by the test agent")).toBeVisible();

  // AGT-26: Create this too keeps this flow and opens the request with the scenario.
  await page.getByRole("button", { name: "Create this too" }).click();
  await expect(page.getByLabel("Scenario")).toHaveValue(
    "Log in with an empty password",
  );
  expect(await exists(flowFile("wrong-password.yaml"))).toBe(true);

  // The notice does not show again for this project.
  await ask("Log in with an empty password");
  await expect(
    page.getByRole("heading", { name: "Review the flow" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save flow" }).click();
  await expect(
    page.getByText("Written by the test agent").first(),
  ).toBeVisible();
});

test("warns about a file changed outside .jagra/flows, shows it and restores it (AGT-19)", async () => {
  await start({ JAGRA_TEST_AGENT_OUTSIDE: "app/strings.xml" });
  await ask("x");
  await page
    .getByRole("dialog", { name: /will read/ })
    .getByRole("button", { name: "Continue" })
    .click();

  const warning = page.getByRole("dialog", {
    name: "The agent changed files outside the flows folder",
  });
  await expect(warning.getByTestId("outside-changes")).toContainText(
    "app/strings.xml",
  );
  await expect(warning.getByTestId("outside-changes")).toContainText("changed");
  await warning.getByRole("button", { name: "View changes" }).click();
  const views = page.getByTestId("change-views");
  await expect(views).toContainText("- Sign in");
  await expect(views).toContainText("+ changed by the test agent");
  await page.getByRole("button", { name: "Close" }).click();

  await warning.getByRole("button", { name: "Restore" }).click();
  await expect(
    page.getByRole("heading", { name: "Review the flow" }),
  ).toBeVisible();
  expect(await readFile(join(folder, "app", "strings.xml"), "utf8")).toBe(
    "Sign in\n",
  );
});

test("explains a failure, sends a fix to the agent, and Discard deletes the new flow (AGT-24, AGT-27)", async () => {
  await start({ JAGRA_TEST_RUN: "ai-flow.yaml=failed" });
  await ask("Open the item list");
  await page
    .getByRole("dialog", { name: /will read/ })
    .getByRole("button", { name: "Continue" })
    .click();

  await expect(page.getByTestId("failure-note")).toContainText(
    "An action failed. This is likely a problem in the flow",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("failure-screen")).toContainText(
    "Element not found",
  );

  await page
    .getByRole("textbox", { name: "Ask the agent to fix it" })
    .fill("The button is called Simpan");
  await page.getByRole("button", { name: "Send to the agent" }).click();
  await expect(
    page.getByRole("heading", { name: "Review the flow" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByTestId("flows-chosen")).toBeVisible();
  expect(await exists(flowFile("ai-flow.yaml"))).toBe(false);
  expect(await exists(flowFile("login.yaml"))).toBe(true);
});

test("cancels the agent and says so, with the safety net run (AGT-13)", async () => {
  await start({ JAGRA_TEST_AGENT_MS: "10000" });
  await ask("x");
  await page
    .getByRole("dialog", { name: /will read/ })
    .getByRole("button", { name: "Continue" })
    .click();
  await expect(
    page.getByRole("heading", { name: "The agent is writing the flow" }),
  ).toBeVisible();
  await expect(page.getByTestId("ai-steps")).toContainText(
    "Claude Code writes the flow",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "The agent stopped" }),
  ).toBeVisible();
  await expect(page.getByTestId("ai-error")).toContainText("was stopped");
  await page.getByRole("button", { name: "Back to the project" }).click();
  await expect(page.getByTestId("flows-chosen")).toBeVisible();
});
