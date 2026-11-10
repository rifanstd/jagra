import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "../../shared/api";
import en from "./locales/en.json";
import id from "./locales/id.json";

/** Every piece of interface text comes from these files (LNG-1). */
export const resources = {
  en: { translation: en },
  id: { translation: id },
} as const;

export function startI18n(language: Language): typeof i18next {
  void i18next.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: "en",
    // React already shows every value as text, never as HTML (SEC-7).
    interpolation: { escapeValue: false },
  });
  return i18next;
}
