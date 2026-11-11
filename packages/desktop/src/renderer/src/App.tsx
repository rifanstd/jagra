import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language, Platform, SettingsView } from "../../shared/api";
import { TopBar, type Screen } from "./components/top-bar";
import { EnvironmentScreen } from "./screens/environment-screen";
import { ProjectsScreen } from "./screens/projects-screen";
import { SettingsScreen } from "./screens/settings-screen";
import { useEnvironment } from "./use-environment";

/**
 * Moves between screens with plain state; a desktop app with one window needs no router.
 * The environment check is the first screen until the user has continued from it once (ENV-7).
 */
export function App({
  initial,
  platform,
}: {
  initial: SettingsView;
  platform: Platform;
}) {
  const { i18n } = useTranslation();
  const environment = useEnvironment();
  const [screen, setScreen] = useState<Screen>(
    initial.settings.environmentSeen ? "projects" : "environment",
  );
  const [language, setLanguage] = useState<Language>(initial.language);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // LNG-1: the change shows at once, without a restart, and is kept for next time.
  const chooseLanguage = async (value: Language) => {
    setLanguage(value);
    await i18n.changeLanguage(value);
    await window.jagra.settings.set({ language: value });
  };

  const leaveCheck = async () => {
    setScreen("projects");
    await window.jagra.settings.set({ environmentSeen: true });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar screen={screen} environment={environment} go={setScreen} />
      {screen === "environment" && (
        <EnvironmentScreen
          environment={environment}
          platform={platform}
          onContinue={() => void leaveCheck()}
        />
      )}
      {screen === "projects" && <ProjectsScreen />}
      {screen === "settings" && (
        <SettingsScreen
          language={language}
          onLanguage={(value) => void chooseLanguage(value)}
        />
      )}
    </div>
  );
}
