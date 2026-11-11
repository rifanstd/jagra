import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { blockingTool } from "../environment";
import type { EnvironmentCheck } from "../use-environment";
import { Status } from "./status";

export type Screen = "environment" | "projects" | "settings";

/** The bar at the top of every screen: the name, the environment status and the main links. */
export function TopBar({
  screen,
  environment,
  go,
}: {
  screen: Screen;
  environment: EnvironmentCheck;
  go: (screen: Screen) => void;
}) {
  const { t } = useTranslation();
  const links: Screen[] = ["settings"];
  return (
    <header className="flex min-h-13 flex-wrap items-center gap-4 border-b bg-card px-4 sm:px-6">
      <button
        type="button"
        className="rounded-md text-lg font-bold focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => go("projects")}
      >
        {t("app.name")}
      </button>
      {screen !== "environment" && (
        <EnvironmentIndicator
          environment={environment}
          open={() => go("environment")}
        />
      )}
      <nav
        className="ml-auto flex items-center gap-1"
        aria-label={t("nav.label")}
      >
        {links.map((link) => (
          <button
            key={link}
            type="button"
            aria-current={screen === link ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              screen === link &&
                "bg-secondary text-secondary-foreground hover:bg-secondary",
            )}
            onClick={() => go(link)}
          >
            {t(`nav.${link}`)}
          </button>
        ))}
      </nav>
    </header>
  );
}

/** ENV-7: the small environment status on the project list. Clicking it opens the full check. */
function EnvironmentIndicator({
  environment,
  open,
}: {
  environment: EnvironmentCheck;
  open: () => void;
}) {
  const { t } = useTranslation();
  const { view, checking, failed } = environment;
  const blocking = view && blockingTool(view);
  const status = checking ? (
    <Status tone="running">{t("env.indicator.checking")}</Status>
  ) : failed || !view ? (
    <Status tone="failed">{t("env.indicator.failed")}</Status>
  ) : blocking ? (
    <Status tone="failed">
      {t(`env.indicator.${blocking.state}`, {
        tool: t(`env.tool.${blocking.tool}.name`),
      })}
    </Status>
  ) : (
    <Status tone="passed">{t("env.indicator.ready")}</Status>
  );
  return (
    <button
      type="button"
      data-testid="environment-indicator"
      className="rounded-md px-1 text-sm hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={open}
    >
      {status}
    </button>
  );
}
