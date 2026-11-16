import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { answer, launch, makeFolder } from "./launch.js";

test("shows a flow Maestro refuses as broken, after checking it in the background (FLOW-6, D-98)", async () => {
  const home = await mkdtemp(join(tmpdir(), "jagra-e2e-"));
  const { app, page } = await launch(home, {
    env: {
      JAGRA_TEST_SYNTAX: "typo.yaml=4:Invalid Command: tapOnn",
      JAGRA_TEST_SYNTAX_MS: "1500",
    },
  });
  await page.getByRole("button", { name: "Continue to projects" }).click();
  const folder = await makeFolder(home, "shop", {
    ".jagra/config.yaml": "format: 1\nname: shop\nappId: com.shop\n",
    ".jagra/flows/a.yaml": "appId: com.shop\n---\n- launchApp\n",
    ".jagra/flows/typo.yaml":
      "appId: com.shop\n---\n- launchApp\n- tapOnn: Save\n",
  });
  await page
    .getByRole("button", { name: "Create a project from an app folder" })
    .click();
  await answer(app, [folder]);
  await page.getByRole("button", { name: "Choose folder" }).click();
  await page.getByRole("button", { name: "Create project" }).click();

  const typo = page.getByTestId("flow-typo.yaml");
  await expect(typo).toContainText("Checking with Maestro");
  await expect(page.getByTestId("flows-chosen")).toHaveText("2 of 2 chosen");

  await expect(typo).toContainText(
    "line 4, is refused by Maestro: Invalid Command: tapOnn.",
  );
  await expect(typo).toContainText("Broken");
  await expect(page.getByTestId("flow-a.yaml")).not.toContainText(
    "Checking with Maestro",
  );
  await expect(page.getByTestId("flows-chosen")).toContainText("1 of 2 chosen");

  await app.close();
  await rm(home, { recursive: true, force: true });
});
