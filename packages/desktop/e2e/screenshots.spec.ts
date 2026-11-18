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

test("project screens", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
  const { app, page } = await launch(home);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  const answer = (paths: string[]) =>
    app.evaluate(({ dialog }, answers) => {
      const queue = [...answers];
      dialog.showOpenDialog = () => {
        const next = queue.shift();
        return Promise.resolve({
          canceled: next === undefined,
          filePaths: next === undefined ? [] : [next],
        });
      };
    }, paths);
  const shoot = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      await app.evaluate(
        ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
        theme,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(folder, `${name}-${theme}.png`),
        fullPage: true,
      });
    }
  };
  await shoot("projects-empty");

  // Create, with the sample's own folder so the existing .jagra and its APK show.
  const sample = join(import.meta.dirname, "..", "out", "sample");
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answer([sample]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByTestId("folder-note").waitFor();
  await shoot("create-existing");

  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByTestId("flows-chosen").waitFor();
  await page.getByTestId("device").getByRole("combobox").waitFor();
  await shoot("project-sample");
  await page.getByRole("button", { name: "Jagra", exact: true }).click();
  await page.getByRole("button", { name: "Create project" }).click();
  await answer([home]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByTestId("folder-note").waitFor();
  await shoot("create-new");
  await page.getByRole("button", { name: "Create project" }).click();
  await shoot("project-page");

  await page.getByRole("button", { name: "Jagra", exact: true }).click();
  await page.getByText("Not run yet").first().waitFor();
  await shoot("projects-list");
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("run screens", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
  const { app, page } = await launch(home, {
    env: {
      JAGRA_TEST_FLOW_MS: "2500",
      JAGRA_TEST_RUN: "save-item.yaml=failed",
    },
  });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await page.getByTestId("flows-chosen").waitFor();
  const shoot = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      await app.evaluate(
        ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
        theme,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(folder, `${name}-${theme}.png`),
        fullPage: true,
      });
    }
  };
  await page.getByRole("button", { name: "Run 5 flows" }).click();
  await page
    .getByTestId("run-flow-item-list.yaml")
    .filter({ hasText: "Running" })
    .waitFor();
  await shoot("running");
  await page.getByTestId("results-headline").waitFor({ timeout: 30_000 });
  await shoot("results");
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("flow detail and history screens", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
  const { app, page } = await launch(home, {
    env: { JAGRA_TEST_FLOW_MS: "100", JAGRA_TEST_RUN: "save-item.yaml=black" },
  });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await page.getByRole("button", { name: "Run 5 flows" }).click();
  await page.getByTestId("results-headline").waitFor({ timeout: 30_000 });
  const shoot = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      await app.evaluate(
        ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
        theme,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(folder, `${name}-${theme}.png`),
        fullPage: true,
      });
    }
  };
  await page.getByTestId("result-save-item.yaml").click();
  await page.getByTestId("steps").waitFor();
  await shoot("flow-detail");
  await page.getByRole("button", { name: "Run results" }).click();
  await page.getByRole("button", { name: "See all runs" }).click();
  await page.locator("[data-testid^=history-]").first().waitFor();
  await shoot("history");
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("settings and about screens", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
  const { app, page } = await launch(home);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await page.getByTestId("flows-chosen").waitFor();
  const shoot = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      await app.evaluate(
        ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
        theme,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(folder, `${name}-${theme}.png`),
        fullPage: true,
      });
    }
  };
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("agent-claude-code").waitFor();
  await shoot("settings-agent");
  await page.getByRole("button", { name: "Secrets", exact: true }).click();
  await page.getByText("No flow of this project uses a variable.").waitFor();
  await shoot("settings-secrets");
  await page
    .getByRole("button", { name: "Tool locations", exact: true })
    .click();
  await shoot("settings-tools");
  await page.getByRole("button", { name: "Editor", exact: true }).click();
  await shoot("settings-editor");
  await page.getByRole("button", { name: "About" }).click();
  await shoot("about");
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("new flow and studio guide", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
  const { app, page } = await launch(home);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await page.getByTestId("flows-chosen").waitFor();
  const shoot = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      await app.evaluate(
        ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
        theme,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(folder, `${name}-${theme}.png`),
        fullPage: true,
      });
    }
  };
  await shoot("project-m9");
  await page.getByRole("button", { name: "New flow" }).click();
  await page.getByLabel("Flow name").fill("Login with a wrong password");
  await shoot("new-flow-dialog");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("button", {
      name: "How to find element names with Maestro Studio",
    })
    .click();
  await shoot("studio-guide");
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("maestro syntax check", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
  const { app, page } = await launch(home, {
    env: {
      JAGRA_TEST_SYNTAX: "save-item.yaml=12:Invalid Command: tapOnn",
      JAGRA_TEST_SYNTAX_MS: "4000",
    },
  });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  await page.getByRole("button", { name: "Try the sample app" }).click();
  const shoot = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      await app.evaluate(
        ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
        theme,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(folder, `${name}-${theme}.png`),
        fullPage: true,
      });
    }
  };
  await page.getByText("Checking with Maestro").first().waitFor();
  await shoot("syntax-checking");
  await page
    .getByTestId("flow-save-item.yaml")
    .getByText("Broken")
    .waitFor({ timeout: 30_000 });
  await shoot("syntax-refused");
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("ai agent screens", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
  const { app, page } = await launch(home, {
    env: { JAGRA_TEST_AGENTS: "none" },
  });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await page.getByTestId("needs-agent").waitFor();
  const shoot = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      await app.evaluate(
        ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
        theme,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(folder, `${name}-${theme}.png`),
        fullPage: true,
      });
    }
  };
  await shoot("project-no-agent");
  await page.getByRole("button", { name: "Set one up in Settings" }).click();
  await page.getByTestId("agents").waitFor();
  await shoot("settings-agent-none");
  await page
    .getByRole("button", { name: "Add an agent with its own command" })
    .click();
  await page.getByLabel("Name").fill("My agent");
  await page.getByLabel("Start command").fill("my-agent --file");
  await page.getByRole("button", { name: "Check and save" }).click();
  await page.getByText("The command must contain {instructions}.").waitFor();
  await shoot("add-agent-dialog");
  await app.close();
  await rm(home, { recursive: true, force: true });
});

