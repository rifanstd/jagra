import { describe, expect, it } from "vitest";
import {
  buildFix,
  buildHistory,
  buildInstructions,
  TEMPLATE,
} from "./instructions.js";

const request = {
  scenario: "Login dengan password salah,\nharus muncul pesan error",
  appId: "dev.jagra.sample",
  hasSourceCode: true,
  helpers: [{ file: "parts/login.yaml", name: "Log in as the demo user" }],
  flows: [{ file: "login-works.yaml", name: "Login works" }],
};

describe("buildInstructions (AGT-14, AGT-15)", () => {
  it("joins the template, the team's rules and the request", () => {
    const text = buildInstructions("Use parts/login.yaml.", {
      ...request,
      file: "login-wrong-password.yaml",
    });
    expect(text.startsWith(TEMPLATE)).toBe(true);
    expect(text).toContain(
      "## Rules from the team (.jagra/agent-rules.md)\n\nThey come on top of the rules above.\n\nUse parts/login.yaml.",
    );
    expect(text).toContain(
      "> Login dengan password salah,\n> harus muncul pesan error",
    );
    expect(text).toContain(
      "Write the flow to `.jagra/flows/login-wrong-password.yaml`.",
    );
    expect(text).toContain("The app's `appId` is `dev.jagra.sample`.");
    expect(text).toContain("The project folder has the app's source code.");
    expect(text).toContain("- parts/login.yaml: Log in as the demo user");
    expect(text).toContain("- login-works.yaml: Login works");
  });

  it("leaves out empty team rules, and lets the agent name the file", () => {
    const text = buildInstructions("  \n", {
      ...request,
      hasSourceCode: false,
      helpers: [],
    });
    expect(text).not.toContain("Rules from the team");
    expect(text).toContain("Write the flow to a new file in `.jagra/flows`");
    expect(text).toContain("does not have the app's source code");
    expect(text).toContain("Helper flows in `.jagra/flows/parts`:\n- none");
  });

  it("has every rule of AGT-15 and the report shape of AGT-16", () => {
    for (const rule of [
      "clearState: true",
      "runFlow",
      "${PASSWORD}",
      "Write only inside `.jagra/flows`",
      "Do not run any command",
      "assertWithAI",
      "exact text of buttons",
      "report a possible bug instead of changing the check",
      '"suggestedTests"',
    ]) {
      expect(TEMPLATE).toContain(rule);
    }
    expect(TEMPLATE).not.toMatch(/—/);
  });
});

describe("buildFix and buildHistory (AGT-17, AGT-18, AGT-27)", () => {
  const fix = {
    file: ".jagra/flows/save-item.yaml",
    note: "The button is called Simpan",
    failedStep: 'Tap on "Save"',
    reason: "Element not found: Save",
    screen: [{ text: "Simpan", id: "save_button" }, { description: "Back" }],
  };

  it("sends the note and the failure to the same session", () => {
    const text = buildFix(fix);
    expect(text).toContain("Fix the flow .jagra/flows/save-item.yaml.");
    expect(text).toContain("The user's note: The button is called Simpan");
    expect(text).toContain('The step that failed: Tap on "Save"');
    expect(text).toContain("Maestro's reason: Element not found: Save");
    expect(text).toContain('- text "Simpan", id "save_button"');
    expect(text).toContain('- description "Back"');
    expect(text).not.toContain(TEMPLATE);
    expect(buildFix({ file: "x.yaml" })).toContain("The user's note: none");
  });

  it("writes out the earlier work for a new session", () => {
    const text = buildHistory("", {
      scenario: "Rename an item",
      file: ".jagra/flows/save-item.yaml",
      content: "appId: x\n---\n- launchApp\n",
      fix,
    });
    expect(text.startsWith(TEMPLATE)).toBe(true);
    expect(text).toContain("> Rename an item");
    expect(text).toContain("```yaml\nappId: x\n---\n- launchApp\n```");
    expect(text).toContain("The user's note: The button is called Simpan");
  });
});
