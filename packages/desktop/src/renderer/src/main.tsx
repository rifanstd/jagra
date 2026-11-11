import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startI18n } from "./i18n";
import { followSystemTheme } from "./theme";
import "./styles.css";

followSystemTheme();
const root = document.getElementById("root");
if (root) {
  void Promise.all([window.jagra.settings.get(), window.jagra.app.info()]).then(
    ([settings, info]) => {
      startI18n(settings.language);
      createRoot(root).render(
        <StrictMode>
          <App initial={settings} platform={info.platform} />
        </StrictMode>,
      );
    },
  );
}
