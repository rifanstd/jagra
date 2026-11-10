import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startI18n } from "./i18n";
import { followSystemTheme } from "./theme";
import "./styles.css";

followSystemTheme();
const root = document.getElementById("root");
if (root) {
  void window.jagra.settings.get().then(({ language }) => {
    startI18n(language);
    createRoot(root).render(
      <StrictMode>
        <App initialLanguage={language} />
      </StrictMode>,
    );
  });
}
