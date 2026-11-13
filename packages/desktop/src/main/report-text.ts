import type { ReportText } from "@jagra/core";
import en from "../renderer/src/locales/en.json" with { type: "json" };
import id from "../renderer/src/locales/id.json" with { type: "json" };
import type { Language } from "../shared/api.js";

/**
 * Words for the report index, from the same translation files as the screens, so the report reads
 * in the user's language (LNG-1, RES-6). core writes no sentences (D-20).
 */
export function reportText(language: Language): ReportText {
  const texts = language === "id" ? id : en;
  return {
    ...texts.report,
    runStatus: texts.run.status,
    flowStatus: texts.run.flowStatus,
    failure: texts.run.failure,
  };
}
