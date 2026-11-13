import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Language, Platform, SettingsView } from "../../shared/api";
import { TopBar } from "./components/top-bar";
import type { Route } from "./navigation";
import { CreateProjectScreen } from "./screens/create-project-screen";
import { EnvironmentScreen } from "./screens/environment-screen";
import { FlowDetailScreen } from "./screens/flow-detail-screen";
import { HistoryScreen } from "./screens/history-screen";
import { ProjectScreen } from "./screens/project-screen";
import { ProjectsScreen } from "./screens/projects-screen";
import { ResultsScreen } from "./screens/results-screen";
import { RunningScreen } from "./screens/running-screen";
import { AboutScreen } from "./screens/about-screen";
import { SettingsScreen, type LanguageChoice } from "./screens/settings-screen";
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
  const [route, setRoute] = useState<Route>({
    screen: initial.settings.environmentSeen ? "projects" : "environment",
  });
  const [language, setLanguage] = useState<Language>(initial.language);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // LNG-1: the change shows at once, without a restart, and is kept for next time.
  // "system" clears the choice, so Jagra follows the operating system again.
  const chooseLanguage = async (choice: LanguageChoice) => {
    const view = await window.jagra.settings.set({
      language: choice === "system" ? undefined : choice,
    });
    setLanguage(view.language);
    await i18n.changeLanguage(view.language);
  };

  const leaveCheck = async () => {
    setRoute({ screen: "projects" });
    await window.jagra.settings.set({ environmentSeen: true });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar screen={route.screen} environment={environment} go={setRoute} />
      {route.screen === "environment" && (
        <EnvironmentScreen
          environment={environment}
          platform={platform}
          onContinue={() => void leaveCheck()}
        />
      )}
      {route.screen === "projects" && (
        <ProjectsScreen go={setRoute} environment={environment} />
      )}
      {route.screen === "create" && <CreateProjectScreen go={setRoute} />}
      {route.screen === "project" && (
        <ProjectScreen key={route.id} id={route.id} go={setRoute} />
      )}
      {route.screen === "running" && <RunningScreen go={setRoute} />}
      {route.screen === "results" && (
        <ResultsScreen
          key={route.runId}
          projectId={route.projectId}
          runId={route.runId}
          go={setRoute}
        />
      )}
      {route.screen === "flow" && (
        <FlowDetailScreen
          key={`${route.runId}-${route.index}`}
          projectId={route.projectId}
          runId={route.runId}
          index={route.index}
          go={setRoute}
        />
      )}
      {route.screen === "history" && (
        <HistoryScreen
          key={route.projectId}
          projectId={route.projectId}
          go={setRoute}
        />
      )}
      {route.screen === "about" && <AboutScreen />}
      {route.screen === "settings" && (
        <SettingsScreen
          onLanguage={chooseLanguage}
          environment={environment}
          platform={platform}
        />
      )}
    </div>
  );
}
