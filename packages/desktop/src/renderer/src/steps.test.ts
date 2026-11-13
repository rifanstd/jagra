import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import type { StepView } from "../../shared/api";
import { resources } from "./i18n";
import { stepText } from "./steps";

const step = (
  command: string,
  args: unknown = null,
  extra: Partial<StepView> = {},
): StepView => ({
  kind: "action",
  command,
  args,
  line: 1,
  ...extra,
});

describe("stepText (RES-4, D-32)", () => {
  beforeAll(async () => {
    await i18next.init({
      resources,
      lng: "en",
      fallbackLng: false,
      interpolation: { escapeValue: false },
    });
  });
  const en = (s: StepView) => stepText(s, i18next.getFixedT("en"));
  const id = (s: StepView) => stepText(s, i18next.getFixedT("id"));

  it.each([
    [step("launchApp", { clearState: true }), "Open the app with clean data"],
    [step("tapOn", "Sign in"), 'Tap "Sign in"'],
    [
      step("tapOn", {
        text: "Oat milk 1 L",
        below: "Keep chilled after opening.",
      }),
      'Tap "Oat milk 1 L" below "Keep chilled after opening."',
    ],
    [step("tapOn", { id: "save_button" }), 'Tap id "save_button"'],
    [step("inputText", "${PASSWORD}"), 'Type "${PASSWORD}"'],
    [step("assertVisible", "✓ Saved"), 'Check "✓ Saved" is visible'],
    [
      step("extendedWaitUntil", { visible: "Items", timeout: 5000 }),
      'Wait until "Items" is visible',
    ],
    [step("hideKeyboard"), "Close the keyboard"],
    [
      step("runFlow", "parts/login.yaml", {
        helper: { file: "parts/login.yaml", name: "Log in" },
      }),
      "Run parts/login.yaml · Log in",
    ],
    [step("tapOn", { text: "Save", label: "Save the item" }), "Save the item"],
    [step("setOrientation", "LANDSCAPE"), "setOrientation"],
  ])("%j", (s, text) => {
    expect(en(s)).toBe(text);
  });

  it("speaks Indonesian too", () => {
    expect(id(step("tapOn", "Sign in"))).toBe('Ketuk "Sign in"');
    expect(id(step("launchApp", { clearState: true }))).toBe(
      "Buka aplikasi dengan data bersih",
    );
  });
});
