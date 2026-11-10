import type { JagraError } from "@jagra/core/types";
import i18next from "i18next";
import { describe, expect, it } from "vitest";
import { describeError, ERROR_CODES } from "./errors";
import en from "./locales/en.json";
import id from "./locales/id.json";

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

describe("error texts (D-20, LNG-1)", () => {
  const codes = Object.keys(ERROR_CODES).sort();

  it.each([
    ["en", en.errors],
    ["id", id.errors],
  ])("%s has a text for every error code and no other", (_language, errors) => {
    expect(Object.keys(errors).sort()).toEqual(codes);
  });

  it("uses the same values in both languages", () => {
    for (const code of codes) {
      const key = code as keyof typeof en.errors;
      expect(placeholders(id.errors[key]), code).toEqual(
        placeholders(en.errors[key]),
      );
    }
  });
});

describe("the rest of the interface text (LNG-1)", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)];

  it("has the same keys in English and Indonesian", () => {
    expect(keys(id).sort()).toEqual(keys(en).sort());
  });
});

describe("describeError", () => {
  it("fills in the error's values, joins lists and leaves technical detail out", async () => {
    const t = await i18next.createInstance().init({
      resources: { en: { translation: en } },
      lng: "en",
      interpolation: { escapeValue: false },
    });
    const missing: JagraError = {
      code: "SECRETS_MISSING",
      names: ["PASSWORD", "TOKEN"],
    };
    expect(describeError(missing, t)).toBe(
      "These variables have no value: PASSWORD, TOKEN. Add them in Settings > Secrets.",
    );
    const failed: JagraError = {
      code: "ADB_FAILED",
      command: "install",
      detail: "stack trace",
    };
    expect(describeError(failed, t)).toBe("adb install failed.");
  });
});