test("create flow with ai screens", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-shots-"));
  const { app, page } = await launch(home, {
    env: {
      JAGRA_TEST_AGENT_MS: "1500",
      JAGRA_TEST_AGENT_OUTSIDE: "app/src/main/res/values/strings.xml",
      JAGRA_TEST_RUN: "ai-flow.yaml=failed",
      JAGRA_TEST_FLOW_MS: "300",
    },
  });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.emulateMedia({ colorScheme: null });
  const shoot = async (name: string) => {
    for (const theme of ["light", "dark"] as const) {
      await app.evaluate(
        ({ nativeTheme }, value) => (nativeTheme.themeSource = value),
        theme,
      );
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(folder, `${name}-${theme}.png`),
        fullPage: true,
      });
    }
  };
  await page.getByRole("button", { name: "Continue to projects" }).click();
  await page.getByRole("button", { name: "Try the sample app" }).click();
  await page.getByRole("button", { name: "Create flow with AI" }).click();
  await page
    .getByLabel("Scenario")
    .fill(
      "Change the stock of Oat milk 1 L to 25, save, then check the list shows 25.",
    );
  await shoot("ai-form");
  await page.getByRole("button", { name: "Create flow" }).click();
  await page.getByRole("dialog", { name: /will read/ }).waitFor();
  await shoot("ai-notice");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("ai-steps").waitFor();
  await shoot("ai-working");
  await page
    .getByRole("dialog", { name: /changed files outside/ })
    .waitFor({ timeout: 10_000 });
  await shoot("ai-warning");
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByTestId("failure-note").waitFor({ timeout: 15_000 });
  await shoot("ai-review");
  await app.close();
  await rm(home, { recursive: true, force: true });
});
