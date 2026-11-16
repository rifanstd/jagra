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

async function start(agents?: string): Promise<void> {
  home = await mkdtemp(join(tmpdir(), "jagra-e2e-"));
  ({ app, page } = await launch(home, {
    env: agents === undefined ? {} : { JAGRA_TEST_AGENTS: agents },
  }));
  await page.getByRole("button", { name: "Continue to projects" }).click();
}

test.afterEach(async () => {
  await app.close();
  await rm(home, { recursive: true, force: true });
});

/** The system dialog answers Save (0) or Cancel (1), and keeps what it was asked. */
async function answerConfirm(response: 0 | 1): Promise<void> {
  await app.evaluate(({ dialog }, value) => {
    (globalThis as { boxes?: unknown[] }).boxes = [];
    const show = (...args: unknown[]) => {
      (globalThis as { boxes?: unknown[] }).boxes?.push(args.at(-1));
      return Promise.resolve({ response: value, checkboxChecked: false });
    };
    dialog.showMessageBox = show;
  }, response);
}

const boxes = () =>
  app.evaluate(
    () =>
      (globalThis as { boxes?: { detail: string; message: string }[] }).boxes,
  );

test("lists the agents found, and keeps the one chosen (AGT-1, AGT-6)", async () => {
  await start("claude-code,opencode");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "AI agent", level: 2 }),
  ).toBeVisible();

  const claude = page.getByTestId("agent-claude-code");
  await expect(claude).toContainText("Found");
  await expect(page.getByTestId("agent-codex")).toContainText("Not installed");
  await expect(page.getByTestId("agent-opencode")).toContainText(
    "opencode acp",
  );
  await expect(claude.getByRole("radio")).toBeChecked();
  await expect(page.getByTestId("agent-codex").getByRole("radio")).toHaveCount(
    0,
  );

  await page.getByTestId("agent-opencode").getByRole("radio").click();
  await expect(
    page.getByTestId("agent-opencode").getByRole("radio"),
  ).toBeChecked();
  await page.getByRole("button", { name: "Jagra", exact: true }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByTestId("agent-opencode").getByRole("radio"),
  ).toBeChecked();

  // AGT-6: the provider terms note links to the README section.
  await app.evaluate(({ shell }) => {
    (globalThis as { links?: string[] }).links = [];
    shell.openExternal = (url: string) => {
      (globalThis as { links?: string[] }).links?.push(url);
      return Promise.resolve();
    };
  });
  await page
    .getByRole("button", { name: "Read about it in the README" })
    .click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as { links?: string[] }).links))
    .toEqual([
      "https://github.com/rifanstd/jagra#ai-agents-and-provider-terms",
    ]);
});

test("saves a custom agent only after the system dialog shows its split command (AGT-3, D-109)", async () => {
  await start();
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("button", { name: "Add an agent with its own command" })
    .click();
  const form = page.getByRole("dialog", {
    name: "Add an agent with its own command",
  });
  await form.getByLabel("Name").fill("My agent");
  await form.getByLabel("Start command").fill("my-agent --file");
  await form.getByRole("button", { name: "Check and save" }).click();
  await expect(form).toContainText("The command must contain {instructions}.");

  await form
    .getByLabel("Start command")
    .fill(`"C:\\Tools\\My Agent\\agent.exe" --file {instructions} ; rm -rf ~`);
  await answerConfirm(1);
  await form.getByRole("button", { name: "Check and save" }).click();
  await expect.poll(async () => (await boxes())?.length).toBe(1);
  // Cancelled in the system dialog: the form stays, nothing is saved.
  await expect(form).toBeVisible();
  await expect(page.getByTestId("agents")).not.toContainText("My agent");

  await answerConfirm(0);
  await form.getByRole("button", { name: "Check and save" }).click();
  await expect(form).toBeHidden();
  const [box] = (await boxes()) ?? [];
  expect(box?.message).toBe(
    "Jagra will start this program for My agent when you ask for a flow.",
  );
  expect(box?.detail).toContain(
    [
      "Start command",
      "  Program: C:\\Tools\\My Agent\\agent.exe",
      "  Argument 1: --file",
      "  Argument 2: {instructions}",
      "  Argument 3: ;",
      "  Argument 4: rm",
      "  Argument 5: -rf",
      "  Argument 6: ~",
    ].join("\n"),
  );
  const row = page.locator("[data-testid^=agent-custom-]");
  await expect(row).toContainText("My agent");
  await expect(row.getByRole("radio")).toBeChecked();

  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toHaveCount(0);
  await expect(
    page.getByTestId("agent-claude-code").getByRole("radio"),
  ).toBeChecked();
});

test("disables Create flow with AI when no agent is installed, and the rest still works (AGT-7)", async () => {
  await start("none");
  const folder = await makeFolder(home, "shop", {
    ".jagra/config.yaml": "format: 1\nname: shop\nappId: com.shop\n",
    ".jagra/flows/a.yaml": "appId: com.shop\n---\n- launchApp\n",
  });
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answer(app, [folder]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(
    page.getByRole("button", { name: "Create flow with AI" }),
  ).toBeDisabled();
  await expect(page.getByTestId("needs-agent")).toContainText(
    "Needs an AI agent installed on this computer, such as Claude Code.",
  );
  await expect(page.getByRole("button", { name: "New flow" })).toBeEnabled();
  await expect(page.getByTestId("flows-chosen")).toHaveText("1 of 1 chosen");

  await page.getByRole("button", { name: "Set one up in Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "AI agent", level: 2 }),
  ).toBeVisible();
  await expect(page.getByTestId("agents")).not.toContainText("Found");
});

test("shows no Create flow with AI button yet when an agent is set up (D-107)", async () => {
  await start("claude-code");
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await page.getByTestId("flows-chosen").waitFor();
  await expect(
    page.getByRole("button", { name: "Create flow with AI" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("needs-agent")).toHaveCount(0);
});
